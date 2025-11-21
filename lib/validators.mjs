/**
 * @fileoverview Validation functions for GCP and secret values
 */

import { DEFAULTS } from '../config/defaults.mjs';

/**
 * Validates GCP project ID format
 * @param {string} projectId - Project ID to validate
 * @throws {Error} If project ID is invalid
 */
export function validateProjectId(projectId) {
  if (!projectId) {
    throw new Error('Project ID is required');
  }

  // GCP project ID rules:
  // - Must be 6 to 30 characters
  // - Must start with a lowercase letter
  // - Can only contain lowercase letters, digits, and hyphens
  // - Cannot end with a hyphen
  const projectIdRegex = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

  if (!projectIdRegex.test(projectId)) {
    throw new Error(
      `Invalid project ID format: ${projectId}\n` +
      'Project ID must:\n' +
      '  - Be 6-30 characters long\n' +
      '  - Start with a lowercase letter\n' +
      '  - Contain only lowercase letters, digits, and hyphens\n' +
      '  - Not end with a hyphen'
    );
  }
}

/**
 * Validates GCP region
 * @param {string} region - Region to validate
 * @throws {Error} If region is invalid
 */
export function validateRegion(region) {
  if (!region) {
    throw new Error('Region is required');
  }

  if (!DEFAULTS.validRegions.includes(region)) {
    throw new Error(
      `Invalid region: ${region}\n` +
      `Valid regions are: ${DEFAULTS.validRegions.join(', ')}`
    );
  }
}

/**
 * Validates Slack bot token format
 * @param {string} token - Slack bot token
 * @throws {Error} If token format is invalid
 */
export function validateSlackBotToken(token) {
  if (!token) {
    throw new Error('Slack bot token is required');
  }

  if (!token.startsWith('xoxb-')) {
    throw new Error('Slack bot token must start with "xoxb-"');
  }

  if (token.length < 20) {
    throw new Error('Slack bot token appears to be too short');
  }
}

/**
 * Validates Slack app-level token format
 * @param {string} token - Slack app-level token
 * @throws {Error} If token format is invalid
 */
export function validateSlackAppToken(token) {
  if (!token) {
    throw new Error('Slack app-level token is required');
  }

  if (!token.startsWith('xapp-')) {
    throw new Error('Slack app-level token must start with "xapp-"');
  }

  if (token.length < 20) {
    throw new Error('Slack app-level token appears to be too short');
  }
}

/**
 * Validates Notion integration token format
 * @param {string} token - Notion integration token
 * @throws {Error} If token format is invalid
 */
export function validateNotionToken(token) {
  if (!token) {
    throw new Error('Notion integration token is required');
  }

  if (!token.startsWith('secret_') && !token.startsWith('ntn_')) {
    throw new Error('Notion token must start with "secret_" or "ntn_"');
  }

  if (token.length < 20) {
    throw new Error('Notion token appears to be too short');
  }
}

/**
 * Validates channel-mappings JSON format
 * @param {string} jsonStr - JSON string to validate
 * @throws {Error} If JSON is invalid
 */
export function validateChannelMappings(jsonStr) {
  if (!jsonStr) {
    throw new Error('Channel mappings JSON is required');
  }

  try {
    const parsed = JSON.parse(jsonStr);

    if (!parsed.databases || !Array.isArray(parsed.databases)) {
      throw new Error('Channel mappings must have a "databases" array');
    }

    for (const db of parsed.databases) {
      if (!db.channel_id || !db.database_id) {
        throw new Error('Each database mapping must have "channel_id" and "database_id"');
      }
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON format: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Sanitizes error messages to remove sensitive information
 * @param {Error|string} error - Error object or message
 * @param {string[]} sensitiveValues - Values to redact
 * @returns {string} Sanitized error message
 */
export function sanitizeError(error, sensitiveValues = []) {
  let message = error instanceof Error ? error.message : error;

  for (const value of sensitiveValues) {
    if (value && value.length > 3) {
      // Replace all but first 4 chars with asterisks
      const redacted = value.substring(0, 4) + '*'.repeat(Math.min(value.length - 4, 20));
      message = message.replaceAll(value, redacted);
    }
  }

  return message;
}

/**
 * Validates a timeout value
 * @param {number} timeout - Timeout in seconds
 * @param {number} min - Minimum allowed timeout
 * @param {number} max - Maximum allowed timeout
 * @throws {Error} If timeout is invalid
 */
export function validateTimeout(timeout, min = 60, max = 3600) {
  if (typeof timeout !== 'number' || isNaN(timeout)) {
    throw new Error('Timeout must be a number');
  }

  if (timeout < min) {
    throw new Error(`Timeout must be at least ${min} seconds`);
  }

  if (timeout > max) {
    throw new Error(`Timeout cannot exceed ${max} seconds`);
  }
}

export default {
  validateProjectId,
  validateRegion,
  validateSlackBotToken,
  validateSlackAppToken,
  validateNotionToken,
  validateChannelMappings,
  sanitizeError,
  validateTimeout,
};
