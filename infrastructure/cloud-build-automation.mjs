#!/usr/bin/env node
/**
 * @fileoverview Cloud Build Automation - Build and deploy using Google Cloud SDKs
 * Replaces cloudbuild.yaml with programmatic SDK-based builds
 */

import { CloudBuildClient } from '@google-cloud/cloudbuild';
import { CloudDeployClient } from '@google-cloud/deploy';
import { CliContext } from '../lib/cli.js';
import { logger } from '../lib/cli-logger.js';
import { parseFlags } from '../lib/cli-flags.js';
import { DEFAULTS } from '../config/defaults.mjs';
import { validateProjectId, validateRegion, validateTimeout } from '../lib/validators.mjs';

/**
 * Build Docker image using Cloud Build SDK
 */
async function buildImage(cli, config, shortSha) {
  logger.section('Building Docker Image');

  try {
    const client = new CloudBuildClient();
    const imageTag = `${config.region}-docker.pkg.dev/${config.projectId}/${config.repoName}/app:${shortSha}`;
    const latestTag = `${config.region}-docker.pkg.dev/${config.projectId}/${config.repoName}/app:latest`;

    logger.info(`Image: ${imageTag}`);
    logger.info('Starting Cloud Build...');

    const buildTime = new Date().toISOString();

    // Validate timeout
    validateTimeout(config.buildTimeout, 60, 3600);

    // Define the build configuration
    const build = {
      steps: [
        // Step 1: Ensure placeholder channel-mappings.json exists
        {
          name: 'gcr.io/cloud-builders/docker',
          entrypoint: 'bash',
          args: [
            '-c',
            `[ -f channel-mappings.json ] || echo '{"databases":[]}' > channel-mappings.json
docker build \\
  --build-arg BUILD_TIME=${buildTime} \\
  -t ${imageTag} \\
  -t ${latestTag} \\
  .`
          ],
          id: 'build-image'
        },
        // Step 2: Push image with both tags
        {
          name: 'gcr.io/cloud-builders/docker',
          args: ['push', '--all-tags', `${config.region}-docker.pkg.dev/${config.projectId}/${config.repoName}/app`],
          id: 'push-images',
          waitFor: ['build-image']
        }
      ],
      images: [imageTag, latestTag],
      options: {
        machineType: config.machineType,
        logging: 'CLOUD_LOGGING_ONLY',
        substitutionOption: 'ALLOW_LOOSE'
      },
      timeout: { seconds: config.buildTimeout }
    };

    // Create and execute the build
    const [operation] = await client.createBuild({
      projectId: config.projectId,
      build
    });

    logger.info('Build submitted, waiting for completion...');
    logger.info(`Build ID: ${operation.metadata.build.id}`);

    // Wait for build to complete
    const [response] = await operation.promise();

    if (response.status === 'SUCCESS') {
      logger.success('✓ Build completed successfully');
      return { imageTag, shortSha };
    } else {
      throw new Error(`Build failed with status: ${response.status}`);
    }

  } catch (error) {
    logger.error(`✗ Error building image: ${error.message}`);
    throw error;
  }
}

/**
 * Create Cloud Deploy release with unique name
 */
async function createRelease(cli, config, imageTag, shortSha) {
  logger.section('Creating Cloud Deploy Release');

  try {
    const client = new CloudDeployClient();

    // Generate unique release name: rel-<SHORT_SHA>-<timestamp>
    // This ensures the resulting rollout name (rel-...-to-staging-0001) fits under 63 chars
    const timestamp = Math.floor(Date.now() / 1000);
    const releaseName = `rel-${shortSha}-${timestamp}`;

    logger.info(`Release: ${releaseName}`);
    logger.info('Creating release...');

    const parent = `projects/${config.projectId}/locations/${config.region}/deliveryPipelines/${config.pipelineName}`;

    const [operation] = await client.createRelease({
      parent,
      releaseId: releaseName,
      release: {
        skaffoldConfigPath: 'skaffold.yaml',
        buildArtifacts: [
          {
            image: 'oncall-cat',
            tag: imageTag
          }
        ]
      }
    });

    logger.info('Release submitted, waiting for completion...');
    const [response] = await operation.promise();

    logger.success(`✓ Release ${releaseName} created successfully`);
    logger.info(`Release path: ${response.name}`);

    return releaseName;

  } catch (error) {
    logger.error(`✗ Error creating release: ${error.message}`);
    throw error;
  }
}

/**
 * Get current commit SHA
 */
async function getCommitSha(cli) {
  try {
    const { stdout } = await cli.run('git rev-parse --short=7 HEAD', { capture: true });
    return stdout.trim();
  } catch {
    // Fallback to timestamp if not in git repo
    logger.warn('Not in git repo, using timestamp as identifier');
    return Date.now().toString().slice(-7);
  }
}

