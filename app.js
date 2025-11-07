/**
 * @fileoverview Slack-Notion Sync Bot - Automatically tracks on-call issues from Slack to Notion
 * Listens for messages with specific triggers (@auto, @cat, @peepo) and creates/updates Notion pages
 * @author Francisco Galindo
 */

// app.js
import bolt from '@slack/bolt';              // Bolt is CJS; use default import
const { App, LogLevel } = bolt;
import { Client as Notion } from '@notionhq/client';
import pino from 'pino';
import pThrottle from 'p-throttle';
import pTimeout from 'p-timeout';

// Initialize structured logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: { colorize: true }
  } : undefined
});

// Rate limiter for Notion API (3 requests per second as per Notion limits)
const throttle = pThrottle({
  limit: 3,
  interval: 1000, // 1 second
  strict: true
});

// Configurable timeout for API operations (in milliseconds)
const API_TIMEOUT = parseInt(process.env.API_TIMEOUT || '10000', 10); // Default 10 seconds

/**
 * Wraps a promise with a timeout to prevent hanging operations
 * @param {Promise} promise - The promise to wrap
 * @param {number} [ms=API_TIMEOUT] - Timeout in milliseconds
 * @param {string} [operation='Operation'] - Description of the operation for error messages
 * @returns {Promise} Promise that rejects if timeout is exceeded
 */
const withTimeout = (promise, ms = API_TIMEOUT, operation = 'Operation') => {
  return pTimeout(promise, {
    milliseconds: ms,
    message: `${operation} timed out after ${ms}ms`
  });
};

const {
  SLACK_BOT_TOKEN,
  SLACK_APP_LEVEL_TOKEN,
  SLACK_SIGNING_SECRET,
  NOTION_TOKEN,
  NOTION_DATABASE_ID,
  WATCH_CHANNEL_ID,
  ALLOW_THREADS
} = process.env;

const ALLOW_THREADS_BOOL = String(ALLOW_THREADS || '').toLowerCase() === 'true';

if (!SLACK_BOT_TOKEN || !SLACK_APP_LEVEL_TOKEN || !NOTION_TOKEN || !NOTION_DATABASE_ID) {
  logger.error({ 
    slackBotToken: !!SLACK_BOT_TOKEN,
    slackAppToken: !!SLACK_APP_LEVEL_TOKEN, 
    notionToken: !!NOTION_TOKEN,
    notionDbId: !!NOTION_DATABASE_ID
  }, 'Missing required environment variables');
  process.exit(1);
}

const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET || 'unused',
  socketMode: true,
  appToken: SLACK_APP_LEVEL_TOKEN,
  logLevel: LogLevel.INFO
});


const notion = new Notion({ auth: NOTION_TOKEN });

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
 * Parses a "needed by" date/time string supporting multiple formats
 * Supports ISO dates, MM/DD/YYYY with optional time, and YYYY-MM-DD formats
 * @param {string} input - The date string to parse (e.g., "11/04/2025 7PM", "2025-11-04", "11/04/2025")
 * @returns {Date|null} Parsed Date object or null if parsing fails
 * @example
 * parseNeededByString("11/04/2025 7PM") // Returns Date at 7PM on Nov 4, 2025
 * parseNeededByString("2025-11-04") // Returns Date at 5PM (default) on Nov 4, 2025
 */
