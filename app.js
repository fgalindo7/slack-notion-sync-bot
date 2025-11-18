/**
 * @fileoverview Slack-Notion Sync Bot - Automatically tracks on-call issues from Slack to Notion
 * Listens for messages with specific triggers (@auto, @cat, @peepo) and creates/updates Notion pages
 * @author Francisco Galindo
 */

// app.js
import bolt from '@slack/bolt';              // Bolt is CJS; use default import
const { App, LogLevel } = bolt;
import { Client as Notion } from '@notionhq/client';
import { createLogger } from './lib/logger.js';
import pThrottle from 'p-throttle';
import pTimeout from 'p-timeout';
import http from 'http';
import { readFileSync } from 'fs';

// Read version from package.json
const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
const APP_VERSION = packageJson.version;
const BUILD_TIME = process.env.BUILD_TIME || 'unknown';

// Import local modules
import { getConfig, getDatabaseIdForChannel } from './lib/config.js';
import { NOTION_FIELDS, DEFAULTS, API_TIMEOUT, setDefaults, setApiTimeout } from './lib/constants.js';
import { parseAutoBlock, parseNeededByString, normalizeEmail, stripRichTextFormatting } from './lib/parser.js';
import { missingFields, typeIssues, getTrigger, suffixForTrigger } from './lib/validation.js';
import { BotMetrics } from './lib/metrics.js';
import { NotionSchemaCache } from './lib/schema-cache.js';

// Load and validate configuration
const config = getConfig();

// Apply configuration to constants
setDefaults(config.defaults);
setApiTimeout(config.api.timeout);

// Initialize structured logger (component child)
const logger = createLogger('app');

// Rate limiter for Notion API
const throttle = pThrottle({
  limit: config.api.rateLimitPerSecond,
  interval: 1000, // 1 second
  strict: true
});

/**
 * Wraps a promise with a timeout to prevent hanging operations
 * @param {Promise} promise - The promise to wrap
 * @param {number} [ms] - Timeout in milliseconds (defaults to config value)
 * @param {string} [operation='Operation'] - Description of the operation for error messages
 * @returns {Promise} Promise that rejects if timeout is exceeded
 */
const withTimeout = (promise, ms = config.api.timeout, operation = 'Operation') => {
  return pTimeout(promise, {
    milliseconds: ms,
    message: `${operation} timed out after ${ms}ms`
  });
};

// Initialize metrics tracking
const metrics = new BotMetrics();

const app = new App({
  token: config.slack.botToken,
  signingSecret: config.slack.signingSecret,
  socketMode: true,
  appToken: config.slack.appToken,
  logLevel: LogLevel.INFO
});

const notion = new Notion({ auth: config.notion.token });

// Throttled Notion API methods with timeout protection
const notionThrottled = {
  databases: {
    retrieve: throttle(async (params) => {
      logger.debug({ databaseId: params.database_id }, 'Notion API: databases.retrieve');
      return await withTimeout(
        notion.databases.retrieve(params),
        API_TIMEOUT,
        'Notion databases.retrieve'
      );
    }),
    query: throttle(async (params) => {
      logger.debug({ databaseId: params.database_id }, 'Notion API: databases.query');
      return await withTimeout(
        notion.databases.query(params),
        API_TIMEOUT,
        'Notion databases.query'
      );
    })
  },
  pages: {
    create: throttle(async (params) => {
      logger.debug({ databaseId: params.parent?.database_id }, 'Notion API: pages.create');
      return await withTimeout(
        notion.pages.create(params),
        API_TIMEOUT,
        'Notion pages.create'
      );
    }),
    update: throttle(async (params) => {
      logger.debug({ pageId: params.page_id }, 'Notion API: pages.update');
      return await withTimeout(
        notion.pages.update(params),
        API_TIMEOUT,
        'Notion pages.update'
      );
    })
  },
  users: {
    list: throttle(async (params) => {
      logger.debug('Notion API: users.list');
      return await withTimeout(
        notion.users.list(params),
        API_TIMEOUT,
        'Notion users.list'
      );
    })
  }
};

/**
 * Checks if an error is a transient Socket Mode disconnect that can be safely ignored
 * @param {Error} err - The error to check
 * @returns {boolean} True if the error is an explicit socket disconnect, false otherwise
 */
function isExplicitSocketDisconnect(err) {
  const msg = String(err && err.message || '');
  return msg.includes("Unhandled event 'server explicit disconnect'") || msg.includes('server explicit disconnect');
}
process.on('uncaughtException', (err) => {
  if (isExplicitSocketDisconnect(err)) {
    logger.warn({ error: err.message }, 'Ignoring transient Slack Socket Mode disconnect; library will reconnect');
    return; // do not crash
  }
  logger.fatal({ error: err.message, stack: err.stack }, 'Uncaught exception');
  // You can choose to exit here; keep alive to let Docker restart via healthcheck if needed.
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  if (isExplicitSocketDisconnect(err)) {
    logger.warn({ error: err.message }, 'Ignoring transient Slack Socket Mode disconnect (promise rejection)');
    return;
  }
  logger.fatal({ reason: err.message, stack: err.stack }, 'Unhandled promise rejection');
});

