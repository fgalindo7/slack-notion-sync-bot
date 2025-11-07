/**
 * Validation utilities
 * Handles validation of parsed message fields and formats
 */

import validator from 'validator';
import { DEFAULTS } from './constants.js';
import { normalizeEmail } from './parser.js';

/**
 * Identifies which required fields are missing from a parsed message
 * @param {Object} parsed - Parsed message object from parseAutoBlock()
 * @returns {string[]} Array of missing field names
 */
export function missingFields(parsed) {
  const missing = [];
  if (!parsed.priority) {missing.push('Priority (P0/P1/P2)');}
  if (!parsed.issue) {missing.push('Issue');}
  if (!parsed.replicate) {missing.push('How to replicate');}
  if (!parsed.customer) {missing.push('Customer');}
  if (!parsed.onepass) {missing.push('1Password (email)');}
  // Needed by defaults; Relevant Links optional
  return missing;
}

/**
 * Validates field types and formats in a parsed message
 * Checks 1Password email format and needed-by date parsing
 * @param {Object} parsed - Parsed message object from parseAutoBlock()
 * @returns {string[]} Array of validation error messages
 */
export function typeIssues(parsed) {
  const issues = [];

  // 1Password must be an email - using validator library for robust email validation
  if (parsed.onepass) {
    const value = normalizeEmail(parsed.onepass);
    if (!validator.isEmail(value)) {
      issues.push(
        `1Password field must be an email address.\n` +
        `Got: "${parsed.onepass}"\n` +
        `Expected format: user@company.com (supports +, -, numbers, and dots)`
      );
    }
  }
  // Warn if user provided Needed by but it was unparsable
  if (parsed.neededRaw && !parsed.neededValid) {
    const defaultHour = DEFAULTS.NEEDED_BY_HOUR;
    const defaultTime = defaultHour === 0 ? '12AM' : defaultHour < 12 ? `${defaultHour}AM` : defaultHour === 12 ? '12PM' : `${defaultHour - 12}PM`;
    issues.push(
      `Needed by date/time format not recognized: "${parsed.neededRaw}"\n\n` +
      `*Accepted formats:*\n` +
      `• \`ASAP\` → 20 minutes from now\n` +
      `• \`MM/DD/YYYY\` → 11/04/2025 (defaults to ${defaultTime})\n` +
      `• \`MM/DD/YYYY HH:MM AM/PM\` → 11/04/2025 7:30 PM\n` +
      `• \`MM/DD/YYYY HPM\` → 11/04/2025 7PM\n` +
      `• \`YYYY-MM-DD\` → 2025-11-04 (defaults to ${defaultTime})\n` +
      `• \`YYYY-MM-DD HH:MM\` → 2025-11-04 19:00\n\n` +
      `If omitted entirely, defaults to ${DEFAULTS.NEEDED_BY_DAYS} days from today at ${defaultTime}.`
    );
  }
  return issues;
}

/**
 * Checks if a Slack event is a top-level message (not a thread reply)
 * @param {Object} evt - Slack event object
 * @returns {boolean} True if the message is top-level, false if it's in a thread
 */
export const isTopLevel = (evt) => !(evt?.thread_ts && evt.thread_ts !== evt.ts);

/**
 * Extracts the trigger keyword from message text
 * @param {string} text - Message text to check
 * @returns {string|null} The trigger word ('auto', 'cat', or 'peepo') or null if no trigger found
 */
export const getTrigger = (text) => {
  const m = /^\s*@(auto|cat|peepo)\b/i.exec(text || '');
  return m ? m[1].toLowerCase() : null;
};

/**
 * Returns an emoji suffix based on the trigger keyword used
 * @param {string} t - The trigger keyword ('auto', 'cat', or 'peepo')
 * @returns {string} Emoji suffix string for the response message
 */
export const suffixForTrigger = (t) => {
  if (t === 'cat') {return ' 🐈';}
  if (t === 'peepo') {return ' :peepo-yessir:';}
  return '';
};
