#!/usr/bin/env node
/**
 * Pretty-print GCP Cloud Logging JSON lines to match local pino-pretty style.
 * Reads newline-delimited JSON from stdin (from `gcloud logging tail --format=json`).
 */

import readline from 'readline';

const isBatch = process.argv.includes('--batch');

const colors = {
  reset: '\u001b[0m', dim: '\u001b[2m',
  gray: '\u001b[90m', white: '\u001b[37m',
  red: '\u001b[31m', brightRed: '\u001b[91m',
  yellow: '\u001b[33m', green: '\u001b[32m',
  cyan: '\u001b[36m', magenta: '\u001b[35m',
  blue: '\u001b[34m'
};

const levelColor = (sev) => {
  const s = String(sev || '').toUpperCase();
  if (s === 'DEBUG') { return colors.gray; }
  if (s === 'INFO') { return colors.cyan; }
  if (s === 'WARNING') { return colors.yellow; }
  if (s === 'ERROR') { return colors.red; }
  if (s === 'CRITICAL' || s === 'ALERT' || s === 'EMERGENCY') { return colors.brightRed; }
  return colors.white;
};

const srcColor = (src) => {
  switch ((src || '').toLowerCase()) {
    case 'slack': return colors.cyan;
    case 'notion': return colors.green;
    case 'health': return colors.blue;
    case 'metrics': return colors.magenta;
    case 'parser': return colors.cyan;
    case 'app': return colors.white;
    case 'config': return colors.white;
    default: return colors.white;
  }
};

function formatTime(ts) {
  try {
    const d = new Date(ts);
    if (!isNaN(d)) {
      const pad = (n, w=2) => String(n).padStart(w, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3,'0')}`;
    }
  } catch {
    // ignore
  }
  return String(ts);
}

function extractPayload(obj) {
  // Cloud Logging entries may have jsonPayload (object) or textPayload (stringified)
  if (obj.jsonPayload && typeof obj.jsonPayload === 'object') { return obj.jsonPayload; }
  if (obj.textPayload && typeof obj.textPayload === 'string') {
    try {
      return JSON.parse(obj.textPayload);
    } catch {
      return { msg: obj.textPayload };
    }
  }
  return obj; // best effort
}

function toKV(meta) {
  if (!meta || typeof meta !== 'object') { return ''; }
  const parts = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) { continue; }
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${colors.dim}${k}${colors.reset}=${val}`);
  }
  return parts.join(' ');
}

function pretty(entry) {
  const ts = entry.timestamp || entry.receiveTimestamp || Date.now();
  const when = `${colors.dim}${formatTime(ts)}${colors.reset}`;
  const payload = extractPayload(entry);
  const sev = payload.severity || entry.severity || 'INFO';
  const lvlColor = levelColor(sev);
  const level = `${lvlColor}${String(sev).toUpperCase()}${colors.reset}`;
  const src = payload.src ? `${srcColor(payload.src)}[${payload.src}]${colors.reset}` : '';
  const event = payload.event ? `${colors.cyan}(${payload.event})${colors.reset}` : '';
  const msg = payload.msg || entry.message || '';
  const meta = toKV(payload.meta);
  const tail = meta ? ` — ${meta}` : '';
  return `${when} ${level} ${src} ${event} ${msg}${tail}`.replace(/\s+/g, ' ').trim();
}

if (isBatch) {
  // Accumulate entire stdin, parse once (supports JSON array from gcloud read)
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { data += chunk; });
  process.stdin.on('end', () => {
    const text = (data || '').trim();
    if (!text) { process.exit(0); }
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          console.log(pretty(entry));
        }
      } else {
        console.log(pretty(parsed));
      }
    } catch {
      // Fallback to line-by-line if not valid JSON
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) { continue; }
        try { console.log(pretty(JSON.parse(line))); } catch { console.log(line); }
      }
    }
  });
} else {
  // Stream mode (NDJSON from gcloud tail)
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) { return; }
    try {
      const obj = JSON.parse(line);
      console.log(pretty(obj));
    } catch {
      // Not JSON; print raw
      console.log(line);
    }
  });
  rl.on('close', () => process.exit(0));
}