/**
 * Creates a new Notion page or updates an existing one with issue tracking data
 * Always writes Slack message timestamp and permalink for future lookups
 * @param {Object} params - Function parameters
 * @param {Object} params.parsed - Parsed issue data from parseAutoBlock()
 * @param {string} params.permalink - Slack message permalink URL
 * @param {string} params.slackTs - Slack message timestamp (unique identifier)
 * @param {string} params.reporterMention - Slack user mention string
 * @param {string|null} params.reporterNotionId - Notion user ID for reporter (if resolved)
 * @param {string} [params.pageId] - Existing Notion page ID to update (creates new if omitted)
 * @returns {Promise<Object>} Object with id and url of the created/updated Notion page
 * @throws {Error} Throws if Notion API call fails (including permission errors)
 */
async function createOrUpdateNotionPage({ parsed, permalink, slackTs, reporterMention, reporterNotionId, pageId, databaseId }) {
  const schema = await getSchema(databaseId);

  const props = {};
  setProp(props, NOTION_FIELDS.ISSUE, parsed.issue || '(no issue given)', schema);
  setProp(props, NOTION_FIELDS.PRIORITY, parsed.priority, schema);
  setProp(props, NOTION_FIELDS.HOW_TO_REPLICATE, parsed.replicate, schema);
  setProp(props, NOTION_FIELDS.CUSTOMER, parsed.customer, schema);
  const onepassEmail = normalizeEmail(parsed.onepass);
  setProp(props, NOTION_FIELDS.ONE_PASSWORD, onepassEmail, schema);
  setProp(props, NOTION_FIELDS.NEEDED_BY, parsed.needed, schema);
  // Reported by: respect actual Notion property type; write fallback to "Reported by (text)" when People cannot be set
  const reportedMeta = schema.byName[NOTION_FIELDS.REPORTED_BY.toLowerCase()];
  const reportedTextMeta = schema.byName[NOTION_FIELDS.REPORTED_BY_TEXT.toLowerCase()];
  if (reportedMeta) {
      if (reportedMeta.type === 'people') {
      if (reporterNotionId) {
        props[reportedMeta.name] = { people: [{ id: reporterNotionId }] };
      } else {
        // People field exists but we cannot resolve a Notion person. Do not write text here; instead use fallback text column if present.
        if (reportedTextMeta && reporterMention) {
          setProp(props, reportedTextMeta.name, reporterMention, schema);
        } else {
          logger.warn({ reporterMention }, "'Reported by' is People but reporterNotionId is missing; no 'Reported by (text)' fallback column found");
        }
      }
    } else {
      // Non-people field: store mention text via type-aware setProp
      if (reporterMention) {setProp(props, reportedMeta.name, reporterMention, schema);}
    }
  } else if (reportedTextMeta && reporterMention) {
    // If there is no 'Reported by' property but there is a fallback text column, set it
    setProp(props, reportedTextMeta.name, reporterMention, schema);
  }

  // Slack Message TS (preferred unique key)
  if (schema.slackTsProp) {
    if (schema.slackTsProp.type === 'number') {
      // Use integer seconds (ts before the dot) to keep it clean, or store full float
      const num = Number(String(slackTs).replace('.', '')); // full precision as integer
      props[schema.slackTsProp.name] = { number: Number.isFinite(num) ? num : undefined };
    } else {
      props[schema.slackTsProp.name] = { rich_text: [{ type: 'text', text: { content: String(slackTs) } }] };
    }
  }

  // Slack Message URL (secondary key)
  if (schema.slackUrlProp) {
    if (schema.slackUrlProp.type === 'url') {
      props[schema.slackUrlProp.name] = { url: permalink };
    } else {
      props[schema.slackUrlProp.name] = { rich_text: [{ type: 'text', text: { content: permalink } }] };
    }
  }

  // Relevant Links: URL (first) or all links as rich_text
  if (schema.byName[NOTION_FIELDS.RELEVANT_LINKS.toLowerCase()]) {
    const meta = schema.byName[NOTION_FIELDS.RELEVANT_LINKS.toLowerCase()];
    if (meta.type === 'url') {
      if (parsed.urls?.[0]) {props[NOTION_FIELDS.RELEVANT_LINKS] = { url: parsed.urls[0] };}
    } else {
      if (parsed.linksText) {props[NOTION_FIELDS.RELEVANT_LINKS] = { rich_text: [{ type: 'text', text: { content: parsed.linksText } }] };}
    }
  }

  try {
    if (pageId) {
      const upd = await notionThrottled.pages.update({ page_id: pageId, properties: props });
      return { id: upd.id, url: upd.url };
    } else {
      const created = await notionThrottled.pages.create({ parent: { database_id: databaseId }, properties: props });
      return { id: created.id, url: created.url };
    }
  } catch (err) {
    // rethrow so caller can decide how to notify
    throw err;
  }
}

