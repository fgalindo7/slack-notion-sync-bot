/**
 * Application constants
 * Centralizes all constant values, field names, priorities, and regex patterns
 * Note: Configuration values are loaded from lib/config.js
 */

// Field name constants for Notion database
export const NOTION_FIELDS = {
  ISSUE: 'Issue',
  PRIORITY: 'Priority',
  HOW_TO_REPLICATE: 'How to replicate',
  CUSTOMER: 'Customer',
  ONE_PASSWORD: '1Password',
  NEEDED_BY: 'Needed by',
  REPORTED_BY: 'Reported by',
  REPORTED_BY_TEXT: 'Reported by (text)',
  RELEVANT_LINKS: 'Relevant Links',
  SLACK_MESSAGE_TS: 'Slack Message TS',
  SLACK_MESSAGE_URL: 'Slack Message URL'
};

// Priority levels
export const PRIORITIES = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2'
};

// Trigger keywords (reserved for future use)
export const TRIGGERS = {
  AUTO: 'auto',
  CAT: 'cat',
  PEEPO: 'peepo'
};

/**
 * Default values - initialized from config
 * These will be set by the main app after loading config
 */
export let DEFAULTS = {
  NEEDED_BY_DAYS: 30,
  NEEDED_BY_HOUR: 17,
  DB_TITLE: 'On-call Issue Tracker DB'
};

/**
 * Sets default values from configuration
 * Called by main app after config is loaded
 */
export function setDefaults(defaults) {
  DEFAULTS = {
    NEEDED_BY_DAYS: defaults.neededByDays,
    NEEDED_BY_HOUR: defaults.neededByHour,
    DB_TITLE: defaults.dbTitle
  };
}

// Pre-compiled regex patterns for performance
export const REGEX = {
  // Date parsing patterns
  US_DATE_WITH_TIME: /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i,
  US_DATE_WITH_HOUR: /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(am|pm)$/i,
  ISO_DATE_WITH_TIME: /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i,
  
  // Email normalization patterns
  MAILTO_LINK: /^<mailto:([^>|]+)(?:\|([^>]+))?>$/i,
  ANGLE_BRACKETS: /^<([^>]+)>$/,
  EMAIL_VALIDATION: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  
  // URL extraction
  URL_PATTERN: /(https?:\/\/[^\s<>]+)/gi,
  
  // Trigger detection
  TRIGGER_PREFIX: /^\s*@(auto|cat|peepo)\s*\n?/i
};

/**
 * API timeout - initialized from config
 * Will be set by main app after loading config
 */
export let API_TIMEOUT = 10000;

/**
 * Sets API timeout from configuration
 */
export function setApiTimeout(timeout) {
  API_TIMEOUT = timeout;
}
