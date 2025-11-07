/**
 * Application constants and configuration
 * Centralizes all constant values, field names, priorities, and regex patterns
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

// Default values (configurable via environment variables)
export const DEFAULTS = {
  NEEDED_BY_DAYS: parseInt(process.env.DEFAULT_NEEDED_BY_DAYS || '30', 10),
  NEEDED_BY_HOUR: parseInt(process.env.DEFAULT_NEEDED_BY_HOUR || '17', 10), // 5PM
  DB_TITLE: process.env.DEFAULT_DB_TITLE || 'On-call Issue Tracker DB'
};

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

// API configuration
export const API_TIMEOUT = parseInt(process.env.API_TIMEOUT || '10000', 10);