/**
 * Finds an existing Notion page for a Slack message
 * Searches first by Slack timestamp (preferred), then by permalink as fallback
 * @param {Object} params - Function parameters
 * @param {string} params.slackTs - Slack message timestamp
 * @param {string} params.permalink - Slack message permalink URL
 * @returns {Promise<Object|null>} Notion page object if found, null otherwise
 */
async function findPageForMessage({ slackTs, permalink, databaseId }) {
  const schema = await getSchema(databaseId);

  // 1) Try by TS (exact)
  if (schema.slackTsProp) {
    let tsFilter;
    if (schema.slackTsProp.type === 'number') {
      const num = Number(String(slackTs).replace('.', ''));
      tsFilter = { property: schema.slackTsProp.name, number: { equals: num } };
    } else {
      tsFilter = { property: schema.slackTsProp.name, rich_text: { equals: String(slackTs) } };
    }
    const byTs = await notionThrottled.databases.query({ database_id: databaseId, filter: tsFilter, page_size: 1 });
    if (byTs.results?.[0]) {return byTs.results[0];}
  }

  // 2) Fall back to permalink
  if (schema.slackUrlProp && permalink) {
    const urlFilter = schema.slackUrlProp.type === 'url'
      ? { property: schema.slackUrlProp.name, url: { equals: permalink } }
      : { property: schema.slackUrlProp.name, rich_text: { contains: permalink } };
    const byUrl = await notionThrottled.databases.query({ database_id: databaseId, filter: urlFilter, page_size: 1 });
    if (byUrl.results?.[0]) {return byUrl.results[0];}
  }

  return null;
}

/**
 * Posts a Slack message indicating missing required fields
 * @param {Object} params - Function parameters
 * @param {Object} params.client - Slack Web API client
 * @param {string} params.channel - Slack channel ID
 * @param {string} params.ts - Message timestamp (for threading)
 * @param {string[]} params.fields - Array of missing field names
 * @param {string} [params.suffix=''] - Optional emoji suffix to append
 * @returns {Promise<void>}
 */
async function replyMissing({ client, channel, ts, fields, suffix = '' }) {
  const lines = fields.map(f => `• ${f}`).join('\n');
  const text =
    `❗ *Missing Required Fields*\n\n` +
    `The following fields are required:\n${lines}\n\n` +
    `*How to fix:* Edit your original message and add the missing fields.\n` +
    `Keep the trigger at the top (@auto).\n\n` +
    `Example:\n` +
    `\`\`\`\n` +
    `@auto\n` +
    `Priority: P1\n` +
    `Issue: Production API timeout\n` +
    `How to replicate: Try checking out\n` +
    `Customer: Acme Corp\n` +
    `1Password: oncall@company.com\n` +
    `Needed by: 11/08/2025 5PM\n` +
    `Relevant Links: https://status.example.com\n` +
    `\`\`\`\n` +
    `I'll automatically detect your edit and create the Notion page! 🚀`;
  await client.chat.postMessage({ channel, thread_ts: ts, text: text + suffix });
}

/**
 * Posts a Slack message indicating field format/validation errors
 * @param {Object} params - Function parameters
 * @param {Object} params.client - Slack Web API client
 * @param {string} params.channel - Slack channel ID
 * @param {string} params.ts - Message timestamp (for threading)
 * @param {string[]} params.issues - Array of validation error messages
 * @param {string} [params.suffix=''] - Optional emoji suffix to append
 * @returns {Promise<void>}
 */
async function replyInvalid({ client, channel, ts, issues, suffix = '' }) {
  const text =
    `❗ *Format Validation Failed*\n\n` +
    issues.map(issue => {
      // Check if issue already has bullet formatting
      if (issue.includes('\n')) {
        return issue; // Multi-line issues are already formatted
      }
      return `• ${issue}`;
    }).join('\n\n') +
    `\n\n*How to fix:* Edit your original message with the correct format. I'll automatically detect the edit and retry! 🔄`;
  await client.chat.postMessage({ channel, thread_ts: ts, text: text + suffix });
}

/**
 * Posts a success message when a new Notion page is created
 * @param {Object} params - Function parameters
 * @param {Object} params.client - Slack Web API client
 * @param {string} params.channel - Slack channel ID
 * @param {string} params.ts - Message timestamp (for threading)
 * @param {string} params.pageUrl - URL of the created Notion page
 * @param {Object} params.parsed - Parsed message data (for issue title)
 * @param {string} [params.suffix=''] - Optional emoji suffix to append
 * @param {string} params.databaseId - Notion database ID (for schema lookup)
 * @returns {Promise<void>}
 */