function parseNeededByString(input) {
  if (!input) return null;
  const s = String(input).trim();

  // 1) Try ISO or Date.parse-friendly first
  const isoTry = new Date(s);
  if (!isNaN(isoTry)) return isoTry;

  // 2) Match "MM/DD/YYYY [time]" where time can be "7PM", "7 PM", "7:30 pm", "19:00"
  const re = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;
  const m = s.match(re);
  if (m) {
    let [, mm, dd, yyyy, hh, min, ampm] = m;
    const year = yyyy.length === 2 ? 2000 + Number(yyyy) : Number(yyyy);
    const monthIdx = Number(mm) - 1;
    const day = Number(dd);
    let hours = hh ? Number(hh) : 17;
    const minutes = min ? Number(min) : (hh ? 0 : 0);

    if (ampm) {
      const ap = ampm.toLowerCase();
      if (ap === 'pm' && hours < 12) hours += 12;
      if (ap === 'am' && hours === 12) hours = 0;
    }

    const d = new Date(year, monthIdx, day, hours, minutes, 0, 0);
    if (!isNaN(d)) return d;
  }

  // 3) Match "YYYY-MM-DD [time]"
  const reIsoish = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;
  const m2 = s.match(reIsoish);
  if (m2) {
    let [, yyyy, mm, dd, hh, min, ampm] = m2;
    const year = Number(yyyy);
    const monthIdx = Number(mm) - 1;
    const day = Number(dd);
    let hours = hh ? Number(hh) : 17;
    const minutes = min ? Number(min) : (hh ? 0 : 0);

    if (ampm) {
      const ap = ampm.toLowerCase();
      if (ap === 'pm' && hours < 12) hours += 12;
      if (ap === 'am' && hours === 12) hours = 0;
    }

    const d = new Date(year, monthIdx, day, hours, minutes, 0, 0);
    if (!isNaN(d)) return d;
  }

  return null; // let caller decide a default
}

/**
 * Validates if a string is a properly formatted email address
 * @param {string} s - The string to validate
 * @returns {boolean} True if the string is a valid email format, false otherwise
 */
