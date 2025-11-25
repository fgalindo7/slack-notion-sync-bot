/**
 * @fileoverview GCP services checker (Cloud Run, Deploy, Build)
 * @author Francisco Galindo
 */

import { HealthChecker } from '../health-checker.mjs';
import icons from '../../ascii-icons.js';

/**
 * GCP services health checker
 * Checks Cloud Run, Cloud Deploy, and Cloud Build status
 */
export class GcpCheck extends HealthChecker {
  constructor(config = {}) {
    super('GCP Services', config);
  }

  async check() {
    const { cli } = this.config;

    if (!cli) {
      return {
        status: 'error',
        data: null,
        error: 'CLI context not available',
      };
    }

    if (cli.dryRun) {
      return this.getDryRunData();
    }

    try {
      const [cloudRun, cloudDeploy, cloudBuild] = await Promise.all([
        this.fetchCloudRunInfo(cli),
        this.fetchCloudDeployInfo(cli),
        this.fetchCloudBuildInfo(cli),
      ]);

      const status = cloudRun && cloudDeploy && cloudBuild ? 'ok' : 'warn';

      return {
        status,
        data: {
          cloudRun,
          cloudDeploy,
          cloudBuild,
        },
        error: null,
      };
    } catch (err) {
      return {
        status: 'error',
        data: null,
        error: err.message,
      };
    }
  }

  async gcloud(cli, command) {
    if (!cli) return null;
    const res = await cli.run(`gcloud ${command}`);
    if (res.exitCode !== 0) return null;
    return (res.stdout || '').trim();
  }

  async fetchCloudRunInfo(cli) {
    try {
      const serviceName = this.config.serviceName;
      const region = this.config.region;

      const revision = await this.gcloud(cli, `run services describe ${serviceName} --region=${region} --format='value(status.latestReadyRevisionName)'`);
      const revisionTime = revision ? await this.gcloud(cli, `run revisions describe ${revision} --region=${region} --format='value(metadata.creationTimestamp)'`) : null;
      const traffic = await this.gcloud(cli, `run services describe ${serviceName} --region=${region} --format='json(status.traffic)'`);
      const resources = await this.gcloud(cli, `run services describe ${serviceName} --region=${region} --format='value(spec.template.spec.containers[0].resources.limits.cpu, spec.template.spec.containers[0].resources.limits.memory)'`);
      const scaling = await this.gcloud(cli, `run services describe ${serviceName} --region=${region} --format='value(spec.template.metadata.annotations.autoscaling\\.knative\\.dev/minScale, spec.template.metadata.annotations.autoscaling\\.knative\\.dev/maxScale)'`);
      const url = await this.gcloud(cli, `run services describe ${serviceName} --region=${region} --format='value(status.url)'`);

      const [cpu, memory] = resources ? resources.split('\t') : ['unknown', 'unknown'];
      const [minScale, maxScale] = scaling ? scaling.split('\t') : ['1', '10'];

      return {
        revision,
        revisionTime,
        traffic: traffic ? JSON.parse(traffic) : [],
        cpu,
        memory,
        minScale: parseInt(minScale, 10),
        maxScale: parseInt(maxScale, 10),
        url,
        consoleUrl: `https://console.cloud.google.com/run/detail/${region}/${serviceName}?project=${this.config.projectId}`,
      };
    } catch {
      return null;
    }
  }