async function replyCreated({ client, channel, ts, pageUrl, parsed, suffix = '', databaseId }) {
  const schema = getSchemaCache(databaseId).getCurrent();
  const dbPart = schema?.dbUrl ? `<${schema.dbUrl}|${schema.dbTitle || DEFAULTS.DB_TITLE}>` : 'Notion DB';
  const pagePart = `<${pageUrl}|${parsed?.issue || 'Notion Page'}>`;
  const text = `✅ Tracked: ${dbPart} › ${pagePart}` + suffix;
  await client.chat.postMessage({ channel, thread_ts: ts, text });
}

/**
 * Posts a success message when a Notion page is updated
 * @param {Object} params - Function parameters
 * @param {Object} params.client - Slack Web API client
 * @param {string} params.channel - Slack channel ID
 * @param {string} params.ts - Message timestamp (for threading)
 * @param {string} params.pageUrl - URL of the updated Notion page
 * @param {Object} params.parsed - Parsed message data (for issue title)
 * @param {string} [params.suffix=''] - Optional emoji suffix to append
 * @param {string} params.databaseId - Notion database ID (for schema lookup)
 * @returns {Promise<void>}
 */
async function replyUpdated({ client, channel, ts, pageUrl, parsed, suffix = '', databaseId }) {
  const schema = getSchemaCache(databaseId).getCurrent();
  const dbPart = schema?.dbUrl ? `<${schema.dbUrl}|${schema.dbTitle || DEFAULTS.DB_TITLE}>` : 'Notion DB';
  const pagePart = `<${pageUrl}|${parsed?.issue || 'Notion Page'}>`;
  const text = `🔄 Updated: ${dbPart} › ${pagePart}` + suffix;
  await client.chat.postMessage({ channel, thread_ts: ts, text });
}

// --- Bolt error handler (middleware/runtime) ---
app.error(async (error) => {
  if (isExplicitSocketDisconnect(error)) {
    logger.warn({ error: error.message }, 'Bolt reported explicit Socket Mode disconnect; continuing');
    return;
  }
  logger.error({ error: error.message, stack: error.stack }, 'Bolt app error');
});

/**
 * Checks if an error is a Notion permission/access error
 * @param {Error} err - The error to check
 * @returns {boolean} True if the error indicates insufficient Notion permissions
 */
function isNotionPermError(err) {
  // Notion returns APIResponseError with code 'restricted_resource' and 403
  return !!err && (err.code === 'restricted_resource' || err.status === 403);
}

/**
 * Posts a Slack message with instructions to fix Notion permission issues
 * @param {Object} params - Function parameters
 * @param {Object} params.client - Slack Web API client
 * @param {string} params.channel - Slack channel ID
 * @param {string} params.ts - Message timestamp (for threading)
 * @param {string} [params.suffix=''] - Optional emoji suffix to append
 * @param {string} params.databaseId - Notion database ID (for schema lookup)
 * @returns {Promise<void>}
 */
async function notifyNotionPerms({ client, channel, ts, suffix = '', databaseId }) {
  const schema = getSchemaCache(databaseId).getCurrent();
  const dbPart = schema?.dbUrl ? `<${schema.dbUrl}|${schema.dbTitle || DEFAULTS.DB_TITLE}>` : 'the Notion database';
  const text =
    `❗ I couldn't write to Notion due to *insufficient permissions*.\n` +
    `Please make sure your Notion integration is connected to ${dbPart} with *Can edit* access:\n` +
    `- In Notion, open the database as a full page → *Share* → *Add connection* → select this integration → *Allow*.\n` +
    `- Then try your message again (or edit the same message).` + suffix;
  try {
    await client.chat.postMessage({ channel, thread_ts: ts, text });
  } catch {
    // Ignore secondary errors when posting to thread
  }
}

/**
 * Handles new Slack messages and message edits
 * Processes messages with trigger words (@auto/@cat/@peepo) and creates/updates Notion pages
 * @param {Object} params - Event parameters from Slack Bolt
 * @param {Object} params.event - Slack message event
 * @param {Object} params.client - Slack Web API client
 * @returns {Promise<void>}
 */
