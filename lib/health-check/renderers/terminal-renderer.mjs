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
      'Service Configuration': this.renderServiceConfiguration,
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
    const statusIcon = health.status === 'healthy' ? `${colors.green}${icons.ok}${colors.reset}` : `${colors.red}${icons.error}${colors.reset}`;
    const statusText = health.status === 'healthy' ? `${colors.green}Healthy${colors.reset}` : `${colors.red}Unhealthy${colors.reset}`;
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
    const localTime = formatShortDate(data.commitTime);

    // Consistent format for both local and GCP
    content.push(` Commit:        ${data.sha} @ ${localTime}`);
    content.push(` Branch:        ${data.branch}`);

    // Status line (consistent for both targets)
    const statusText = data.hasUncommitted
      ? `${colors.yellow}! Uncommitted changes${colors.reset}`
      : `${colors.green}${icons.ok} Clean${colors.reset}`;
    content.push(` Status:        ${statusText}`);

    // GitHub link (consistent hyperlink format for both targets)
    content.push(` GitHub:        ${icons.link} ${colors.white}${createLink(data.githubUrl, 'View Commit', 30)}${colors.reset}`);

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
    content.push('');

    if (info.url) {
      content.push(` URL:           ${icons.link} ${colors.white}${createLink(info.url, `View ${this.config.serviceName}`, 50)}${colors.reset}`);
    }

    content.push(` Console:       ${icons.link} ${colors.white}${createLink(info.consoleUrl, 'View in GCP Console', 30)}${colors.reset}`);

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
      content.push('');
    }

    content.push(` Console:       ${icons.link} ${colors.white}${createLink(info.consoleUrl, 'View Pipeline', 30)}${colors.reset}`);

    console.log(`${colors.bright}${icons.cloudDeploy} Cloud Deploy Pipeline${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  renderCloudBuild(info) {
    const content = [];

    content.push(` ${colors.bright}Recent Builds:${colors.reset}`);

    for (let i = 0; i < Math.min(3, info.recentBuilds.length); i++) {
      const build = info.recentBuilds[i];
      const statusIcon = build.status === 'SUCCESS' ? `${colors.green}${icons.ok}${colors.reset}` :
                         build.status === 'FAILURE' ? `${colors.red}${icons.error}${colors.reset}` :
                         `${colors.yellow}⟳${colors.reset}`;

      const duration = formatDuration(build.duration);
      const time = formatShortDate(build.createTime);
      const trigger = build.triggerName === 'TRIGGER' ? `${colors.green}[T]${colors.reset}` : `${colors.gray}[M]${colors.reset}`;

      content.push(`   ${i + 1}. ${statusIcon} ${build.id} (${duration}) ${build.commitSha} ${trigger} ${time}`);
    }
    content.push('');

    content.push(` Console:       ${icons.link} ${colors.white}${createLink(info.consoleUrl, 'View Builds', 30)}${colors.reset}`);

    console.log(`${colors.bright}${icons.cloudBuild} Cloud Build${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  async renderDocker(result) {
    const { data, status } = result;
    const content = [];

    if (status === 'error') {
      content.push(` Docker:        ${colors.red}${icons.error}${colors.reset} (${result.error})`);
    } else {
      content.push(` Docker:        ${colors.green}${icons.ok}${colors.reset} (v${data.version})`);
      content.push('');
      content.push(` ${colors.bright}Running Containers:${colors.reset}`);

      // Add proper indentation for container list (double padding)
      if (data.containers && data.containers !== 'None') {
        const containerLines = data.containers.split('\n');
        containerLines.forEach(line => {
          if (line.trim()) {
            content.push(`   ${line}`);
          }
        });
      } else {
        content.push('   None');
      }
      content.push('');

      if (data.hasImage) {
        content.push(` Image:         ${colors.green}${icons.ok} oncall-cat found${colors.reset}`);
      } else {
        content.push(` Image:         ${colors.red}${icons.error} oncall-cat missing${colors.reset}`);
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
      content.push(` Node.js:       ${colors.red}${icons.error}${colors.reset} (${result.error})`);
    } else {
      content.push(` Node.js:       ${colors.green}${icons.ok}${colors.reset} (${data.nodeVersion}, npm ${data.npmVersion})`);
      if (data.depsOk) {
        content.push(` Dependencies:  ${colors.green}${icons.ok} Installed${colors.reset}`);
      } else {
        content.push(` Dependencies:  ${colors.yellow}${icons.warn} Missing${colors.reset}`);
      }
    }

    console.log(`${colors.bright}${icons.emojiNode} Node.js${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  async renderServiceConfiguration(result) {
    const { data, status } = result;
    const content = [];

    if (status === 'error') {
      content.push(` Service Configuration:    ${colors.red}${icons.error}${colors.reset} (${result.error})`);
    } else {
      const allOk = Object.values(data.files).every(v => v);
      if (allOk) {
        content.push(` Service Configuration:    ${colors.green}${icons.ok} All files present${colors.reset}`);
      } else {
        content.push(` Service Configuration:    ${colors.yellow}${icons.warn} Some files missing${colors.reset}`);
      }
      content.push('');

      for (const [file, exists] of Object.entries(data.files)) {
        const paddedFile = file.padEnd(30);
        if (exists) {
          content.push(` ${paddedFile} ${colors.green}${icons.ok} Found${colors.reset}`);
        } else {
          content.push(` ${paddedFile} ${colors.red}${icons.error} Missing${colors.reset}`);
        }
      }
    }

    console.log(`${colors.bright}${icons.configs} Service Configuration${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  async renderPorts(result) {
    const { data, status } = result;
    const content = [];

    if (status === 'error') {
      content.push(` Port ${data?.port || 1987}:     ${colors.red}${icons.error}${colors.reset} (${result.error})`);
    } else {
      if (data.inUse) {
        if (data.isExpected) {
          // Port is in use by our service - this is good!
          const service = data.serviceName || data.processInfo || 'oncall-cat';
          content.push(` Port ${data.port}:     ${colors.green}${icons.ok} In use${colors.reset} (${service})`);
        } else {
          // Port is in use by something unexpected - warning!
          const process = data.processInfo ? ` by ${data.processInfo}` : '';
          content.push(` Port ${data.port}:     ${colors.yellow}${icons.warn} In use${process}${colors.reset}`);
        }
      } else {
        // Port is not in use - service might not be running
        content.push(` Port ${data.port}:     ${colors.yellow}${icons.warn} Not in use${colors.reset} (service may not be running)`);
      }
    }

    console.log(`${colors.bright}${icons.emojiPort} Ports${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }

  renderSummary(results) {
    const hasErrors = results.some(r => r.status === 'error');
    const hasWarnings = results.some(r => {
      if (r.status === 'warn') return true;

      // Check for specific warning conditions in data
      if (r.checker === 'Application Health' && r.data?.health?.metrics) {
        const successRate = parseFloat(r.data.health.metrics.successRate);
        if (successRate < 95 && successRate > 0) return true;
        if (r.data.health.metrics.messagesFailed > 0) return true;
        if (r.data.health.metrics.apiTimeouts > 0) return true;
      }

      if (r.checker === 'Git' && r.data?.hasUncommitted) {
        return true;
      }

      if (r.checker === 'Service Configuration' && r.data?.files) {
        return !Object.values(r.data.files).every(v => v);
      }

      if (r.checker === 'Node.js' && r.data?.depsOk === false) {
        return true;
      }

      if (r.checker === 'Docker' && r.data?.hasImage === false) {
        return true;
      }

      if (r.checker === 'Ports' && r.data) {
        // Only warn if port not in use (service not running) OR in use by unexpected process
        // If port is in use by our expected service, that's good - not a warning
        if (!r.data.inUse) {
          return true; // Service not running
        }
        if (r.data.inUse && !r.data.isExpected) {
          return true; // Port occupied by unexpected process
        }
        // If inUse && isExpected, that's good - no warning
      }

      return false;
    });

    if (!hasErrors && !hasWarnings) {
      console.log(`${colors.green}${icons.ok} All systems operational${colors.reset}`);
    } else if (hasErrors) {
      console.log(`${colors.red}${icons.error} Errors detected - review above${colors.reset}`);
    } else {
      console.log(`${colors.yellow}${icons.warn} Warnings detected - review above${colors.reset}`);
    }
  }

  clear() {
    console.clear();
  }
}

export default TerminalRenderer;