function isEmail(s) {
  if (!s || typeof s !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/**
 * Normalizes Slack email formats to plain email addresses
 * Handles Slack's mailto links and angle-bracket wrapping
 * @param {string} s - The potentially Slack-formatted email string
 * @returns {string} Plain email address without Slack formatting
 * @example
 * normalizeEmail("<mailto:user@example.com|user@example.com>") // Returns "user@example.com"
 * normalizeEmail("<user@example.com>") // Returns "user@example.com"
 */
function normalizeEmail(s) {
  if (!s) return '';
  let t = String(s).trim();
  // Slack often sends emails as <mailto:addr@domain.com|addr@domain.com>
  const mailto = /^<mailto:([^>|]+)(?:\|([^>]+))?>$/i.exec(t);
  if (mailto) {
    return (mailto[2] || mailto[1] || '').trim();
  }
  // Sometimes Slack wraps plain values like <addr@domain.com>
  const angle = /^<([^>]+)>$/.exec(t);
  if (angle) return angle[1].trim();
  return t;
}

/**
 * Parses a message block for on-call issue tracking fields
 * Extracts Priority, Issue, How to replicate, Customer, 1Password, Needed by, and Relevant Links
 * @param {string} text - The message text to parse (with @auto/@cat/@peepo trigger)
 * @returns {Object} Parsed fields object
 * @returns {string} returns.priority - Issue priority (P0/P1/P2)
 * @returns {string} returns.issue - Description of the issue
 * @returns {string} returns.replicate - Steps to replicate the issue
 * @returns {string} returns.customer - Customer name or identifier
 * @returns {string} returns.onepass - 1Password email for access
 * @returns {Date} returns.needed - Parsed needed-by date (with default if not provided)
 * @returns {string} returns.neededRaw - Raw needed-by input string
 * @returns {boolean} returns.neededValid - Whether the needed-by date was successfully parsed
 * @returns {string[]} returns.urls - Array of extracted URLs from relevant links
 * @returns {string} returns.linksText - Full text content of relevant links field
 */
function parseAutoBlock(text = '') {
  const cleaned = text.replace(/^\s*@(auto|cat|peepo)\s*\n?/i, '');
  const pick = (label) => {
    const re = new RegExp(
      `^\\s*${label}\\s*:\\s*([\\s\\S]*?)(?=^\\s*\\w[\\w\\s/]*:\\s*|$)`,
      'mi'
    );
    const m = re.exec(cleaned);
    return m ? m[1].trim() : '';
  };

  let priority = pick('Priority').toUpperCase().replace(/\s+/g, '');
  if (!['P0', 'P1', 'P2'].includes(priority)) priority = '';

  const issue     = pick('Issue');
  const replicate = pick('How\\s*to\\s*replicate');
  const customer  = pick('Customer');
  const onepass   = pick('1\\s*Password');
  const neededRaw = pick('Needed\\s*by\\s*(?:date/?time)?');

  function defaultNeeded() {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    d.setHours(17, 0, 0, 0); // default to 5pm
    return d;
  }

  let neededValid = true;
  let needed = defaultNeeded();
  if (neededRaw) {
    const parsed = parseNeededByString(neededRaw);
    if (parsed && !isNaN(parsed)) {
      needed = parsed;
    } else {
      neededValid = false; // default & tell user how to fix
      needed = defaultNeeded();
    }
  }
  const links     = pick('Relevant\\s*Links?');

  const urls = Array.from(links.matchAll(/https?:\/\/\S+/g)).map(m => m[0]);

  return { priority, issue, replicate, customer, onepass, needed, neededRaw, neededValid, urls, linksText: links };
}

/**
 * Checks if a Slack event is a top-level message (not a thread reply)
 * @param {Object} evt - Slack event object
 * @returns {boolean} True if the message is top-level, false if it's in a thread
 */
const isTopLevel = (evt) => !(evt?.thread_ts && evt.thread_ts !== evt.ts);

/**
 * Extracts the trigger keyword from message text
 * @param {string} text - Message text to check
 * @returns {string|null} The trigger word ('auto', 'cat', or 'peepo') or null if no trigger found
 */
const getTrigger = (text) => {
  const m = /^\s*@(auto|cat|peepo)\b/i.exec(text || '');
  return m ? m[1].toLowerCase() : null;
};

/**
 * Returns an emoji suffix based on the trigger keyword used
 * @param {string} t - The trigger keyword ('auto', 'cat', or 'peepo')
 * @returns {string} Emoji suffix string for the response message
 */
const suffixForTrigger = (t) => {
  if (t === 'cat') return ' 🐈';
  if (t === 'peepo') return ' :peepo-yessir:';
  return '';
};

/**
 * Identifies which required fields are missing from a parsed message
 * @param {Object} parsed - Parsed message object from parseAutoBlock()
 * @returns {string[]} Array of missing field names
 */
function missingFields(parsed) {
  const missing = [];
  if (!parsed.priority) missing.push('Priority (P0/P1/P2)');
  if (!parsed.issue) missing.push('Issue');
  if (!parsed.replicate) missing.push('How to replicate');
  if (!parsed.customer) missing.push('Customer');
  if (!parsed.onepass) missing.push('1Password (email)');
  // Needed by defaults; Relevant Links optional
  return missing;
}

/**
 * Validates field types and formats in a parsed message
 * Checks 1Password email format and needed-by date parsing
 * @param {Object} parsed - Parsed message object from parseAutoBlock()
 * @returns {string[]} Array of validation error messages
 */
function typeIssues(parsed) {
  const issues = [];
  // Inline email check (avoids dependency on global isEmail)
  const isEmailInline = (s) => !!(s && typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()));

  // 1Password must be an email
  if (parsed.onepass) {
    const value = normalizeEmail(parsed.onepass);
    // Accept simple valid emails; reject only if obviously invalid
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!validEmail.test(value)) {
      issues.push('1Password must be an email address (e.g., oncall@company.com).');
    }
  }
  // Warn if user provided Needed by but it was unparsable
  if (parsed.neededRaw && !parsed.neededValid) {
    issues.push('Needed by date/time format not recognized. Examples: 11/04/2025 7PM · 11/04/2025 · 2025-11-04 19:00');
  }
  return issues;
}

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
async function createOrUpdateNotionPage({ parsed, permalink, slackTs, reporterMention, reporterNotionId, pageId }) {
  if (!SCHEMA) await loadSchema();

  const props = {};
  setProp(props, 'Issue', parsed.issue || '(no issue given)');
  setProp(props, 'Priority', parsed.priority);
  setProp(props, 'How to replicate', parsed.replicate);
  setProp(props, 'Customer', parsed.customer);
  const onepassEmail = normalizeEmail(parsed.onepass);
  setProp(props, '1Password', onepassEmail);
  setProp(props, 'Needed by', parsed.needed);
  // Reported by: respect actual Notion property type; write fallback to "Reported by (text)" when People cannot be set
  const reportedMeta = SCHEMA.byName['reported by'];
  const reportedTextMeta = SCHEMA.byName['reported by (text)'];
  if (reportedMeta) {
      if (reportedMeta.type === 'people') {
      if (reporterNotionId) {
        props[reportedMeta.name] = { people: [{ id: reporterNotionId }] };
      } else {
        // People field exists but we cannot resolve a Notion person. Do not write text here; instead use fallback text column if present.
        if (reportedTextMeta && reporterMention) {
          setProp(props, reportedTextMeta.name, reporterMention);
        } else {
          logger.warn({ reporterMention }, "'Reported by' is People but reporterNotionId is missing; no 'Reported by (text)' fallback column found");
        }
      }
    } else {
      // Non-people field: store mention text via type-aware setProp
      if (reporterMention) setProp(props, reportedMeta.name, reporterMention);
    }
  } else if (reportedTextMeta && reporterMention) {
    // If there is no 'Reported by' property but there is a fallback text column, set it
    setProp(props, reportedTextMeta.name, reporterMention);
  }

  // Slack Message TS (preferred unique key)
  if (SCHEMA.slackTsProp) {
    if (SCHEMA.slackTsProp.type === 'number') {
      // Use integer seconds (ts before the dot) to keep it clean, or store full float
      const num = Number(String(slackTs).replace('.', '')); // full precision as integer
      props[SCHEMA.slackTsProp.name] = { number: Number.isFinite(num) ? num : undefined };
    } else {
      props[SCHEMA.slackTsProp.name] = { rich_text: [{ type: 'text', text: { content: String(slackTs) } }] };
    }
  }

  // Slack Message URL (secondary key)
  if (SCHEMA.slackUrlProp) {
    if (SCHEMA.slackUrlProp.type === 'url') {
      props[SCHEMA.slackUrlProp.name] = { url: permalink };
    } else {
      props[SCHEMA.slackUrlProp.name] = { rich_text: [{ type: 'text', text: { content: permalink } }] };
    }
  }

  // Relevant Links: URL (first) or all links as rich_text
  if (SCHEMA.byName['relevant links']) {
    const meta = SCHEMA.byName['relevant links'];
    if (meta.type === 'url') {
      if (parsed.urls?.[0]) props['Relevant Links'] = { url: parsed.urls[0] };
    } else {
      if (parsed.linksText) props['Relevant Links'] = { rich_text: [{ type: 'text', text: { content: parsed.linksText } }] };
    }
  }

  try {
    if (pageId) {
      const upd = await notionThrottled.pages.update({ page_id: pageId, properties: props });
      return { id: upd.id, url: upd.url };
    } else {
      const created = await notionThrottled.pages.create({ parent: { database_id: NOTION_DATABASE_ID }, properties: props });
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
async function findPageForMessage({ slackTs, permalink }) {
  if (!SCHEMA) await loadSchema();

  // 1) Try by TS (exact)
  if (SCHEMA.slackTsProp) {
    let tsFilter;
    if (SCHEMA.slackTsProp.type === 'number') {
      const num = Number(String(slackTs).replace('.', ''));
      tsFilter = { property: SCHEMA.slackTsProp.name, number: { equals: num } };
    } else {
      tsFilter = { property: SCHEMA.slackTsProp.name, rich_text: { equals: String(slackTs) } };
    }
    const byTs = await notionThrottled.databases.query({ database_id: NOTION_DATABASE_ID, filter: tsFilter, page_size: 1 });
    if (byTs.results?.[0]) return byTs.results[0];
  }

  // 2) Fall back to permalink
  if (SCHEMA.slackUrlProp && permalink) {
    const urlFilter = SCHEMA.slackUrlProp.type === 'url'
      ? { property: SCHEMA.slackUrlProp.name, url: { equals: permalink } }
      : { property: SCHEMA.slackUrlProp.name, rich_text: { contains: permalink } };
    const byUrl = await notionThrottled.databases.query({ database_id: NOTION_DATABASE_ID, filter: urlFilter, page_size: 1 });
    if (byUrl.results?.[0]) return byUrl.results[0];
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
    `❗ I couldn't track this yet — the following fields are missing:\n${lines}\n\n` +
    `Please *edit the original message* to include the missing fields (keep the trigger line at the top: @auto / @cat / @peepo). ` +
    `I'll pick up the edit automatically.`;
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
  const lines = issues.map(f => `• ${f}`).join('\n');
  const text =
    `❗ Some fields have the wrong format:\n${lines}\n\n` +
    `Please *edit the original message* and fix the formatting. I'll pick up the edit automatically.`;
  await client.chat.postMessage({ channel, thread_ts: ts, text: text + suffix });
}

/**
 * Posts a success message when a Notion page is created
 * @param {Object} params - Function parameters
 * @param {Object} params.client - Slack Web API client
 * @param {string} params.channel - Slack channel ID
 * @param {string} params.ts - Message timestamp (for threading)
 * @param {string} params.pageUrl - URL of the created Notion page
 * @param {Object} params.parsed - Parsed message data (for issue title)
 * @param {string} [params.suffix=''] - Optional emoji suffix to append
 * @returns {Promise<void>}
 */
async function replyCreated({ client, channel, ts, pageUrl, parsed, suffix = '' }) {
  const dbPart = SCHEMA?.dbUrl ? `<${SCHEMA.dbUrl}|${SCHEMA.dbTitle || 'On-call Issue Tracker DB'}>` : 'Notion DB';
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
 * @returns {Promise<void>}
 */
async function replyUpdated({ client, channel, ts, pageUrl, parsed, suffix = '' }) {
  const dbPart = SCHEMA?.dbUrl ? `<${SCHEMA.dbUrl}|${SCHEMA.dbTitle || 'On-call Issue Tracker DB'}>` : 'Notion DB';
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
 * @returns {Promise<void>}
 */
async function notifyNotionPerms({ client, channel, ts, suffix = '' }) {
  const dbPart = SCHEMA?.dbUrl ? `<${SCHEMA.dbUrl}|${SCHEMA.dbTitle || 'On-call Issue Tracker DB'}>` : 'the Notion database';
  const text =
    `❗ I couldn't write to Notion due to *insufficient permissions*.\n` +
    `Please make sure your Notion integration is connected to ${dbPart} with *Can edit* access:\n` +
    `- In Notion, open the database as a full page → *Share* → *Add connection* → select this integration → *Allow*.\n` +
    `- Then try your message again (or edit the same message).` + suffix;
  try {
    await client.chat.postMessage({ channel, thread_ts: ts, text });
  } catch (_) { /* ignore secondary errors */ }
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
  try {
    // Ignore non-user-generated subtypes except edits (handled below)
    if (event.subtype && event.subtype !== 'message_changed') return;
    if (WATCH_CHANNEL_ID && event.channel !== WATCH_CHANNEL_ID) return;

    // Handle edits (message_changed) separately
    if (event.subtype === 'message_changed') {
      await handleEdit({ event, client });
      return;
    }

    // Fresh message path
    const trigger = getTrigger(event.text);
    if (!trigger) { return; }
    const suffix = suffixForTrigger(trigger);
    if (!ALLOW_THREADS_BOOL && !isTopLevel(event)) { 
      return; 
    }

    const parsed = parseAutoBlock(event.text || '');
    const miss = missingFields(parsed);
    const issues = typeIssues(parsed);

    const { permalink = '' } = await withTimeout(
      client.chat.getPermalink({
        channel: event.channel,
        message_ts: event.ts
      }).then(r => r || {}),
      API_TIMEOUT,
      'Slack getPermalink'
    );

    if (miss.length) {
      await replyMissing({ client, channel: event.channel, ts: event.ts, fields: miss, suffix });
      return;
    }

    if (issues.length) {
      await replyInvalid({ client, channel: event.channel, ts: event.ts, issues, suffix });
      return;
    }

    const { mention: reporterMention, notionId: reporterNotionId } = await resolveNotionPersonForSlackUser(event.user, client);

    // Use TS-based lookup to avoid duplicates, then upsert (write TS + permalink)
    const existing = await findPageForMessage({ slackTs: event.ts, permalink });
    try {
      const { url } = await createOrUpdateNotionPage({
        parsed,
        permalink,
        slackTs: event.ts,
        reporterMention,
        reporterNotionId,
        pageId: existing?.id
      });
      await replyCreated({ client, channel: event.channel, ts: event.ts, pageUrl: url, parsed, suffix });
    } catch (err) {
      if (isNotionPermError(err)) {
        await notifyNotionPerms({ client, channel: event.channel, ts: event.ts, suffix });
        return;
      }
      if (err.name === 'TimeoutError') {
        logger.error({ error: err.message, channel: event.channel, ts: event.ts }, 'API timeout');
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: event.ts,
          text: `⚠️ Request timed out. Please try again in a moment.${suffix}`
        }).catch(() => {}); // Ignore errors in error handler
        return;
      }
      throw err; // let outer handler log other errors
    }
  } catch (err) {
    logger.error({ 
      error: err.message, 
      stack: err.stack,
      channel: event.channel,
      ts: event.ts 
    }, 'Message handler error');
  }
});

/**
 * Handles edits to previously posted messages
 * Updates the corresponding Notion page when a tracked message is edited
 * @param {Object} params - Function parameters
 * @param {Object} params.event - Slack message_changed event
 * @param {Object} params.client - Slack Web API client
 * @returns {Promise<void>}
 */
async function handleEdit({ event, client }) {
  // Slack edit payload:
  // event.message.text = new text
  // event.previous_message.ts = original ts
  // event.channel = channel id
  const newMsg = event.message || {};
  const orig = event.previous_message || {};
  const channel = event.channel;
  const origTs = orig.ts || newMsg.ts; // fallback

  // Optional: enforce top-level only (ignore thread replies)
  if (!ALLOW_THREADS_BOOL && newMsg.thread_ts && newMsg.thread_ts !== newMsg.ts) { 
    return; 
  }
  const trigger = getTrigger(newMsg.text);
  if (!trigger) { 
    return; 
  }
  const suffix = suffixForTrigger(trigger);

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
    await replyMissing({ client, channel, ts: origTs, fields: miss, suffix });
    return;
  }

  if (issues.length) {
    await replyInvalid({ client, channel, ts: origTs, issues, suffix });
    return;
  }
  const { mention: reporterMention, notionId: reporterNotionId } = await resolveNotionPersonForSlackUser(newMsg.user, client);

  // Find by Slack TS first (canonical key), fall back to permalink
  const existing = await findPageForMessage({ slackTs: origTs, permalink });
  try {
    const { url } = await createOrUpdateNotionPage({
      parsed,
      permalink,
      slackTs: origTs,
      reporterMention,
      reporterNotionId,
      pageId: existing?.id
    });
    await replyUpdated({ client, channel, ts: origTs, pageUrl: url, parsed, suffix });
  } catch (err) {
    if (isNotionPermError(err)) {
      await notifyNotionPerms({ client, channel, ts: origTs, suffix });
      return;
    }
    if (err.name === 'TimeoutError') {
      logger.error({ error: err.message, channel, ts: origTs }, 'API timeout on edit');
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
 * @type {Object|null}
 */
let SCHEMA = null;

/**
 * Loads and caches the Notion database schema
 * Discovers property types and identifies Slack message tracking columns
 * @returns {Promise<Object>} Schema object with property mappings and database metadata
 * @throws {Error} If required tracking columns (Slack Message URL or Slack Message TS) are not found
 */
async function loadSchema() {
  const db = await notionThrottled.databases.retrieve({ database_id: NOTION_DATABASE_ID });
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
  for (const n of permalinkCandidates) if (byName[n]) { slackUrlProp = byName[n]; break; }

  // Find Slack TS by common names (Text or Number)
  const tsCandidates = [
    'slack message ts',
    'slack ts',
    'message ts'
  ];
  let slackTsProp = null;
  for (const n of tsCandidates) if (byName[n]) { slackTsProp = byName[n]; break; }

  if (!slackUrlProp && !slackTsProp) {
    throw new Error(
      'Notion DB: add a permalink column (URL or Text) named "Slack Message URL" ' +
      'or a TS column (Text or Number) named "Slack Message TS".'
    );
  }

  const dbTitle = (db.title && db.title[0] && db.title[0].plain_text) ? db.title[0].plain_text : 'On-call Issue Tracker DB';
  SCHEMA = { byName, slackUrlProp, slackTsProp, dbUrl: db.url, dbTitle };
  return SCHEMA;
}

/**
 * Finds a Notion user ID by email address
 * Iterates through all Notion workspace users to find a matching email
 * @param {string} email - Email address to search for
 * @returns {Promise<string|null>} Notion user ID if found, null otherwise
 */
async function findNotionUserIdByEmail(email) {
  if (!email) return null;
  let cursor;
  while (true) {
    const res = await notionThrottled.users.list(cursor ? { start_cursor: cursor } : {});
    for (const u of res.results || []) {
      if (u.type === 'person' && u.person?.email && u.person.email.toLowerCase() === email.toLowerCase()) {
        return u.id;
      }
    }
    if (!res.has_more) break;
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
    if (!slackUserId) return { mention: '', notionId: null };
    const info = await withTimeout(
      client.users.info({ user: slackUserId }),
      API_TIMEOUT,
      'Slack users.info'
    );
    const email = info?.user?.profile?.email || null;
    const mention = `<@${slackUserId}>`;
    if (!email) return { mention, notionId: null }; // requires users:read.email; fallback to mention text
    const notionId = await findNotionUserIdByEmail(email);
    return { mention, notionId };
  } catch (_) {
    // On any failure, return mention only
    return { mention: slackUserId ? `<@${slackUserId}>` : '', notionId: null };
  }
}

/**
 * Sets a Notion property value respecting its type from the database schema
 * Automatically converts values to the appropriate format for each property type
 * @param {Object} props - Properties object to modify
 * @param {string} name - Property name
 * @param {*} value - Value to set (will be converted based on property type)
 * @returns {void}
 */
function setProp(props, name, value) {
  if (value === undefined || value === null) return;
  const meta = SCHEMA?.byName[name.toLowerCase()];
  if (!meta) return;

  const toStr = (v) => (v instanceof Date ? v.toISOString() : String(v));

  switch (meta.type) {
    case 'title':
      props[name] = { title: [{ type: 'text', text: { content: toStr(value) } }] };
      break;
    case 'rich_text':
      props[name] = { rich_text: [{ type: 'text', text: { content: toStr(value) } }] };
      break;
    case 'select':
      props[name] = { select: { name: toStr(value) } };
      break;
    case 'date': {
      let dt = null;
      if (value instanceof Date && !isNaN(value)) {
        dt = value;
      } else if (typeof value === 'string') {
        dt = parseNeededByString(value);
        if (!dt || isNaN(dt)) dt = new Date(value);
      }
      if (dt && !isNaN(dt)) {
        props[name] = { date: { start: dt.toISOString() } };
      }
      // If parsing failed, skip setting this property to avoid crashes.
      break;
    }
    case 'url':
      props[name] = { url: toStr(value) };
      break;
    case 'number':
      props[name] = { number: typeof value === 'number' ? value : Number(value) };
      break;
    case 'email':
      props[name] = { email: toStr(value) };
      break;
    default:
      // Fallback to rich_text
      props[name] = { rich_text: [{ type: 'text', text: { content: toStr(value) } }] };
  }
}

(async () => {
  try { 
    await loadSchema();
    logger.info({ databaseId: NOTION_DATABASE_ID }, 'Notion schema loaded successfully');
  } catch (e) { 
    logger.error({ error: e.message, databaseId: NOTION_DATABASE_ID }, 'Failed to load Notion schema');
  }
  await app.start(process.env.PORT || 1987);
  logger.info({ port: process.env.PORT || 1987, mode: 'Socket Mode' }, '⚡️ On-call auto ingestor running');
})();