app.event('message', async ({ event, client }) => {
  const startTime = Date.now();
  try {
    // Update last activity time for health check
    lastActivityTime = Date.now();
    
    // Log inbound event summary at info for live diagnostics
    logger.info({
      type: 'message',
      subtype: event.subtype || null,
      channel: event.channel || null,
      thread_ts: event.thread_ts || null,
      ts: event.ts || null,
      user: event.user || null,
      hasText: !!event.text,
      hasInnerMessage: !!event.message
    }, 'Inbound Slack event');

    // Ignore most non-user-generated subtypes; allow edits, thread broadcasts, and thread replies
    if (event.subtype) {
      const allowed = new Set(['message_changed', 'thread_broadcast', 'message_replied']);
      if (!allowed.has(event.subtype)) {
        logger.info({ subtype: event.subtype, channel: event.channel }, 'Skipping unsupported message subtype');
        return;
      }
    }
    
    // Check if this channel is monitored and get its database ID
    const databaseId = getDatabaseIdForChannel(event.channel);
    if (!databaseId) {
      logger.info({ channel: event.channel }, 'Ignoring event: channel not monitored');
      return;
    }

    // Handle edits (message_changed) separately
    if (event.subtype === 'message_changed') {
      await handleEdit({ event, client, databaseId });
      return;
    }

    // Normalize message fields for fresh message path (supports message_replied)
    const effective = event.subtype === 'message_replied' && event.message ? event.message : event;
    const text = effective.text || '';
    const ts = effective.ts || event.ts;
    const thread_ts = effective.thread_ts || event.thread_ts;
    const user = effective.user || event.user;

    // Fresh message path
    const trigger = getTrigger(text);
    if (!trigger) { return; }
    const suffix = suffixForTrigger(trigger);
    const isTop = !(thread_ts && thread_ts !== ts);
    if (!config.slack.allowThreads && !isTop) {
      logger.info({ channel: event.channel, ts, thread_ts }, 'Ignoring threaded message because allowThreads=false');
      return;
    }

    metrics.increment('messagesProcessed');
    logger.info({ 
      trigger, 
      channel: event.channel, 
      user,
      metricsTotal: metrics.get('messagesProcessed')
    }, 'Processing message');

    const parsed = parseAutoBlock(text || '');
    const miss = missingFields(parsed);
    const issues = typeIssues(parsed);

    const { permalink = '' } = await withTimeout(
      client.chat.getPermalink({
        channel: event.channel,
        message_ts: ts
      }).then(r => r || {}),
      API_TIMEOUT,
      'Slack getPermalink'
    );

    if (miss.length) {
      metrics.increment('validationErrors');
      logger.warn({ missingFields: miss, channel: event.channel }, 'Validation failed: missing fields');
      await replyMissing({ client, channel: event.channel, ts, fields: miss, suffix });
      return;
    }

    if (issues.length) {
      metrics.increment('validationErrors');
      logger.warn({ issues, channel: event.channel }, 'Validation failed: type issues');
      await replyInvalid({ client, channel: event.channel, ts, issues, suffix });
      return;
    }

    const { mention: reporterMention, notionId: reporterNotionId } = await resolveNotionPersonForSlackUser(user, client);

    // Use TS-based lookup to avoid duplicates, then upsert (write TS + permalink)
    const existing = await findPageForMessage({ slackTs: ts, permalink, databaseId });
    const isUpdate = !!existing;
    
    try {
      const { url } = await createOrUpdateNotionPage({
        parsed,
        permalink,
        slackTs: ts,
        reporterMention,
        reporterNotionId,
        pageId: existing?.id,
        databaseId
      });
      
      const processingTime = Date.now() - startTime;
      if (isUpdate) {
        metrics.increment('messagesUpdated');
        logger.info({ 
          pageUrl: url, 
          processingTime,
          metricsUpdated: metrics.get('messagesUpdated')
        }, 'Notion page updated');
      } else {
        metrics.increment('messagesCreated');
        logger.info({ 
          pageUrl: url, 
          processingTime,
          metricsCreated: metrics.get('messagesCreated')
        }, 'Notion page created');
      }
      
      await replyCreated({ client, channel: event.channel, ts, pageUrl: url, parsed, suffix, databaseId });
    } catch (err) {
      if (isNotionPermError(err)) {
        await notifyNotionPerms({ client, channel: event.channel, ts, suffix, databaseId });
        return;
      }
      if (err.name === 'TimeoutError') {
        metrics.increment('apiTimeouts');
        metrics.increment('messagesFailed');
        logger.error({ 
          error: err.message, 
          channel: event.channel, 
          ts,
          metricsTimeouts: metrics.get('apiTimeouts')
        }, 'API timeout');
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: ts,
          text: `⚠️ Request timed out. Please try again in a moment.${suffix}`
        }).catch(() => {}); // Ignore errors in error handler
        return;
      }
      throw err; // let outer handler log other errors
    }
  } catch (err) {
    metrics.increment('messagesFailed');
    logger.error({ 
      error: err.message, 
      stack: err.stack,
      channel: event.channel,
      ts: event.ts,
      metricsFailed: metrics.get('messagesFailed')
    }, 'Message handler error');
  }
});

