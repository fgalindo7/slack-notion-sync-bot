/**
 * @fileoverview Terminal renderer for health check results
 * @author Francisco Galindo
 */

import { Renderer } from '../renderer.mjs';
import { colors, drawBox, drawHeader, formatShortDate, formatTimeAgo, formatDuration, formatUptime, createLink } from '../formatters.mjs';
import { getCatFrame } from '../../ascii-art.js';
import icons from '../../ascii-icons.js';

/**
 * Terminal renderer with boxen output
 */
export class TerminalRenderer extends Renderer {
  constructor(config = {}, flags = {}) {
    super(config, flags);
    this.target = flags.target || '';
  }

  async render(results) {
    this.clear();

    // ASCII art cat logo
    this.renderCat();

    // Draw header
    console.log(drawHeader('On-Call Cat - Health Check Dashboard'));
    console.log('');

    // Render each section
    for (const result of results) {
      if (result.status === 'error' && !result.data) {
        // Skip sections that errored without data
        continue;
      }

      const renderer = this.getRendererForChecker(result.checker);
      if (renderer) {
        await renderer.call(this, result);
      }
    }

    // Summary
    this.renderSummary(results);
  }

  renderCat() {
    const frame = getCatFrame();
    const catColor = this.getCatColor();
    console.log('');
    frame.forEach(line => console.log(`  ${catColor}${line}${colors.reset}`));
  }

  getCatColor() {
    const t = this.target.toLowerCase();
    if (t === 'local') {
      return colors.cyan;
    } else if (t === 'gcp' || t === 'gcp-staging' || t === 'staging') {
      return colors.orange;
    } else if (t === 'gcp-prod' || t === 'prod') {
      return colors.red;
    }
    return colors.cyan;
  }

  getRendererForChecker(checkerName) {
    const renderers = {
      'Application Health': this.renderAppHealth,
      'Git': this.renderGit,
      'GCP Services': this.renderGcp,
      'Docker': this.renderDocker,
      'Node.js': this.renderNode,
      'Filesystem': this.renderFilesystem,
      'Ports': this.renderPorts,
    };
    return renderers[checkerName];
  }