/**
 * Get configuration from environment or CLI context
 * @returns {Promise<Object>} Configuration object
 */
async function getConfig() {
  let projectId, region;

  // In Cloud Build environment, use environment variables
  if (process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID) {
    projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
    region = process.env.REGION || DEFAULTS.region;

    // Validate in CI environment
    validateProjectId(projectId);
    validateRegion(region);

    return {
      projectId,
      region,
      repoName: process.env.REPO_NAME || DEFAULTS.repoName,
      pipelineName: process.env.PIPELINE_NAME || DEFAULTS.pipelineName,
      buildTimeout: parseInt(process.env.BUILD_TIMEOUT_SECONDS || DEFAULTS.buildTimeoutSeconds, 10),
      machineType: process.env.MACHINE_TYPE || DEFAULTS.machineType
    };
  }

  // In local environment, use CliContext
  const cli = await CliContext.bootstrap({ requireProject: true, requireRegion: true });

  projectId = cli.projectId;
  region = cli.region;

  // Validate from CLI context
  validateProjectId(projectId);
  validateRegion(region);

  return {
    projectId,
    region,
    repoName: process.env.REPO_NAME || DEFAULTS.repoName,
    pipelineName: process.env.PIPELINE_NAME || DEFAULTS.pipelineName,
    buildTimeout: parseInt(process.env.BUILD_TIMEOUT_SECONDS || DEFAULTS.buildTimeoutSeconds, 10),
    machineType: process.env.MACHINE_TYPE || DEFAULTS.machineType,
    cli
  };
}

/**
 * Main execution
 */
async function main() {
  try {
    const prelim = parseFlags(process.argv);
    const command = (prelim._raw[0] || 'build-and-deploy').toLowerCase();
    const config = await getConfig();

    // Create a minimal CLI object for Cloud Build environment
    const cli = config.cli || {
      async run(cmd, opts = {}) {
        const { execSync } = await import('child_process');
        try {
          const result = execSync(cmd, {
            encoding: 'utf8',
            stdio: opts.capture ? 'pipe' : 'inherit',
            ...opts
          });
          return { stdout: result || '', exitCode: 0 };
        } catch (error) {
          logger.warn(`Command failed: ${cmd}`);
          if (error.stdout) {
            logger.warn(`stdout: ${error.stdout}`);
          }
          if (error.stderr) {
            logger.warn(`stderr: ${error.stderr}`);
          }
          return {
            stdout: error.stdout || '',
            stderr: error.stderr || '',
            exitCode: error.status || 1
          };
        }
      }
    };

    logger.section('On-Call Cat - Cloud Build Automation (SDK)');
    logger.info(`Project: ${config.projectId}`);
    logger.info(`Region: ${config.region}`);
    logger.info(`Repository: ${config.repoName}`);
    logger.info(`Pipeline: ${config.pipelineName}`);

    switch (command) {
      case 'build': {
        const shortSha = await getCommitSha(cli);
        logger.info(`Commit SHA: ${shortSha}`);
        await buildImage(cli, config, shortSha);
        break;
      }
      case 'create-release': {
        // When called from cloudbuild.yaml, image is already built and pushed
        // Get SHORT_SHA from environment or git
        const shortSha = process.env.SHORT_SHA || await getCommitSha(cli);
        logger.info(`Commit SHA: ${shortSha}`);

        // Image tag from environment or construct it
        const imageTag = process.env.IMAGE_TAG || `${config.region}-docker.pkg.dev/${config.projectId}/${config.repoName}/app:${shortSha}`;
        logger.info(`Image: ${imageTag}`);

        // Create Cloud Deploy release
        await createRelease(cli, config, imageTag, shortSha);

        logger.success('\n✓ Release created successfully');
        logger.info('\nNext steps:');
        logger.info('1. Monitor the rollout in Cloud Console');
        logger.info('2. Promote to production when ready');
        break;
      }
      case 'build-and-deploy':
      case 'deploy': {
        const shortSha = await getCommitSha(cli);
        logger.info(`Commit SHA: ${shortSha}`);

        // Build image
        const { imageTag } = await buildImage(cli, config, shortSha);

        // Create release
        await createRelease(cli, config, imageTag, shortSha);

        logger.success('\n✓ Build and deploy completed successfully');
        logger.info('\nNext steps:');
        logger.info('1. Monitor the rollout in Cloud Console');
        logger.info('2. Promote to production when ready');
        break;
      }
      default:
        logger.error(`Unknown command: ${command}`);
        logger.warn('Available commands: build, create-release, build-and-deploy, deploy');
        process.exit(1);
    }

    logger.success('\n✓ Operation complete');
  } catch (error) {
    logger.error(`\n✗ Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, buildImage, createRelease };