/**
 * Handles edits to previously posted messages
 * Updates the corresponding Notion page when a tracked message is edited
 * @param {Object} params - Function parameters
 * @param {Object} params.event - Slack message_changed event
 * @param {Object} params.client - Slack Web API client
 * @param {string} params.databaseId - Notion database ID for this channel
 * @returns {Promise<void>}
 */
async function handleEdit({ event, client, databaseId }) {
  const startTime = Date.now();
  // Slack edit payload:
  // event.message.text = new text
  // event.previous_message.ts = original ts
  // event.channel = channel id
  const newMsg = event.message || {};
  const orig = event.previous_message || {};
  const channel = event.channel;
  const origTs = orig.ts || newMsg.ts; // fallback

  // Optional: enforce top-level only (ignore thread replies)
  if (!config.slack.allowThreads && newMsg.thread_ts && newMsg.thread_ts !== newMsg.ts) { 
    return; 
  }
  const trigger = getTrigger(newMsg.text);
  if (!trigger) { 
    return; 
  }
  const suffix = suffixForTrigger(trigger);

  metrics.increment('messagesProcessed');
  logger.info({ 
    trigger, 
    channel, 
    type: 'edit',
    metricsTotal: metrics.get('messagesProcessed')
  }, 'Processing message edit');

  const parsed = parseAutoBlock(newMsg.text || '');
  const miss = missingFields(parsed);
  const issues = typeIssues(parsed);

  const { permalink = '' } = await withTimeout(
    client.chat.getPermalink({
      channel,
      message_ts: origTs
    }).then(r => r || {}),
    API_TIMEOUT,
    'Slack getPermalink'
  );

  if (miss.length) {
    metrics.increment('validationErrors');
    logger.warn({ missingFields: miss, channel }, 'Edit validation failed: missing fields');
    await replyMissing({ client, channel, ts: origTs, fields: miss, suffix });
    return;
  }

  if (issues.length) {
    metrics.increment('validationErrors');
    logger.warn({ issues, channel }, 'Edit validation failed: type issues');
    await replyInvalid({ client, channel, ts: origTs, issues, suffix });
    return;
  }
  const { mention: reporterMention, notionId: reporterNotionId } = await resolveNotionPersonForSlackUser(newMsg.user, client);

  // Find by Slack TS first (canonical key), fall back to permalink
  const existing = await findPageForMessage({ slackTs: origTs, permalink, databaseId });
  try {
    const { url } = await createOrUpdateNotionPage({
      parsed,
      permalink,
      slackTs: origTs,
      reporterMention,
      reporterNotionId,
      pageId: existing?.id,
      databaseId
    });
    
    const processingTime = Date.now() - startTime;
    metrics.increment('messagesUpdated');
    logger.info({ 
      pageUrl: url, 
      processingTime,
      type: 'edit',
      metricsUpdated: metrics.get('messagesUpdated')
    }, 'Notion page updated from edit');
    
    await replyUpdated({ client, channel, ts: origTs, pageUrl: url, parsed, suffix, databaseId });
  } catch (err) {
    if (isNotionPermError(err)) {
      await notifyNotionPerms({ client, channel, ts: origTs, suffix, databaseId });
      return;
    }
    if (err.name === 'TimeoutError') {
      metrics.increment('apiTimeouts');
      metrics.increment('messagesFailed');
      logger.error({ 
        error: err.message, 
        channel, 
        ts: origTs,
        type: 'edit',
        metricsTimeouts: metrics.get('apiTimeouts')
      }, 'API timeout on edit');
      await client.chat.postMessage({
        channel,
        thread_ts: origTs,
        text: `⚠️ Request timed out. Please try editing again in a moment.${suffix}`
      }).catch(() => {}); // Ignore errors in error handler
      return;
    }
    throw err;
  }
}

/** 
 * Cached Notion database schema information
 * Map of database ID to schema cache
 * @type {Map<string, NotionSchemaCache>}
 */
const schemaCaches = new Map();
const SCHEMA_CACHE_TTL = parseInt(process.env.SCHEMA_CACHE_TTL || '3600000', 10);

/**
 * Gets or creates a schema cache for a specific database
 * @param {string} databaseId - Notion database ID
 * @returns {NotionSchemaCache} Schema cache instance for the database
 */
function getSchemaCache(databaseId) {
  if (!schemaCaches.has(databaseId)) {
    schemaCaches.set(databaseId, new NotionSchemaCache({ 
      ttl: SCHEMA_CACHE_TTL, 
      logger 
    }));
  }
  return schemaCaches.get(databaseId);
}

/**
 * Loads the Notion database schema for a specific database
 * Discovers property types and identifies Slack message tracking columns
 * @param {string} databaseId - Notion database ID
 * @returns {Promise<Object>} Schema object with property mappings and database metadata
 * @throws {Error} If required tracking columns (Slack Message URL or Slack Message TS) are not found
 */
