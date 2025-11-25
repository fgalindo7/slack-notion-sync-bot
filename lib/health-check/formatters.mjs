/**
 * @fileoverview Shared formatting utilities for health check scripts
 * @author Francisco Galindo
 */

import boxen from 'boxen';

// ANSI color codes
export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  orange: '\x1b[38;5;208m', // 256-color orange for staging
};

/**
 * Format date in short format: MMM DD HH:MM
 */
export function formatShortDate(isoString) {
  if (!isoString) {
    return 'unknown';
  }
  const date = new Date(isoString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const mins = String(date.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day} ${hours}:${mins}`;
}

/**
 * Format uptime in human-readable format
 */
export function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}

/**
 * Format time ago (e.g., '5 minutes ago')
 */
export function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (seconds < 60) {
    return `${seconds} seconds ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} minutes ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)} hours ago`;
  }
  return `${Math.floor(seconds / 86400)} days ago`;
}

/**
 * Format duration
 */
export function formatDuration(seconds) {
  if (!seconds) {
    return 'unknown';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/**
 * Draw a box using boxen with fixed width
 */
export function drawBox(content, width = 60) {
  const text = Array.isArray(content) ? content.join('\n') : content;
  return boxen(text, {
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    margin: 0,
    borderStyle: 'round',
    borderColor: 'white',
    width: width,
  });
}

/**
 * Draw header using boxen with fixed width
 */
export function drawHeader(title, width = 60) {
  return boxen(title, {
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    margin: 0,
    borderStyle: 'double',
    borderColor: 'white',
    textAlignment: 'center',
    width: width,
  });
}

/**
 * Create terminal hyperlink (OSC 8) if supported
 * Falls back to truncated URL if not supported
 */
export function createLink(url, text, maxLength = 30) {
  // Check if terminal supports hyperlinks (basic check)
  const supportsHyperlinks = process.env.TERM_PROGRAM === 'iTerm.app' ||
                             process.env.TERM_PROGRAM === 'vscode' ||
                             process.env.TERM_PROGRAM === 'WezTerm';

  if (supportsHyperlinks) {
    // OSC 8 hyperlink format
    return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
  }

  // Fallback: truncate URL
  return shortenUrl(url, maxLength);
}

/**
 * Shorten URL with smart truncation
 */
export function shortenUrl(url, maxLength = 35) {
  if (url.length <= maxLength) {
    return url;
  }

  // Keep protocol and beginning, plus end
  const start = url.substring(0, 22);
  const end = url.substring(url.length - 10);
  return `${start}...${end}`;
}

/**
 * Get cat color based on deployment target
 */
export function getCatColor(target = '') {
  const t = target.toLowerCase();
  if (t === 'local') {
    return colors.cyan;
  } else if (t === 'gcp' || t === 'gcp-staging' || t === 'staging') {
    return colors.orange; // strawberry-blonde
  } else if (t === 'gcp-prod' || t === 'prod') {
    return colors.red;
  }
  // Default to cyan if no target specified
  return colors.cyan;
}