  async renderAppHealth(result) {
    const { data, status } = result;
    if (!data || !data.health) return;

    const content = [];
    const health = data.health;

    // Status
    const statusIcon = health.status === 'healthy' ? `${colors.green}OK${colors.reset}` : `${colors.red}ERR${colors.reset}`;
    const statusText = health.status === 'healthy' ? `${colors.green}HEALTHY${colors.reset}` : `${colors.red}UNHEALTHY${colors.reset}`;
    content.push(` Status:        ${statusIcon} ${statusText}`);

    if (health.uptime || health.metrics?.uptimeSeconds) {
      content.push(` Uptime:        ${formatUptime(health.metrics?.uptimeSeconds || health.uptime)}`);
    }

    if (health.lastActivity) {
      content.push(` Last Activity: ${formatTimeAgo(health.lastActivity)}`);
    }

    content.push('');

    // Mode and channels
    const isMultiChannel = data.mappings?.databases && data.mappings.databases.length > 0;
    const modeText = isMultiChannel ? `${colors.cyan}[MC] Multi-Channel${colors.reset}` : `${colors.blue}[SC] Single-Channel${colors.reset}`;
    content.push(` Mode:          ${modeText}`);

    if (isMultiChannel) {
      const totalChannels = data.mappings.databases.reduce((sum, db) => sum + db.channels.length, 0);
      content.push(` Channels:      ${colors.bright}${totalChannels}${colors.reset} channels configured`);

      for (const db of data.mappings.databases) {
        const dbShort = db.databaseId.substring(0, 8) + '...' + db.databaseId.substring(db.databaseId.length - 4);
        const dbTitle = data.dbTitles?.[db.databaseId] || db.description || dbShort;

        for (const channel of db.channels) {
          const channelName = data.channelNames?.[channel.channelId] || channel.description || channel.channelId;
          content.push(`   ${colors.dim}-${colors.reset} ${channelName} ${colors.gray}(${channel.channelId})${colors.reset}`);
          content.push(`     ${colors.dim}> ${dbTitle}${colors.reset}`);
        }
      }
    }

    content.push('');

    // Metrics
    if (health.metrics) {
      content.push(` ${colors.bright}Metrics:${colors.reset}`);
      const m = health.metrics;
      content.push(`   Messages:    ${m.messagesProcessed} processed | ${m.messagesCreated} created | ${m.messagesUpdated} updated`);

      const successRate = parseFloat(m.successRate);
      let successColor = colors.green;
      let successIcon = 'OK';
      if (successRate < 95 && successRate > 0) {
        successColor = colors.yellow;
        successIcon = '!!';
      } else if (successRate === 0 && m.messagesProcessed === 0) {
        successColor = colors.gray;
        successIcon = 'N/A';
      }

      content.push(`   Success:     ${successColor}${successIcon} ${m.successRate}${colors.reset}`);

      if (m.messagesFailed > 0 || m.apiTimeouts > 0) {
        content.push(`   ${colors.red}Errors:      ${m.messagesFailed} failures | ${m.apiTimeouts} timeouts${colors.reset}`);
      }
    }

    console.log(`${colors.bright}${icons.app} Application Health${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  async renderGit(result) {
    const { data, status } = result;
    if (!data) {
      console.log(`${colors.bright}${icons.git} Version Info${colors.reset}`);
      console.log(drawBox([` ${colors.red}Git info unavailable${colors.reset}`]));
      console.log('');
      return;
    }

    const content = [];

    // For local target, show simpler git info
    if (this.target === 'local') {
      const localTime = formatShortDate(data.commitTime);
      content.push(` Local:         ${data.sha} @ ${localTime}`);
      content.push(` Branch:        ${data.branch}`);
      content.push(` Status:        ${data.hasUncommitted ? colors.yellow + '! Uncommitted changes' + colors.reset : colors.green + 'Clean' + colors.reset}`);
      content.push(` GitHub:        ${colors.blue}${icons.link} ${data.githubUrl}${colors.reset}`);
    } else {
      // For GCP targets, show more detailed comparison
      const localTime = formatShortDate(data.commitTime);
      content.push(` Local:         ${data.sha} @ ${localTime}`);
      content.push(` Branch:        ${data.branch}`);

      if (data.hasUncommitted) {
        content.push(` ${colors.yellow}! Uncommitted changes${colors.reset}`);
      }

      content.push(` GitHub:        ${colors.blue}${icons.link} ${createLink(data.githubUrl, 'View Commit', 30)}${colors.reset}`);
    }

    console.log(`${colors.bright}${icons.git} Version Info${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  async renderGcp(result) {
    const { data, status } = result;
    if (!data) return;

    // Render Cloud Run
    if (data.cloudRun) {
      this.renderCloudRun(data.cloudRun);
    }

    // Render Cloud Deploy
    if (data.cloudDeploy) {
      this.renderCloudDeploy(data.cloudDeploy);
    }

    // Render Cloud Build
    if (data.cloudBuild) {
      this.renderCloudBuild(data.cloudBuild);
    }
  }

  renderCloudRun(info) {
    const content = [];

    content.push(` Service:       ${colors.bright}${this.config.serviceName}${colors.reset}`);

    if (info.revision) {
      const time = formatShortDate(info.revisionTime);
      content.push(` Revision:      ${info.revision} ${colors.gray}(${time})${colors.reset}`);
    }

    if (info.traffic && info.traffic.status && info.traffic.status.traffic) {
      const trafficList = info.traffic.status.traffic.map(t =>
        `${t.percent}% > ${t.revisionName || t.latestRevision ? 'latest' : 'unknown'}`
      ).join(', ');
      content.push(` Traffic:       ${trafficList}`);
    }

    content.push(` Resources:     ${info.cpu} vCPU | ${info.memory} memory`);
    content.push(` Scaling:       ${info.minScale}-${info.maxScale} instances`);

    if (info.url) {
      content.push(` URL:           ${colors.cyan}${createLink(info.url, info.url)}${colors.reset}`);
    }

    content.push(` Console:       ${icons.link} ${createLink(info.consoleUrl, 'View in GCP Console', 30)}`);

    console.log(`${colors.bright}${icons.cloudRun} Cloud Run Service${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  renderCloudDeploy(info) {
    const content = [];

    content.push(` Pipeline:      ${colors.bright}${this.config.pipelineName}${colors.reset}`);

    if (info.releaseName) {
      const time = formatShortDate(info.createTime);
      content.push(` Latest:        ${info.releaseName} ${colors.gray}(${time})${colors.reset}`);
    }

    if (info.renderState) {
      const stateColor = info.renderState === 'SUCCEEDED' ? colors.green : colors.yellow;
      content.push(` Status:        ${stateColor}${info.renderState}${colors.reset}`);
    }

    if (info.targets && info.targets.length > 0) {
      content.push(` ${colors.bright}Targets:${colors.reset}`);
      for (const target of info.targets) {
        const rollout = target.rollout;
        let status = '[PEND] PENDING';
        let statusColor = colors.gray;

        if (rollout) {
          if (rollout.state === 'SUCCEEDED') {
            status = '[OK] SUCCEEDED';
            statusColor = colors.green;
          } else if (rollout.state === 'FAILED') {
            status = '[ERR] FAILED';
            statusColor = colors.red;
          } else if (rollout.state === 'IN_PROGRESS') {
            status = '[...] IN_PROGRESS';
            statusColor = colors.yellow;
          } else if (rollout.approvalState === 'NEEDS_APPROVAL') {
            status = '[WAIT] PENDING_APPROVAL';
            statusColor = colors.yellow;
          }
        } else if (target.requireApproval) {
          status = '[WAIT] PENDING_APPROVAL';
          statusColor = colors.yellow;
        }

        const autoInfo = target.requireApproval ? '' : ' (auto-deploy)';
        content.push(`   ${colors.dim}-${colors.reset} ${target.targetId.padEnd(12)} ${statusColor}${status}${colors.reset}${colors.gray}${autoInfo}${colors.reset}`);
      }
    }

    content.push(` Console:       ${icons.link} ${createLink(info.consoleUrl, 'View Pipeline', 30)}`);

    console.log(`${colors.bright}${icons.cloudDeploy} Cloud Deploy Pipeline${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  renderCloudBuild(info) {
    const content = [];

    content.push(` ${colors.bright}Recent Builds:${colors.reset}`);

    for (let i = 0; i < Math.min(3, info.recentBuilds.length); i++) {
      const build = info.recentBuilds[i];
      const statusIcon = build.status === 'SUCCESS' ? `${colors.green}[OK]${colors.reset}` :
                         build.status === 'FAILURE' ? `${colors.red}[ERR]${colors.reset}` :
                         `${colors.yellow}⟳${colors.reset}`;

      const duration = formatDuration(build.duration);
      const time = formatShortDate(build.createTime);
      const trigger = build.triggerName === 'TRIGGER' ? `${colors.green}[T]${colors.reset}` : `${colors.gray}[M]${colors.reset}`;

      content.push(` ${i + 1}. ${statusIcon} ${build.id} (${duration}) ${build.commitSha} ${trigger} ${time}`);
    }

    content.push(` Console:       ${icons.link} ${createLink(info.consoleUrl, 'View Builds', 30)}`);

    console.log(`${colors.bright}${icons.cloudBuild} Cloud Build${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  async renderDocker(result) {
    const { data, status } = result;
    const content = [];

    if (status === 'error') {
      content.push(` Docker:        ${colors.red}ERR${colors.reset} (${result.error})`);
    } else {
      content.push(` Docker:        ${colors.green}OK${colors.reset} (v${data.version})`);
      content.push(' Running Containers:');
      content.push(data.containers || '   None');

      if (data.hasImage) {
        content.push(` Image:         ${colors.green}oncall-cat found${colors.reset}`);
      } else {
        content.push(` Image:         ${colors.red}oncall-cat missing${colors.reset}`);
      }
    }

    console.log(`${colors.bright}${icons.emojiWhale} Docker${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  async renderNode(result) {
    const { data, status } = result;
    const content = [];

    if (status === 'error') {
      content.push(` Node.js:       ${colors.red}ERR${colors.reset} (${result.error})`);
    } else {
      content.push(` Node.js:       ${colors.green}OK${colors.reset} (${data.nodeVersion}, npm ${data.npmVersion})`);
      if (data.depsOk) {
        content.push(' Dependencies:  OK');
      } else {
        content.push(` Dependencies:  ${colors.yellow}ERR${colors.reset}`);
      }
    }

    console.log(`${colors.bright}${icons.emojiNode} Node.js${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  async renderFilesystem(result) {
    const { data, status } = result;
    const content = [];

    if (status === 'error') {
      content.push(` Filesystem:    ${colors.red}ERR${colors.reset} (${result.error})`);
    } else {
      const allOk = Object.values(data.files).every(v => v);
      if (allOk) {
        content.push(` Filesystem:    ${colors.green}OK${colors.reset}`);
      } else {
        content.push(` Filesystem:    ${colors.yellow}WARN${colors.reset}`);
      }

      for (const [file, exists] of Object.entries(data.files)) {
        if (exists) {
          content.push(` ${file}:         ${colors.green}OK${colors.reset}`);
        } else {
          content.push(` ${file}:         ${colors.red}Missing${colors.reset}`);
        }
      }
    }

    console.log(`${colors.bright}${icons.filesystem} Filesystem${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  async renderPorts(result) {
    const { data, status } = result;
    const content = [];

    if (status === 'error') {
      content.push(` Port ${data?.port || 1987}:     ${colors.red}ERR${colors.reset} (${result.error})`);
    } else {
      if (data.inUse) {
        content.push(` Port ${data.port}:     ${colors.red}In use${colors.reset}`);
      } else {
        content.push(` Port ${data.port}:     ${colors.green}OK${colors.reset} (available)`);
      }
    }

    console.log(`${colors.bright}${icons.port} Ports${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  renderSummary(results) {
    const hasErrors = results.some(r => r.status === 'error');
    const hasWarnings = results.some(r => r.status === 'warn');

    if (!hasErrors && !hasWarnings) {
      console.log(`${colors.green}${icons.ok} All systems operational${colors.reset}`);
    } else {
      console.log(`${colors.yellow}${icons.warn} Some issues detected - review above${colors.reset}`);
    }
  }

  clear() {
    console.clear();
  }
}

export default TerminalRenderer;