async function loadSchemaFromNotion(databaseId) {
  const db = await notionThrottled.databases.retrieve({ database_id: databaseId });
  const byName = {};
  for (const [name, def] of Object.entries(db.properties || {})) {
    byName[name.toLowerCase()] = { id: def.id, name, type: def.type, options: def.select?.options || [] };
  }

  // Find Slack permalink property by common names (URL or Text)
  const permalinkCandidates = [
    'slack message url',
    'slack url',
    'slack message link',
    'slack permalink',
    'message url'
  ];
  let slackUrlProp = null;
  for (const n of permalinkCandidates) {if (byName[n]) { slackUrlProp = byName[n]; break; }}

  // Find Slack TS by common names (Text or Number)
  const tsCandidates = [
    'slack message ts',
    'slack ts',
    'message ts'
  ];
  let slackTsProp = null;
  for (const n of tsCandidates) {if (byName[n]) { slackTsProp = byName[n]; break; }}

  if (!slackUrlProp && !slackTsProp) {
    throw new Error(
      `Notion DB: add a permalink column (URL or Text) named "${NOTION_FIELDS.SLACK_MESSAGE_URL}" ` +
      `or a TS column (Text or Number) named "${NOTION_FIELDS.SLACK_MESSAGE_TS}".`
    );
  }

  const dbTitle = (db.title && db.title[0] && db.title[0].plain_text) ? db.title[0].plain_text : DEFAULTS.DB_TITLE;
  return { byName, slackUrlProp, slackTsProp, dbUrl: db.url, dbTitle };
}

/**
 * Gets the current schema for a database, loading or refreshing if necessary
 * Uses NotionSchemaCache for automatic TTL-based refresh
 * @param {string} databaseId - Notion database ID
 * @returns {Promise<Object>} Current schema object
 */
async function getSchema(databaseId) {
  const cache = getSchemaCache(databaseId);
  try {
    return await cache.get(() => loadSchemaFromNotion(databaseId));
  } catch (err) {
    logger.error({ error: err.message, databaseId }, 'Failed to load schema');
    // If we have a cached version (even if expired), return it
    const cached = cache.getCurrent();
    if (cached) {
      logger.warn({ databaseId }, 'Using stale cached schema due to load failure');
      return cached;
    }
    throw err;
  }
}

/**
 * Finds a Notion user ID by email address
 * Iterates through all Notion workspace users to find a matching email
 * @param {string} email - Email address to search for
 * @returns {Promise<string|null>} Notion user ID if found, null otherwise
 */
async function findNotionUserIdByEmail(email) {
  if (!email) {return null;}
  let cursor;
  while (true) {
    const res = await notionThrottled.users.list(cursor ? { start_cursor: cursor } : {});
    for (const u of res.results || []) {
      if (u.type === 'person' && u.person?.email && u.person.email.toLowerCase() === email.toLowerCase()) {
        return u.id;
      }
    }
    if (!res.has_more) {break;}
    cursor = res.next_cursor;
  }
  return null;
}

/**
 * Resolves a Slack user to a Notion user ID and mention string
 * Looks up the Slack user's email and finds the corresponding Notion user
 * @param {string} slackUserId - Slack user ID
 * @param {Object} client - Slack Web API client
 * @returns {Promise<Object>} Object with mention string and notionId
 * @returns {string} returns.mention - Slack mention format (<@USER_ID>)
 * @returns {string|null} returns.notionId - Notion user ID if resolved, null otherwise
 */
async function resolveNotionPersonForSlackUser(slackUserId, client) {
  try {
    if (!slackUserId) {return { mention: '', notionId: null };}
    const info = await withTimeout(
      client.users.info({ user: slackUserId }),
      API_TIMEOUT,
      'Slack users.info'
    );
    const email = info?.user?.profile?.email || null;
    const mention = `<@${slackUserId}>`;
    if (!email) {
      return { mention, notionId: null };
    } // requires users:read.email; fallback to mention text
    const notionId = await findNotionUserIdByEmail(email);
    return { mention, notionId };
  } catch {
    // On any failure, return mention only
    return { mention: slackUserId ? `<@${slackUserId}>` : '', notionId: null };
  }
}

/**
 * Sets a property on a Notion page properties object
 * Automatically converts values to the appropriate format for each property type
 * Strips rich text formatting (* and _) from all fields except "Reported by (text)"
 * @param {Object} props - Properties object to modify
 * @param {string} name - Property name
 * @param {*} value - Value to set (will be converted based on property type)
 * @param {Object} schema - The schema object containing property metadata
 * @returns {void}
 */
