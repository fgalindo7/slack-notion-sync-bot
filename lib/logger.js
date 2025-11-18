import pino from 'pino';

// Decide when to pretty-print: local/dev by default, JSON in production/GCP
const isProd = (process.env.NODE_ENV === 'production') || (String(process.env.TARGET || '').toLowerCase() === 'gcp');

// Level to GCP severity mapper
const levelToSeverity = (label) => {
  switch ((label || '').toLowerCase()) {
    case 'trace': return 'DEBUG';
    case 'debug': return 'DEBUG';
    case 'info': return 'INFO';
    case 'warn': return 'WARNING';
    case 'error': return 'ERROR';
    case 'fatal': return 'CRITICAL';
    default: return label?.toUpperCase?.() || 'INFO';
  }
};

// Base JSON logger config (optimized for GCP ingestion)
const baseOptions = {
  base: undefined,                 // omit pid/hostname (noisy in Cloud Run)
  messageKey: 'msg',               // standardize message field
  timestamp: pino.stdTimeFunctions.epochTime, // numeric epoch ms
  formatters: {
    level: (label) => ({ level: label, severity: levelToSeverity(label) })
  },
  level: process.env.LOG_LEVEL || 'info'
};

// Pretty transport only for non-prod/local
const transport = isProd ? undefined : {
  target: 'pino-pretty',
  options: {
    colorize: true,
    singleLine: true,
    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
    ignore: 'pid,hostname',
  }
};

export const logger = pino({ ...baseOptions, transport });

export function createLogger(src) {
  if (!src) { return logger; }
  return logger.child({ src });
}
