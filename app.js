// app.js
import bolt from '@slack/bolt';              // Bolt is CJS; use default import
const { App, LogLevel } = bolt;
import { Client as Notion } from '@notionhq/client';

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
  console.error('Missing required env vars. Check .env file.');
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

// --- Global resilience: swallow transient Socket Mode disconnects ---
function isExplicitSocketDisconnect(err) {
  const msg = String(err && err.message || '');
  return msg.includes("Unhandled event 'server explicit disconnect'") || msg.includes('server explicit disconnect');
}
process.on('uncaughtException', (err) => {
  if (isExplicitSocketDisconnect(err)) {
    console.warn('[warn] Ignoring transient Slack Socket Mode explicit disconnect during connect; library will reconnect.');
    return; // do not crash
  }
  console.error('[fatal] Uncaught exception:', err);
  // You can choose to exit here; keep alive to let Docker restart via healthcheck if needed.
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  if (isExplicitSocketDisconnect(err)) {
    console.warn('[warn] Ignoring transient Slack Socket Mode explicit disconnect during connect (promise rejection).');
    return;
  }
  console.error('[fatal] Unhandled rejection:', reason);
});

// --- Needed-by parser (US-friendly) ---
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

// --- Simple email validator ---
function isEmail(s) {
  if (!s || typeof s !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

// --- Normalize Slack mailto/email tokens to plain email ---
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

/* ----------------- Parsing + validation ----------------- */
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

const isTopLevel = (evt) => !(evt?.thread_ts && evt.thread_ts !== evt.ts);
const getTrigger = (text) => {
  const m = /^\s*@(auto|cat|peepo)\b/i.exec(text || '');
  return m ? m[1].toLowerCase() : null;
};
const suffixForTrigger = (t) => {
  if (t === 'cat') return ' 🐈';
  if (t === 'peepo') return ' :peepo-yessir:';
  return '';
};

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

/* ----------------- Notion helpers ----------------- */
// Create or update a page; always write Slack TS (if present) and permalink
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
          console.warn("[warn] 'Reported by' is People but reporterNotionId is missing; no 'Reported by (text)' fallback column found.");
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
      const upd = await notion.pages.update({ page_id: pageId, properties: props });
      return { id: upd.id, url: upd.url };
    } else {
      const created = await notion.pages.create({ parent: { database_id: NOTION_DATABASE_ID }, properties: props });
      return { id: created.id, url: created.url };
    }
  } catch (err) {
    // rethrow so caller can decide how to notify
    throw err;
  }
}

// Find a page preferentially by Slack TS; if not found, fall back to permalink
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
    const byTs = await notion.databases.query({ database_id: NOTION_DATABASE_ID, filter: tsFilter, page_size: 1 });
    if (byTs.results?.[0]) return byTs.results[0];
  }

  // 2) Fall back to permalink
  if (SCHEMA.slackUrlProp && permalink) {
    const urlFilter = SCHEMA.slackUrlProp.type === 'url'
      ? { property: SCHEMA.slackUrlProp.name, url: { equals: permalink } }
      : { property: SCHEMA.slackUrlProp.name, rich_text: { contains: permalink } };
    const byUrl = await notion.databases.query({ database_id: NOTION_DATABASE_ID, filter: urlFilter, page_size: 1 });
    if (byUrl.results?.[0]) return byUrl.results[0];
  }

  return null;
}

/* ----------------- Slack responses ----------------- */
async function replyMissing({ client, channel, ts, fields, suffix = '' }) {
  const lines = fields.map(f => `• ${f}`).join('\n');
  const text =
    `❗ I couldn't track this yet — the following fields are missing:\n${lines}\n\n` +
    `Please *edit the original message* to include the missing fields (keep the trigger line at the top: @auto / @cat / @peepo). ` +
    `I'll pick up the edit automatically.`;
  await client.chat.postMessage({ channel, thread_ts: ts, text: text + suffix });
}

async function replyInvalid({ client, channel, ts, issues, suffix = '' }) {
  const lines = issues.map(f => `• ${f}`).join('\n');
  const text =
    `❗ Some fields have the wrong format:\n${lines}\n\n` +
    `Please *edit the original message* and fix the formatting. I'll pick up the edit automatically.`;
  await client.chat.postMessage({ channel, thread_ts: ts, text: text + suffix });
}

async function replyCreated({ client, channel, ts, pageUrl, parsed, suffix = '' }) {
  const dbPart = SCHEMA?.dbUrl ? `<${SCHEMA.dbUrl}|${SCHEMA.dbTitle || 'On-call Issue Tracker DB'}>` : 'Notion DB';
  const pagePart = `<${pageUrl}|${parsed?.issue || 'Notion Page'}>`;
  const text = `✅ Tracked: ${dbPart} › ${pagePart}` + suffix;
  await client.chat.postMessage({ channel, thread_ts: ts, text });
}

async function replyUpdated({ client, channel, ts, pageUrl, parsed, suffix = '' }) {
  const dbPart = SCHEMA?.dbUrl ? `<${SCHEMA.dbUrl}|${SCHEMA.dbTitle || 'On-call Issue Tracker DB'}>` : 'Notion DB';
  const pagePart = `<${pageUrl}|${parsed?.issue || 'Notion Page'}>`;
  const text = `🔄 Updated: ${dbPart} › ${pagePart}` + suffix;
  await client.chat.postMessage({ channel, thread_ts: ts, text });
}

// --- Bolt error handler (middleware/runtime) ---
app.error(async (error) => {
  if (isExplicitSocketDisconnect(error)) {
    console.warn('[warn] Bolt reported explicit Socket Mode disconnect; continuing.');
    return;
  }
  console.error('[error] Bolt app error:', error);
});

// --- Notion permission error helpers ---
function isNotionPermError(err) {
  // Notion returns APIResponseError with code 'restricted_resource' and 403
  return !!err && (err.code === 'restricted_resource' || err.status === 403);
}

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

/* ----------------- Event handlers ----------------- */
// New top-level messages
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

    const { permalink = '' } = await client.chat.getPermalink({
      channel: event.channel,
      message_ts: event.ts
    }).then(r => r || {});

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
      throw err; // let outer handler log other errors
    }
  } catch (err) {
    console.error('message handler error:', err);
  }
});

// Edits to original message
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

  const { permalink = '' } = await client.chat.getPermalink({
    channel,
    message_ts: origTs
  }).then(r => r || {});

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
    throw err;
  }
}

// --- Notion schema discovery ---
let SCHEMA = null;

async function loadSchema() {
  const db = await notion.databases.retrieve({ database_id: NOTION_DATABASE_ID });
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

// --- Slack -> Notion person resolver ---
async function findNotionUserIdByEmail(email) {
  if (!email) return null;
  let cursor;
  while (true) {
    const res = await notion.users.list(cursor ? { start_cursor: cursor } : {});
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

async function resolveNotionPersonForSlackUser(slackUserId, client) {
  try {
    if (!slackUserId) return { mention: '', notionId: null };
    const info = await client.users.info({ user: slackUserId });
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

// Helper to set a property respecting its actual type
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
  try { await loadSchema(); } catch (e) { console.error('Notion schema error:', e.message); }
  await app.start(process.env.PORT || 1987);
  console.log('⚡️ On-call auto ingestor running (Socket Mode)');
})();