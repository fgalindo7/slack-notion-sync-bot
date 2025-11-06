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

/* ----------------- Parsing + validation ----------------- */
function parseAutoBlock(text = '') {
  const cleaned = text.replace(/^\s*@auto\s*\n?/i, '');
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
  const links     = pick('Relevant\\s*Links?');

  const urls = Array.from(links.matchAll(/https?:\/\/\S+/g)).map(m => m[0]);

  // Default “push out as far as possible”: 30 days at 5pm PT
  const needed = neededRaw
    ? new Date(neededRaw)
    : (() => { const d = new Date(); d.setDate(d.getDate() + 30); d.setHours(17, 0, 0, 0); return d; })();

  return { priority, issue, replicate, customer, onepass, needed, urls, linksText: links };
}

const isTopLevel = (evt) => !(evt?.thread_ts && evt.thread_ts !== evt.ts);
const startsWithAuto = (text) => /^\s*@auto\b/i.test(text || '');

function missingFields(parsed) {
  const missing = [];
  if (!parsed.priority) missing.push('Priority (P0/P1/P2)');
  if (!parsed.issue) missing.push('Issue');
  if (!parsed.replicate) missing.push('How to replicate');
  if (!parsed.customer) missing.push('Customer');
  if (!parsed.onepass) missing.push('1Password');
  // Needed by is optional (we default). Relevant Links optional.
  return missing;
}

/* ----------------- Notion helpers ----------------- */
// Create or update a page; always write Slack TS (if present) and permalink
async function createOrUpdateNotionPage({ parsed, permalink, slackTs, pageId }) {
  if (!SCHEMA) await loadSchema();

  const props = {};
  setProp(props, 'Issue', parsed.issue || '(no issue given)');
  setProp(props, 'Priority', parsed.priority);
  setProp(props, 'How to replicate', parsed.replicate);
  setProp(props, 'Customer', parsed.customer);
  setProp(props, '1Password', parsed.onepass);
  setProp(props, 'Needed by', parsed.needed);

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

  if (pageId) {
    const upd = await notion.pages.update({ page_id: pageId, properties: props });
    return { id: upd.id, url: upd.url };
  } else {
    const created = await notion.pages.create({ parent: { database_id: NOTION_DATABASE_ID }, properties: props });
    return { id: created.id, url: created.url };
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
async function replyMissing({ client, channel, ts, fields }) {
  const lines = fields.map(f => `• ${f}`).join('\n');
  const text =
    `❗ I couldn't track this yet — the following fields are missing:\n${lines}\n\n` +
    `Please *edit the original message* to include the missing fields (keep the *@auto* line at the top). ` +
    `I'll pick up the edit automatically.`;
  await client.chat.postMessage({ channel, thread_ts: ts, text });
}

async function replyCreated({ client, channel, ts, url }) {
  const text = `✅ Tracked in Notion: ${url}`;
  await client.chat.postMessage({ channel, thread_ts: ts, text });
}

async function replyUpdated({ client, channel, ts, url }) {
  const text = `🔄 Updated in Notion: ${url}`;
  await client.chat.postMessage({ channel, thread_ts: ts, text });
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
    if (!startsWithAuto(event.text)) {
      return;
    }
    if (!ALLOW_THREADS && !isTopLevel(event)) { 
      return; 
    }

    const parsed = parseAutoBlock(event.text || '');
    const miss = missingFields(parsed);

    const { permalink = '' } = await client.chat.getPermalink({
      channel: event.channel,
      message_ts: event.ts
    }).then(r => r || {});

    if (miss.length) {
      await replyMissing({ client, channel: event.channel, ts: event.ts, fields: miss });
      return;
    }

    // Use TS-based lookup to avoid duplicates, then upsert (write TS + permalink)
    const existing = await findPageForMessage({ slackTs: event.ts, permalink });
    const { url } = await createOrUpdateNotionPage({
      parsed,
      permalink,
      slackTs: event.ts,
      pageId: existing?.id
    });

    await replyCreated({ client, channel: event.channel, ts: event.ts, url });
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
  if (!ALLOW_THREADS && newMsg.thread_ts && newMsg.thread_ts !== newMsg.ts) { 
    return; 
  }
  if (!startsWithAuto(newMsg.text)) {
    return;
  }

  const parsed = parseAutoBlock(newMsg.text || '');
  const miss = missingFields(parsed);

  const { permalink = '' } = await client.chat.getPermalink({
  channel,
  message_ts: origTs
  }).then(r => r || {});

  if (miss.length) {
    await replyMissing({ client, channel, ts: origTs, fields: miss });
    return;
  }

// Find by Slack TS first (canonical key), fall back to permalink
const existing = await findPageForMessage({ slackTs: origTs, permalink });
const { url } = await createOrUpdateNotionPage({
  parsed,
  permalink,
  slackTs: origTs,
  pageId: existing?.id
});

await replyUpdated({ client, channel, ts: origTs, url });
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

  SCHEMA = { byName, slackUrlProp, slackTsProp };
  return SCHEMA;
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
    case 'date':
      props[name] = { date: { start: value instanceof Date ? value.toISOString() : new Date(value).toISOString() } };
      break;
    case 'url':
      props[name] = { url: toStr(value) };
      break;
    case 'number':
      props[name] = { number: typeof value === 'number' ? value : Number(value) };
      break;
    default:
      // Fallback to rich_text
      props[name] = { rich_text: [{ type: 'text', text: { content: toStr(value) } }] };
  }
}

(async () => {
  try { await loadSchema(); } catch (e) { console.error('Notion schema error:', e.message); }
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ On-call auto ingestor running (Socket Mode)');
})();