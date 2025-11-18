#!/usr/bin/env node
/**
 * @fileoverview Enhanced health check dashboard for On-Call Cat
 * Displays comprehensive health, configuration, and deployment status
 * @author Francisco Galindo
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import boxen from 'boxen';

const execAsync = promisify(exec);

// Read gcloud config with env fallback
async function getGcloudConfigValue(key) {
  try {
    const { stdout } = await execAsync(`gcloud config get-value ${key} --quiet 2>/dev/null`);
    const val = stdout.trim();
    if (!val || val === '(unset)') {
      return null;
    }
    return val;
  } catch {
    return null;
  }
}

// Configuration
const CONFIG = {
  projectId: null,
  region: null,
  serviceName: 'oncall-cat',
  pipelineName: 'oncall-cat-pipeline',
  refreshInterval: 30000, // 30 seconds default
  maxWidth: 78, // Terminal standard width (80 - 2 for margins)
  minWidth: 60,
};

// boxen handles ANSI codes automatically, no need for stripAnsi

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

// ASCII art icons for GCP services
const icons = {
  cloudRun: '[CR]',
  cloudDeploy: '[CD]',
  cloudBuild: '[CB]',
  app: '[APP]',
  git: '[GIT]',
  link: '->',
};

/**
 * Create terminal hyperlink (OSC 8) if supported
 * Falls back to truncated URL if not supported
 */
function createLink(url, text, maxLength = 30) {
  // Check if terminal supports hyperlinks (basic check)
  const supportsHyperlinks = process.env.TERM_PROGRAM === 'iTerm.app' || 
                             process.env.TERM_PROGRAM === 'vscode' ||
                             process.env.TERM_PROGRAM === 'WezTerm';
  
  if (supportsHyperlinks) {
    // OSC 8 hyperlink format
    return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
  }
  
  // Fallback: truncate URL
  return shortenUrl(url, maxLength);
}

/**
 * Shorten URL with smart truncation
 */
function shortenUrl(url, maxLength = 35) {
  if (url.length <= maxLength) {
    return url;
  }
  
  // Keep protocol and beginning, plus end
  const start = url.substring(0, 22);
  const end = url.substring(url.length - 10);
  return `${start}...${end}`;
}

// boxen handles all box drawing automatically

// CLI arguments
const args = process.argv.slice(2);
const flags = {
  verbose: args.includes('--verbose') || args.includes('-v'),
  json: args.includes('--json'),
  watch: args.includes('--watch') || args.includes('-w'),
  section: args.find(arg => arg.startsWith('--section='))?.split('=')[1] || null,
  interval: parseInt(args.find(arg => arg.startsWith('--interval='))?.split('=')[1] || CONFIG.refreshInterval),
  target: (args.find(a => a.startsWith('--target='))?.split('=')[1] || '').toLowerCase(),
  url: (args.find(a => a.startsWith('--url='))?.split('=')[1] || ''),
};

// Track whether we've rendered once in watch mode to reduce flicker
let HAS_RENDERED = false;

/**
 * Execute gcloud command and return parsed output
 */
