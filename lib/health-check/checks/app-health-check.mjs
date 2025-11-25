/**
 * @fileoverview Application health endpoint checker
 * @author Francisco Galindo
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { HealthChecker } from '../health-checker.mjs';
import icons from '../../ascii-icons.js';

const execAsync = promisify(exec);

/**
 * Application health endpoint checker
 */
export class AppHealthCheck extends HealthChecker {
  constructor(config = {}) {
    super('Application Health', config);
  }

  async check() {
    const { cli, flags } = this.config;

    if (cli?.dryRun) {
      return {
        status: 'ok',
        data: {
          health: {
            status: 'healthy',
            metrics: {
              messagesProcessed: 0,
              messagesCreated: 0,
              messagesUpdated: 0,
              successRate: '100%',
              messagesFailed: 0,
              apiTimeouts: 0,
              uptimeSeconds: 0,
            },
            buildTime: new Date().toISOString(),
            version: 'dry-run',
          },
          mappings: this.loadChannelMappings(),
          channelNames: {},
          dbTitles: {},
        },
        error: null,
      };
    }

    try {
      // Determine service URL
      let url = flags?.url;
      if (!url && flags?.target === 'local') {
        url = `http://localhost:${this.config.localPort || 1987}`;
      }
      if (!url && cli) {
        url = await this.gcloud(cli, `run services describe ${this.config.serviceName} --region=${this.config.region} --format='value(status.url)'`);
      }

      if (!url) {
        return {
          status: 'error',
          data: null,
          error: 'Missing service URL',
        };
      }

      // Fetch health endpoint
      const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
      const idToken = !isLocal && cli ? await this.getIdentityToken(cli) : null;
      const curlAuth = idToken
        ? `curl -s -H "Authorization: Bearer ${idToken}" "${url}/health"`
        : `curl -s "${url}/health"`;

      const res = await execAsync(curlAuth);
      const text = res.stdout?.trim() || '';

      if (!text) {
        return {
          status: 'error',
          data: null,
          error: 'Empty response from /health',
        };
      }

      if (text.startsWith('<') || /<html/i.test(text)) {
        return {
          status: 'error',
          data: null,
          error: 'Non-JSON response from /health (likely unauthenticated)',
        };
      }

      const health = JSON.parse(text);
      const mappings = this.loadChannelMappings();

      // Fetch channel names and database titles if available
      const allChannelIds = mappings.databases?.flatMap(db => db.channels.map(c => c.channelId)) || [];
      const allDbIds = [...new Set(mappings.databases?.map(db => db.databaseId) || [])];

      const channelNames = await this.fetchSlackChannelNames(allChannelIds);
      const dbTitles = await this.fetchNotionDatabaseTitles(allDbIds);

      return {
        status: health.status === 'healthy' ? 'ok' : 'warn',
        data: {
          health,
          mappings,
          channelNames,
          dbTitles,
          url,
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

  async getIdentityToken(cli) {
    if (cli?.dryRun) return 'dry-run-token';
    try {
      const res = await cli.run('gcloud auth print-identity-token');
      return (res.stdout || '').trim() || null;
    } catch {
      return null;
    }
  }

  loadChannelMappings() {
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

  async fetchSlackChannelNames(channelIds) {
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (!slackToken || channelIds.length === 0) return {};

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
        // Fallback to channel ID
      }
    }
    return channelNames;
  }

  async fetchNotionDatabaseTitles(databaseIds) {
    const notionToken = process.env.NOTION_TOKEN;
    if (!notionToken || databaseIds.length === 0) return {};

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

  isApplicable(target) {
    return true; // App health applies to all targets
  }

  getIcon() {
    return icons.app;
  }
}

export default AppHealthCheck;