function setProp(props, name, value, schema) {
  if (value === undefined || value === null) {return;}
  const meta = schema?.byName[name.toLowerCase()];
  if (!meta) {return;}

  const toStr = (v) => (v instanceof Date ? v.toISOString() : String(v));
  
  // Strip rich text formatting for all fields except "Reported by (text)"
  const shouldStripFormatting = name.toLowerCase() !== NOTION_FIELDS.REPORTED_BY_TEXT.toLowerCase();
  const processValue = (v) => {
    const str = toStr(v);
    return shouldStripFormatting ? stripRichTextFormatting(str) : str;
  };

  switch (meta.type) {
    case 'title':
      props[name] = { title: [{ type: 'text', text: { content: processValue(value) } }] };
      break;
    case 'rich_text':
      props[name] = { rich_text: [{ type: 'text', text: { content: processValue(value) } }] };
      break;
    case 'select':
      props[name] = { select: { name: processValue(value) } };
      break;
    case 'date': {
      let dt = null;
      if (value instanceof Date && !isNaN(value)) {
        dt = value;
      } else if (typeof value === 'string') {
        dt = parseNeededByString(value);
        if (!dt || isNaN(dt)) {dt = new Date(value);}
      }
      if (dt && !isNaN(dt)) {
        props[name] = { date: { start: dt.toISOString() } };
      }
      // If parsing failed, skip setting this property to avoid crashes.
      break;
    }
    case 'url':
      props[name] = { url: processValue(value) };
      break;
    case 'number':
      props[name] = { number: typeof value === 'number' ? value : Number(value) };
      break;
    case 'email':
      props[name] = { email: processValue(value) };
      break;
    default:
      // Fallback to rich_text
      props[name] = { rich_text: [{ type: 'text', text: { content: processValue(value) } }] };
  }
}

/**
 * Gracefully shuts down the application
 * Stops the Bolt app and cleans up resources
 * @param {string} signal - The signal that triggered shutdown (SIGTERM, SIGINT, etc.)
 * @returns {Promise<void>}
 */
async function gracefulShutdown(signal) {
  logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');
  
  try {
    // Mark as unhealthy
    isHealthy = false;
    
    // Stop health check server
    healthServer.close(() => {
      logger.info('Health check server closed');
    });
    
    // Stop accepting new events from Slack
    await app.stop();
    logger.info('Slack Bolt app stopped successfully');
    
    // Give any in-flight requests a moment to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    logger.info({ signal }, 'Graceful shutdown completed');
    process.exit(0);
  } catch (err) {
    logger.error({ error: err.message, signal }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * Health check state
 * Tracks whether the bot is ready and healthy
 */
let isHealthy = false;
let lastActivityTime = Date.now();

/**
 * Simple HTTP health check endpoint
 * Returns 200 if the bot is connected and healthy, 503 otherwise
 */
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    const now = Date.now();
    const timeSinceActivity = now - lastActivityTime;
    const uptime = process.uptime();
    
    // Bot is healthy if Slack Socket Mode connection is established
    // Message activity is not required - bot can be idle waiting for messages
    if (isHealthy) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'healthy', 
        version: APP_VERSION,
        buildTime: BUILD_TIME,
        uptime,
        lastActivity: new Date(lastActivityTime).toISOString(),
        idleTimeSeconds: Math.floor(timeSinceActivity / 1000),
        metrics: metrics.toJSON()
      }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'unhealthy',
        version: APP_VERSION,
        buildTime: BUILD_TIME,
        reason: 'not_ready',
        uptime,
        metrics: metrics.toJSON()
      }));
    }
  } else if (req.url === '/metrics') {
    // Dedicated metrics endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics.toJSON(), null, 2));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// Startup
(async () => {
  // Load schemas for all configured databases
  const channelMappings = config.notion.channelMappings || [];
  if (channelMappings.length === 0) {
    logger.warn('No channel-to-database mappings configured. Bot will not monitor any channels.');
  }
  
  for (const mapping of channelMappings) {
    try { 
      await getSchema(mapping.databaseId);
      logger.info({ 
        databaseId: mapping.databaseId, 
        channelId: mapping.channelId 
      }, 'Notion schema loaded successfully');
    } catch (e) { 
      logger.error({ 
        error: e.message, 
        databaseId: mapping.databaseId,
        channelId: mapping.channelId
      }, 'Failed to load Notion schema');
    }
  }
  
  await app.start(config.server.port);
  isHealthy = true; // Mark as healthy after successful Slack connection
  logger.info({ port: config.server.port, mode: 'Socket Mode' }, '⚡️ On-Call Cat running');
  
  // Start health check server
  healthServer.listen(config.server.healthPort, () => {
    logger.info({ healthPort: config.server.healthPort }, 'Health check endpoint available at /health');
  });
  
  // Log metrics every 5 minutes
  const metricsInterval = setInterval(() => {
    logger.info({ 
      metrics: metrics.toJSON()
    }, 'Periodic metrics report');
  }, 300000); // 5 minutes
  
  // Clear interval on shutdown
  process.on('SIGTERM', () => clearInterval(metricsInterval));
  process.on('SIGINT', () => clearInterval(metricsInterval));
})();