async function gcloud(command) {
  try {
    const { stdout, stderr } = await execAsync(`gcloud ${command} 2>&1`);
    if (stderr && !stdout) {
      throw new Error(stderr);
    }
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Fetch application health from Cloud Run service
 */
async function getIdentityToken() {
  try {
    const { stdout } = await execAsync('gcloud auth print-identity-token');
    const token = (stdout || '').trim();
    return token || null;
  } catch {
    return null;
  }
}

async function fetchAppHealth(serviceUrl) {
  try {
    let url = serviceUrl || flags.url;
    // Local target override
    if (!url && flags.target === 'local') {
      url = 'http://localhost:1987';
    }
    if (!url) {
      url = await gcloud(
        `run services describe ${CONFIG.serviceName} --region=${CONFIG.region} --format='value(status.url)'`
      );
    }
    if (!url) {
      return { ok: false, error: 'Missing service URL' };
    }

    // Use identity token only for GCP/https URLs
    const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
    const idToken = !isLocal ? await getIdentityToken() : null;
    const curlAuth = idToken
      ? `curl -s -H "Authorization: Bearer ${idToken}" "${url}/health"`
      : `curl -s "${url}/health"`;
    const res = await execAsync(curlAuth);
    const text = res.stdout?.trim() || '';
    if (!text) {
      return { ok: false, error: 'Empty response from /health' };
    }
    if (text.startsWith('<') || /<html/i.test(text)) {
      if (!idToken) {
        const retryToken = await getIdentityToken();
        if (retryToken) {
          const retry = await execAsync(`curl -s -H "Authorization: Bearer ${retryToken}" "${url}/health"`);
          const retryText = retry.stdout?.trim() || '';
          if (retryText && !(retryText.startsWith('<') || /<html/i.test(retryText))) {
            return { ok: true, json: JSON.parse(retryText) };
          }
        }
      }
      return { ok: false, error: 'Non-JSON response from /health (likely unauthenticated). Try using an identity token.' };
    }
    return { ok: true, json: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Load channel mappings from local file
 */
function loadChannelMappings() {
  const mappingsPath = join(process.cwd(), 'channel-mappings.json');
  
  if (!existsSync(mappingsPath)) {
    return { databases: [] };
  }
  
  try {
    const content = readFileSync(mappingsPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return { databases: [] };
  }
}

/**
 * Fetch Slack channel names from API
 */
async function fetchSlackChannelNames(channelIds) {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) {
    return {};
  }
  
  const channelNames = {};
  
  for (const channelId of channelIds) {
    try {
      const { stdout } = await execAsync(
        `curl -s -H "Authorization: Bearer ${slackToken}" "https://slack.com/api/conversations.info?channel=${channelId}"`
      );
      const data = JSON.parse(stdout);
      if (data.ok && data.channel) {
        channelNames[channelId] = `#${data.channel.name}`;
      }
    } catch {
      // Fallback to mappings description
    }
  }
  
  return channelNames;
}

/**
 * Fetch Notion database titles
 */
async function fetchNotionDatabaseTitles(databaseIds) {
  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) {
    return {};
  }
  
  const dbTitles = {};
  
  for (const dbId of databaseIds) {
    try {
      const { stdout } = await execAsync(
        `curl -s -X GET "https://api.notion.com/v1/databases/${dbId}" ` +
        `-H "Authorization: Bearer ${notionToken}" ` +
        `-H "Notion-Version: 2022-06-28"`
      );
      const data = JSON.parse(stdout);
      if (data.title && data.title[0]) {
        dbTitles[dbId] = data.title[0].plain_text;
      }
    } catch {
      // Keep database ID as fallback
    }
  }
  
  return dbTitles;
}

/**
 * Fetch Cloud Run service details
 */
async function fetchCloudRunInfo() {
  try {
    const revision = await gcloud(
      `run services describe ${CONFIG.serviceName} --region=${CONFIG.region} --format='value(status.latestReadyRevisionName)'`
    );
    
    const revisionTime = await gcloud(
      `run revisions describe ${revision} --region=${CONFIG.region} --format='value(metadata.creationTimestamp)'`
    );
    
    const traffic = await gcloud(
      `run services describe ${CONFIG.serviceName} --region=${CONFIG.region} --format='json(status.traffic)'`
    );
    
    const resources = await gcloud(
      `run services describe ${CONFIG.serviceName} --region=${CONFIG.region} ` +
      `--format='value(spec.template.spec.containers[0].resources.limits.cpu, spec.template.spec.containers[0].resources.limits.memory)'`
    );
    
    const scaling = await gcloud(
      `run services describe ${CONFIG.serviceName} --region=${CONFIG.region} ` +
      `--format='value(spec.template.metadata.annotations.autoscaling\\.knative\\.dev/minScale, spec.template.metadata.annotations.autoscaling\\.knative\\.dev/maxScale)'`
    );
    
    const url = await gcloud(
      `run services describe ${CONFIG.serviceName} --region=${CONFIG.region} --format='value(status.url)'`
    );
    
    const [cpu, memory] = resources ? resources.split('\t') : ['unknown', 'unknown'];
    const [minScale, maxScale] = scaling ? scaling.split('\t') : ['1', '10'];
    
    return {
      revision,
      revisionTime,
      traffic: traffic ? JSON.parse(traffic) : [],
      cpu,
      memory,
      minScale: parseInt(minScale),
      maxScale: parseInt(maxScale),
      url,
      consoleUrl: `https://console.cloud.google.com/run/detail/${CONFIG.region}/${CONFIG.serviceName}?project=${CONFIG.projectId}`,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch Cloud Deploy pipeline status
 */
async function fetchCloudDeployInfo() {
  try {
    const releases = await gcloud(
      `deploy releases list --delivery-pipeline=${CONFIG.pipelineName} --region=${CONFIG.region} --limit=1 --format=json`
    );
    
    if (!releases) {
      return null;
    }
    
    const releaseData = JSON.parse(releases);
    const latestRelease = releaseData[0];
    
    if (!latestRelease) {
      return null;
    }
    
    const releaseName = latestRelease.name.split('/').pop();
    const createTime = latestRelease.createTime;
    const renderState = latestRelease.renderState;
    
    // Get rollout status for each target
    const rollouts = await gcloud(
      `deploy rollouts list --delivery-pipeline=${CONFIG.pipelineName} --region=${CONFIG.region} --release=${releaseName} --format=json`
    );
    
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
      consoleUrl: `https://console.cloud.google.com/deploy/delivery-pipelines/${CONFIG.region}/${CONFIG.pipelineName}?project=${CONFIG.projectId}`,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch recent Cloud Build history
 */
async function fetchCloudBuildInfo() {
  try {
    const builds = await gcloud(
      `builds list --limit=5 --format=json`
    );
    
    if (!builds) {
      return null;
    }
    
    const buildData = JSON.parse(builds);
    
    return {
      recentBuilds: buildData.map(build => ({
        id: build.id.substring(0, 8),
        status: build.status,
        createTime: build.createTime,
        duration: build.timing?.BUILD?.endTime && build.timing?.BUILD?.startTime
          ? (new Date(build.timing.BUILD.endTime) - new Date(build.timing.BUILD.startTime)) / 1000
          : null,
        commitSha: build.substitutions?.SHORT_SHA || 'unknown',
        triggerName: build.buildTriggerId ? 'TRIGGER' : 'MANUAL',
      })),
      consoleUrl: `https://console.cloud.google.com/cloud-build/builds?project=${CONFIG.projectId}`,
    };
  } catch {
    return null;
  }
}

/**
 * Get git information
 */
async function fetchGitInfo() {
  try {
    const { stdout: currentSha } = await execAsync('git rev-parse --short HEAD');
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD');
    const { stdout: commitTime } = await execAsync('git log -1 --format=%aI');
    const { stdout: status } = await execAsync('git status --porcelain');
    
    return {
      sha: currentSha.trim(),
      branch: currentBranch.trim(),
      commitTime: commitTime.trim(),
      hasUncommitted: status.trim().length > 0,
      githubUrl: `https://github.com/fgalindo7/slack-notion-sync-bot/commit/${currentSha.trim()}`,
    };
  } catch {
    return null;
  }
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}

/**
 * Format date in short format: MMM DD HH:MM
 */
function formatShortDate(isoString) {
  if (!isoString) {
    return 'unknown';
  }
  const date = new Date(isoString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const mins = String(date.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day} ${hours}:${mins}`;
}

/**
 * Format time ago (e.g., '5 minutes ago')
 */
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (seconds < 60) {
    return `${seconds} seconds ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} minutes ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)} hours ago`;
  }
  return `${Math.floor(seconds / 86400)} days ago`;
}

/**
 * Format duration
 */
function formatDuration(seconds) {
  if (!seconds) {
    return 'unknown';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/**
 * Draw a box using boxen with fixed width
 */
function drawBox(content, width = 60) {
  const text = Array.isArray(content) ? content.join('\n') : content;
  return boxen(text, {
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    margin: 0,
    borderStyle: 'round',
    borderColor: 'white',
    width: width,
  });
}

/**
 * Draw header using boxen with fixed width
 */
function drawHeader(title, width = 60) {
  return boxen(title, {
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    margin: 0,
    borderStyle: 'double',
    borderColor: 'white',
    textAlignment: 'center',
    width: width,
  });
}

/**
 * Render application health section
 */
async function renderAppHealth(health, mappings) {
  const content = [];
  
  // Status
  const statusIcon = health.status === 'healthy' ? `${colors.green}OK${colors.reset}` : `${colors.red}ERR${colors.reset}`;
  const statusText = health.status === 'healthy' ? `${colors.green}HEALTHY${colors.reset}` : `${colors.red}UNHEALTHY${colors.reset}`;
  content.push(` Status:        ${statusIcon} ${statusText}`);
  
  if (health.uptime) {
    content.push(` Uptime:        ${formatUptime(health.metrics?.uptimeSeconds || health.uptime)}`);
  }
  
  if (health.lastActivity) {
    content.push(` Last Activity: ${formatTimeAgo(health.lastActivity)}`);
  }
  
  content.push('');
  
  // Mode and channels
  const isMultiChannel = mappings.databases && mappings.databases.length > 0;
  const modeText = isMultiChannel ? `${colors.cyan}[MC] Multi-Channel${colors.reset}` : `${colors.blue}[SC] Single-Channel${colors.reset}`;
  content.push(` Mode:          ${modeText}`);
  
  if (isMultiChannel) {
    const totalChannels = mappings.databases.reduce((sum, db) => sum + db.channels.length, 0);
    content.push(` Channels:      ${colors.bright}${totalChannels}${colors.reset} channels configured`);
    
    // Fetch real channel names
    const allChannelIds = mappings.databases.flatMap(db => db.channels.map(c => c.channelId));
    const channelNames = await fetchSlackChannelNames(allChannelIds);
    
    // Fetch database titles
    const allDbIds = [...new Set(mappings.databases.map(db => db.databaseId))];
    const dbTitles = await fetchNotionDatabaseTitles(allDbIds);
    
    for (const db of mappings.databases) {
      const dbShort = db.databaseId.substring(0, 8) + '...' + db.databaseId.substring(db.databaseId.length - 4);
      const dbTitle = dbTitles[db.databaseId] || db.description || dbShort;
      
      for (const channel of db.channels) {
        const channelName = channelNames[channel.channelId] || channel.description || channel.channelId;
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
  
  return content;
}

/**
 * Render Cloud Run section
 */
function renderCloudRun(info) {
  const content = [];
  
  content.push(` Service:       ${colors.bright}${CONFIG.serviceName}${colors.reset}`);
  
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
  
  return content;
}

/**
 * Render Cloud Deploy section
 */
function renderCloudDeploy(info) {
  const content = [];
  
  content.push(` Pipeline:      ${colors.bright}${CONFIG.pipelineName}${colors.reset}`);
  
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
  
  const consoleUrl = `https://console.cloud.google.com/deploy/delivery-pipelines/${CONFIG.region}/${CONFIG.pipelineName}?project=${CONFIG.projectId}`;
  content.push(` Console:       ${icons.link} ${createLink(consoleUrl, 'View Pipeline', 30)}`);
  
  return content;
}

/**
 * Render Cloud Build section
 */
function renderCloudBuild(info) {
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
  
  const consoleUrl = `https://console.cloud.google.com/cloud-build/builds?project=${CONFIG.projectId}`;
  content.push(` Console:       ${icons.link} ${createLink(consoleUrl, 'View Builds', 30)}`);
  
  return content;
}

/**
 * Render Git/Version section
 */
function renderGitInfo(git, health) {
  const content = [];
  
  if (health.buildTime) {
    const deployedTime = formatShortDate(health.buildTime);
    content.push(` Deployed:      ${health.version || 'unknown'} @ ${deployedTime}`);
  }
  
  if (git) {
    const localTime = formatShortDate(git.commitTime);
    content.push(` Local:         ${git.sha} @ ${localTime}`);
    
    // Compare times
    if (health.buildTime) {
      const deployedEpoch = new Date(health.buildTime).getTime();
      const localEpoch = new Date(git.commitTime).getTime();
      const diff = Math.abs(deployedEpoch - localEpoch);
      
      if (diff < 60000) {
        content.push(` Status:        ${colors.green}[OK] Up to date${colors.reset}`);
      } else if (deployedEpoch < localEpoch) {
        const diffMin = Math.floor(diff / 60000);
        if (diffMin > 0) {
          content.push(` Status:        ${colors.yellow}! Local ahead (${diffMin}m)${colors.reset}`);
        } else {
          const diffSec = Math.floor(diff / 1000);
          content.push(` Status:        ${colors.yellow}! Local ahead (${diffSec}s)${colors.reset}`);
        }
      } else {
        content.push(` Status:        ${colors.yellow}! Deployed ahead${colors.reset}`);
      }
    }
    
    content.push(` Branch:        ${git.branch}`);
    
    if (git.hasUncommitted) {
      content.push(` ${colors.yellow}! Uncommitted changes${colors.reset}`);
    }
    
    content.push(` GitHub:        ${colors.blue}${icons.link} ${createLink(git.githubUrl, 'View Commit', 30)}${colors.reset}`);
  }
  
  return content;
}

/**
 * Main dashboard render
 */
async function renderDashboard() {
  // Clear screen only for single-run (non-watch) mode so watch scrolls naturally
  if (!flags.json && !flags.watch) {
    console.clear();
  }

  // ASCII art cat logo (only in dashboard mode)
  if (!flags.json) {
    const catLogo = [
      '       /\\_/\\  ',
      '      ( o.o ) ',
      '       > ^ <  ',
    ];

    // In watch mode, show the cat only on the first render to reduce flicker
    if (!flags.watch || !HAS_RENDERED) {
      console.log('');
      catLogo.forEach(line => console.log(`  ${colors.cyan}${line}${colors.reset}`));
    }
  }
  
  // Fetch all data
  const [healthRes, cloudRun, cloudDeploy, cloudBuild, git] = await Promise.all([
    fetchAppHealth(),
    fetchCloudRunInfo(),
    fetchCloudDeployInfo(),
    fetchCloudBuildInfo(),
    fetchGitInfo(),
  ]);
  const health = healthRes && healthRes.ok ? healthRes.json : { status: 'unhealthy', error: healthRes?.error || 'unknown' };
  
  const mappings = loadChannelMappings();
  
  // JSON output mode
  if (flags.json) {
    // Preserve existing JSON shape by returning the raw health fetch result
    console.log(JSON.stringify({ health: healthRes, cloudRun, cloudDeploy, cloudBuild, git, mappings }, null, 2));
    return;
  }
  
  // Draw header
  console.log(drawHeader('On-Call Cat - Health Check Dashboard'));
  console.log('');
  
  // Render sections (boxen handles all width calculations automatically)
  if (!flags.section || flags.section === 'app') {
    const content = await renderAppHealth(health, mappings);
    console.log(`${colors.bright}${icons.app} Application Health${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }
  
  if ((!flags.section || flags.section === 'run') && cloudRun) {
    const content = renderCloudRun(cloudRun);
    console.log(`${colors.bright}${icons.cloudRun} Cloud Run Service${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }
  
  if ((!flags.section || flags.section === 'deploy') && cloudDeploy) {
    const content = renderCloudDeploy(cloudDeploy);
    console.log(`${colors.bright}${icons.cloudDeploy} Cloud Deploy Pipeline${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }
  
  if ((!flags.section || flags.section === 'build') && cloudBuild) {
    const content = renderCloudBuild(cloudBuild);
    console.log(`${colors.bright}${icons.cloudBuild} Cloud Build${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }
  
  if ((!flags.section || flags.section === 'git') && git) {
    const content = renderGitInfo(git, health);
    console.log(`${colors.bright}${icons.git} Version Info${colors.reset}`);
    console.log(drawBox(content));
    console.log('');
  }
  
  // Summary
  const allHealthy = health?.status === 'healthy' && 
                     cloudRun && 
                     cloudDeploy?.renderState === 'SUCCEEDED';
  
  if (allHealthy) {
    console.log(`${colors.green}[OK] All systems operational${colors.reset}`);
  } else {
    console.log(`${colors.yellow}⚠️  Some issues detected - review above${colors.reset}`);
  }
  
  if (flags.watch) {
    console.log(`\n${colors.gray}Refreshing in ${flags.interval / 1000}s... (Ctrl+C to exit)${colors.reset}`);
  }

  HAS_RENDERED = true;
}

/**
 * Main execution
 */
async function main() {
  // Resolve project/region from gcloud first, then env, then defaults
  const gcProject = await getGcloudConfigValue('project');
  const gcRunRegion = await getGcloudConfigValue('run/region');
  const gcComputeRegion = await getGcloudConfigValue('compute/region');

  CONFIG.projectId = gcProject || process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || null;
  CONFIG.region = gcRunRegion || gcComputeRegion || process.env.REGION || 'us-central1';

  if (!CONFIG.projectId) {
    console.error(`${colors.red}Error: GCP project is not set in gcloud config and environment (GCP_PROJECT_ID/PROJECT_ID).${colors.reset}`);
    process.exit(1);
  }
  
  if (flags.watch) {
    // Watch mode - refresh periodically
    await renderDashboard();
    setInterval(renderDashboard, flags.interval);
  } else {
    // Single run
    await renderDashboard();
  }
}

main().catch(error => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
