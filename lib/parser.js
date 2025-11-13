/**
 * Message parsing utilities
 * Handles parsing of Slack messages, dates, emails, and extracting structured data
 */

import { PRIORITIES, DEFAULTS, REGEX } from './constants.js';

/**
 * Parses a "needed by" date/time string supporting multiple formats
 * Supports ISO dates, MM/DD/YYYY with optional time, YYYY-MM-DD formats, and "ASAP"
 * @param {string} input - The date string to parse (e.g., "11/04/2025 7PM", "2025-11-04", "ASAP")
 * @returns {Date|null} Parsed Date object or null if parsing fails
 * @example
 * parseNeededByString("11/04/2025 7PM") // Returns Date at 7PM on Nov 4, 2025
 * parseNeededByString("2025-11-04") // Returns Date at 5PM (default) on Nov 4, 2025
 * parseNeededByString("ASAP") // Returns Date 20 minutes from now
 */
export function parseNeededByString(input) {
  if (!input) {return null;}
  const s = String(input).trim();

  // Special handling for ASAP - set to 20 minutes from now
  if (s.toUpperCase() === 'ASAP') {
    const asapDate = new Date();
    asapDate.setMinutes(asapDate.getMinutes() + 20);
    return asapDate;
  }

  // 1) Try ISO or Date.parse-friendly first
  const isoTry = new Date(s);
  if (!isNaN(isoTry)) {return isoTry;}

  // 2) Match "MM/DD/YYYY [time]" with various time formats
  // Supports: 7PM, 7pm, 7 PM, 7 pm, 7:30pm, 7:30 PM, 7p.m., 7 P.M., 7A.M., 1432 (military), 8 (=0800)
  const re = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,4})(?::(\d{2}))?\s*(?:([AaPp])\.?([Mm])\.?)?)?$/;
  const m = s.match(re);
  if (m) {
    const [, mm, dd, yyyy, timeStr, min, a] = m;
    const year = yyyy.length === 2 ? 2000 + Number(yyyy) : Number(yyyy);
    const monthIdx = Number(mm) - 1;
    const day = Number(dd);
    
    let hours = DEFAULTS.NEEDED_BY_HOUR;
    let minutes = 0;
    
    if (timeStr) {
      const timeNum = Number(timeStr);
      
      // Military time (3-4 digits like 1432, or 800)
      if (timeStr.length >= 3) {
        hours = Math.floor(timeNum / 100);
        minutes = timeNum % 100;
      } 
      // Single/double digit with explicit minutes (e.g., "7:30")
      else if (min !== undefined) {
        hours = timeNum;
        minutes = Number(min);
      }
      // Single/double digit without am/pm - treat as military (e.g., "8" = 0800 = 8 AM)
      else if (!a) {
        hours = timeNum;
        minutes = 0;
      }
      // With am/pm indicator
      else {
        hours = timeNum;
        minutes = min ? Number(min) : 0;
      }
      
      // Apply AM/PM conversion
      if (a) {
        const ap = a.toLowerCase();
        if (ap === 'p' && hours < 12) {hours += 12;}
        if (ap === 'a' && hours === 12) {hours = 0;}
      }
    }

    const d = new Date(year, monthIdx, day, hours, minutes, 0, 0);
    if (!isNaN(d)) {return d;}
  }

  // 3) Match "YYYY-MM-DD [time]" with various time formats
  const re2 = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,4})(?::(\d{2}))?\s*(?:([AaPp])\.?([Mm])\.?)?)?$/;
  const m2 = s.match(re2);
  if (m2) {
    const [, yyyy, mm, dd, timeStr, min, a] = m2;
    const year = Number(yyyy);
    const monthIdx = Number(mm) - 1;
    const day = Number(dd);
    
    let hours = DEFAULTS.NEEDED_BY_HOUR;
    let minutes = 0;
    
    if (timeStr) {
      const timeNum = Number(timeStr);
      
      // Military time (3-4 digits like 1432, or 800)
      if (timeStr.length >= 3) {
        hours = Math.floor(timeNum / 100);
        minutes = timeNum % 100;
      } 
      // Single/double digit with explicit minutes (e.g., "7:30")
      else if (min !== undefined) {
        hours = timeNum;
        minutes = Number(min);
      }
      // Single/double digit without am/pm - treat as military (e.g., "8" = 0800 = 8 AM)
      else if (!a) {
        hours = timeNum;
        minutes = 0;
      }
      // With am/pm indicator
      else {
        hours = timeNum;
        minutes = min ? Number(min) : 0;
      }
      
      // Apply AM/PM conversion
      if (a) {
        const ap = a.toLowerCase();
        if (ap === 'p' && hours < 12) {hours += 12;}
        if (ap === 'a' && hours === 12) {hours = 0;}
      }
    }

    const d = new Date(year, monthIdx, day, hours, minutes, 0, 0);
    if (!isNaN(d)) {return d;}
  }

  return null; // let caller decide a default
}