  async fetchCloudDeployInfo(cli) {
    try {
      const pipelineName = this.config.pipelineName;
      const region = this.config.region;

      const releases = await this.gcloud(cli, `deploy releases list --delivery-pipeline=${pipelineName} --region=${region} --limit=1 --format=json`);
      if (!releases) return null;

      const releaseData = JSON.parse(releases);
      const latestRelease = releaseData[0];
      if (!latestRelease) return null;

      const releaseName = latestRelease.name.split('/').pop();
      const createTime = latestRelease.createTime;
      const renderState = latestRelease.renderState;

      const rollouts = await this.gcloud(cli, `deploy rollouts list --delivery-pipeline=${pipelineName} --region=${region} --release=${releaseName} --format=json`);
      const rolloutData = rollouts ? JSON.parse(rollouts) : [];

      const targets = latestRelease.targetSnapshots?.map(snapshot => ({
        targetId: snapshot.targetId,
        requireApproval: snapshot.requireApproval || false,
        rollout: rolloutData.find(r => r.targetId === snapshot.targetId),
      })) || [];

      return {
        releaseName,
        createTime,
        renderState,
        targets,
        consoleUrl: `https://console.cloud.google.com/deploy/delivery-pipelines/${region}/${pipelineName}?project=${this.config.projectId}`,
      };
    } catch {
      return null;
    }
  }

  async fetchCloudBuildInfo(cli) {
    try {
      const builds = await this.gcloud(cli, 'builds list --limit=20 --format=json');
      if (!builds) return null;

      const buildData = JSON.parse(builds);
      const serviceName = this.config.serviceName;

      // Filter builds that belong to the oncall-cat repository
      const repoBuilds = buildData
        .filter(build => {
          const hasRepoImage = build.images?.some(img => img.includes(`/${serviceName}/`));
          return hasRepoImage;
        })
        .slice(0, 5)
        .map(build => ({
          id: build.id.substring(0, 8),
          status: build.status,
          createTime: build.createTime,
          duration: build.timing?.BUILD?.endTime && build.timing?.BUILD?.startTime
            ? (new Date(build.timing.BUILD.endTime) - new Date(build.timing.BUILD.startTime)) / 1000
            : null,
          commitSha: build.substitutions?.SHORT_SHA || 'unknown',
          triggerName: build.buildTriggerId ? 'TRIGGER' : 'MANUAL',
        }));

      return {
        recentBuilds: repoBuilds,
        consoleUrl: `https://console.cloud.google.com/cloud-build/builds?project=${this.config.projectId}`,
      };
    } catch {
      return null;
    }
  }

  getDryRunData() {
    const now = new Date().toISOString();
    return {
      status: 'ok',
      data: {
        cloudRun: {
          revision: 'rev-dry-run',
          revisionTime: now,
          traffic: { status: { traffic: [{ percent: 100, latestRevision: true }] } },
          cpu: '1',
          memory: '512Mi',
          minScale: 1,
          maxScale: 3,
          url: 'https://dry-run.example.com',
          consoleUrl: `https://console.cloud.google.com/run/detail/${this.config.region}/${this.config.serviceName}?project=${this.config.projectId}`,
        },
        cloudDeploy: {
          releaseName: 'rel-dry-run',
          createTime: now,
          renderState: 'SUCCEEDED',
          targets: [
            { targetId: 'staging', requireApproval: false, rollout: { state: 'SUCCEEDED' } },
            { targetId: 'production', requireApproval: true, rollout: { state: 'PENDING' } }
          ],
          consoleUrl: `https://console.cloud.google.com/deploy/delivery-pipelines/${this.config.region}/${this.config.pipelineName}?project=${this.config.projectId}`,
        },
        cloudBuild: {
          recentBuilds: [
            { id: 'abcd1234', status: 'SUCCESS', createTime: now, duration: 15, commitSha: 'deadbeef', triggerName: 'TRIGGER' },
            { id: 'efgh5678', status: 'FAILURE', createTime: now, duration: 9, commitSha: 'cafebabe', triggerName: 'MANUAL' }
          ],
          consoleUrl: `https://console.cloud.google.com/cloud-build/builds?project=${this.config.projectId}`,
        },
      },
      error: null,
    };
  }

  isApplicable(target) {
    // GCP checks for non-local targets, or in dry-run mode for testing
    return target !== 'local' || process.env.DRY_RUN === '1';
  }

  getIcon() {
    return icons.cloudRun; // Using Cloud Run as representative icon
  }
}

export default GcpCheck;