/**
 * Normalizes Slack email formats to plain email addresses
 * Handles Slack's mailto links, angle-bracket wrapping, and extracts emails from text
 * @param {string} s - The potentially Slack-formatted email string or text containing an email
 * @returns {string} Plain email address without Slack formatting, or empty string if no email found
 * @example
 * normalizeEmail("<mailto:user@example.com|user@example.com>") // Returns "user@example.com"
 * normalizeEmail("<user@example.com>") // Returns "user@example.com"
 * normalizeEmail("an email email@acme.corp or hint") // Returns "email@acme.corp"
 */
export function normalizeEmail(s) {
  if (!s) {return '';}
  // First strip rich text formatting (* and _) that may wrap the email
  const stripped = stripRichTextFormatting(String(s).trim());
  const t = stripped.trim();
  
  // Slack often sends emails as <mailto:addr@domain.com|addr@domain.com>
  const mailto = REGEX.MAILTO_LINK.exec(t);
  if (mailto) {
    return (mailto[2] || mailto[1] || '').trim();
  }
  
  // Sometimes Slack wraps plain values like <addr@domain.com>
  const angle = REGEX.ANGLE_BRACKETS.exec(t);
  if (angle) {return angle[1].trim();}
  
  // Extract email from text that may contain extra words
  // Matches standard email format: local-part@domain
  const emailMatch = t.match(/\b[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\b/);
  if (emailMatch) {
    return emailMatch[0].trim();
  }
  
  return t;
}

/**
 * Strips Slack/Markdown rich text formatting characters from a string
 * Removes bold (*) and italic (_) markers while preserving URLs in angle brackets (<>)
 * @param {string} text - The text to strip formatting from
 * @returns {string} Text with formatting characters removed
 * @example
 * stripRichTextFormatting("*bold* and _italic_ text") // Returns "bold and italic text"
 * stripRichTextFormatting("Check <https://example.com|link>") // Returns "Check <https://example.com|link>"
 */
export function stripRichTextFormatting(text) {
  if (!text || typeof text !== 'string') {return '';}
  
  // Remove bold markers (*)
  let result = text.replace(/\*/g, '');
  
  // Remove italic/underline markers (_)
  result = result.replace(/_/g, '');
  
  return result;
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
export function parseAutoBlock(text = '') {
  const cleaned = text.replace(REGEX.TRIGGER_PREFIX, '');
  const pick = (label) => {
    const re = new RegExp(
      `^\\s*${label}\\s*:\\s*([\\s\\S]*?)(?=^\\s*\\w[\\w\\s/]*:\\s*|$)`,
      'mi'
    );
    const m = re.exec(cleaned);
    return m ? m[1].trim() : '';
  };

  let priority = stripRichTextFormatting(pick('Priority')).toUpperCase().replace(/\s+/g, '');
  if (![PRIORITIES.P0, PRIORITIES.P1, PRIORITIES.P2].includes(priority)) {priority = '';}

  const issue     = pick('Issue');
  const replicate = pick('How\\s*to\\s*replicate');
  const customer  = pick('Customer');
  const onepass   = pick('1\\s*Password');
  const neededRaw = pick('Needed\\s*by\\s*(?:date/?time)?');

  function defaultNeeded() {
    const d = new Date();
    d.setDate(d.getDate() + DEFAULTS.NEEDED_BY_DAYS);
    d.setHours(DEFAULTS.NEEDED_BY_HOUR, 0, 0, 0);
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

  const urls = Array.from(links.matchAll(REGEX.URL_PATTERN)).map(m => m[0]);

  return { priority, issue, replicate, customer, onepass, needed, neededRaw, neededValid, urls, linksText: links };
}
