/**
 * Application configuration
 * Centralizes all environment variable loading and validation
 */

import { createLogger } from './logger.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Initialize logger for config validation
const logger = createLogger('config');

/**
 * Loads channel-to-database mappings from JSON file
 * @param {string} filePath - Path to the mappings file
 * @returns {Object} Mappings object with databaseId as keys, array of channelIds as values
 * @throws {Error} If file doesn't exist or is invalid JSON
 */
function loadChannelMappingsFromFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Channel mappings file not found: ${filePath}`);
  }
  
  try {
    const content = readFileSync(filePath, 'utf8');
    const json = JSON.parse(content);
    
    // Validate structure: {databases: [{databaseId, channels: [{channelId}]}]}
    if (!json.databases || !Array.isArray(json.databases)) {
      throw new Error('Mappings file must have a "databases" array');
    }
    
    const mappings = {};
    
    for (const db of json.databases) {
      if (!db.databaseId) {
        throw new Error('Each database entry must have a "databaseId" field');
      }
      
      if (!db.channels || !Array.isArray(db.channels)) {
        throw new Error(`Database "${db.databaseId}" must have a "channels" array`);
      }
      
      if (db.channels.length === 0) {
        logger.warn({ databaseId: db.databaseId }, 'Database has no channels configured');
      }
      
      const channelIds = [];
      for (const channel of db.channels) {
        if (!channel.channelId) {
          throw new Error(`Channel in database "${db.databaseId}" must have a "channelId" field`);
        }
        channelIds.push(channel.channelId);
      }
      
      mappings[db.databaseId] = channelIds;
      
      logger.debug({ 
        databaseId: db.databaseId,
        description: db.description,
        channelCount: channelIds.length
      }, 'Loaded database mapping');
    }
    
    return mappings;
  } catch (err) {
    if (err.name === 'SyntaxError') {
      throw new Error(`Invalid JSON in mappings file: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Converts database-to-channels mapping to flat array for internal use
 * @param {Object} dbToChannels - Object with {databaseId: [channelIds]}
 * @returns {Array} Array of {channelId, databaseId} objects
 */
function convertToChannelMappings(dbToChannels) {
  const mappings = [];
  for (const [databaseId, channelIds] of Object.entries(dbToChannels)) {
    for (const channelId of channelIds) {
      mappings.push({ channelId, databaseId });
    }
  }
  return mappings;
}

/**
 * Loads and validates all configuration from environment variables
 * @returns {Object} Configuration object with all validated settings
 * @throws {Error} If required environment variables are missing
 */
export function loadConfig() {
  const legacyChannelId = process.env.WATCH_CHANNEL_ID || '';
  const legacyDatabaseId = process.env.NOTION_DATABASE_ID || '';
  
  // Check if multi-channel mode is enabled
  const useMultiChannel = String(process.env.CHANNEL_DB_MAPPINGS || 'false').toLowerCase() === 'true';
  
  let channelMappings = [];
  let dbToChannels = {};
  
  if (useMultiChannel) {
    // Load mappings from environment variable or JSON file
    if (process.env.CHANNEL_MAPPINGS_JSON) {
      try {
        const json = JSON.parse(process.env.CHANNEL_MAPPINGS_JSON);
        
        // Parse the same structure as file: {databases: [{databaseId, channels: [{channelId}]}]}
        if (!json.databases || !Array.isArray(json.databases)) {
          throw new Error('CHANNEL_MAPPINGS_JSON must have a "databases" array');
        }
        
        for (const db of json.databases) {
          if (!db.databaseId) {
            throw new Error('Each database entry must have a "databaseId" field');
          }
          
          if (!db.channels || !Array.isArray(db.channels)) {
            throw new Error(`Database "${db.databaseId}" must have a "channels" array`);
          }
          
          const channelIds = [];
          for (const channel of db.channels) {
            if (!channel.channelId) {
              throw new Error(`Channel in database "${db.databaseId}" must have a "channelId" field`);
            }
            channelIds.push(channel.channelId);
          }
          
          dbToChannels[db.databaseId] = channelIds;
        }
        
        channelMappings = convertToChannelMappings(dbToChannels);
        
        logger.info({ 
          source: 'environment variable',
          databases: Object.keys(dbToChannels).length,
          totalChannels: channelMappings.length
        }, 'Multi-channel mode enabled');
      } catch (error) {
        logger.error({ error: error.message }, 'Failed to parse CHANNEL_MAPPINGS_JSON');
        throw new Error(`Invalid CHANNEL_MAPPINGS_JSON format: ${error.message}`);
      }
    } else {
      // Fallback to file
      const mappingsPath = process.env.CHANNEL_DB_MAPPINGS_FILE || join(process.cwd(), 'channel-mappings.json');
      dbToChannels = loadChannelMappingsFromFile(mappingsPath);
      channelMappings = convertToChannelMappings(dbToChannels);
      
      logger.info({ 
        mappingsFile: mappingsPath,
        databases: Object.keys(dbToChannels).length,
        totalChannels: channelMappings.length
      }, 'Multi-channel mode enabled');
    }
  } else {
    // Legacy single-channel mode
    if (legacyChannelId && legacyDatabaseId) {
      channelMappings = [{ channelId: legacyChannelId, databaseId: legacyDatabaseId }];
      dbToChannels = { [legacyDatabaseId]: [legacyChannelId] };
    }
    logger.info('Single-channel mode (legacy)');
  }
  
  const config = {
    // Slack configuration
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_LEVEL_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET || 'unused',
      watchChannelId: legacyChannelId, // Kept for backward compatibility
      allowThreads: String(process.env.ALLOW_THREADS || '').toLowerCase() === 'true'
    },
    
    // Notion configuration
    notion: {
      token: process.env.NOTION_TOKEN,
      databaseId: legacyDatabaseId, // Kept for backward compatibility
      channelMappings: channelMappings, // Array of {channelId, databaseId} objects
      dbToChannels: dbToChannels, // Object of {databaseId: [channelIds]}
      multiChannelMode: useMultiChannel
    },
    
    // Default values (configurable)
    defaults: {
      neededByDays: parseInt(process.env.DEFAULT_NEEDED_BY_DAYS || '30', 10),
      neededByHour: parseInt(process.env.DEFAULT_NEEDED_BY_HOUR || '17', 10),
      dbTitle: process.env.DEFAULT_DB_TITLE || 'On-call Issue Tracker DB'
    },
    
    // API configuration
    api: {
      timeout: parseInt(process.env.API_TIMEOUT || '10000', 10),
      rateLimitPerSecond: 3 // Notion API limit
    },
    
    // Server configuration
    server: {
      port: parseInt(process.env.PORT || '1987', 10),
      healthPort: parseInt(process.env.HEALTH_PORT || '1987', 10)
    },
    
    // Logging configuration
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      pretty: process.env.NODE_ENV !== 'production'
    },
    
    // Environment
    env: process.env.NODE_ENV || 'development'
  };

  // Validate required fields
  const requiredFields = [
    { path: 'slack.botToken', name: 'SLACK_BOT_TOKEN' },
    { path: 'slack.appToken', name: 'SLACK_APP_LEVEL_TOKEN' },
    { path: 'notion.token', name: 'NOTION_TOKEN' }
  ];
  
  // Either legacy config or channel mappings required
  if (channelMappings.length === 0) {
    requiredFields.push({ path: 'notion.databaseId', name: 'NOTION_DATABASE_ID' });
  }

  const missing = requiredFields.filter(field => {
    const value = field.path.split('.').reduce((obj, key) => obj?.[key], config);
    return !value;
  });

  if (missing.length > 0) {
    const missingNames = missing.map(f => f.name).join(', ');
    logger.error({ 
      missing: missing.map(f => f.name),
      slack: {
        botToken: !!config.slack.botToken,
        appToken: !!config.slack.appToken
      },
      notion: {
        token: !!config.notion.token,
        databaseId: !!config.notion.databaseId,
        mappingsCount: channelMappings.length
      }
    }, 'Missing required environment variables');
    throw new Error(`Missing required environment variables: ${missingNames}`);
  }
  
  // Validate channel mappings
  if (channelMappings.length > 0) {
    for (let i = 0; i < channelMappings.length; i++) {
      const mapping = channelMappings[i];
      if (!mapping.channelId || !mapping.databaseId) {
        throw new Error(`Invalid channel mapping at index ${i}: missing channelId or databaseId`);
      }
    }
    
    if (useMultiChannel) {
      logger.info({ 
        databases: Object.keys(dbToChannels).length,
        totalMappings: channelMappings.length,
        dbToChannels: Object.entries(dbToChannels).map(([db, channels]) => ({ 
          database: db, 
          channelCount: channels.length 
        }))
      }, 'Channel-to-database mappings loaded from file');
    }
  }

  // Validate default value ranges
  if (config.defaults.neededByDays < 1 || config.defaults.neededByDays > 365) {
    logger.warn({ 
      value: config.defaults.neededByDays 
    }, 'DEFAULT_NEEDED_BY_DAYS out of range (1-365), using 30');
    config.defaults.neededByDays = 30;
  }

  if (config.defaults.neededByHour < 0 || config.defaults.neededByHour > 23) {
    logger.warn({ 
      value: config.defaults.neededByHour 
    }, 'DEFAULT_NEEDED_BY_HOUR out of range (0-23), using 17');
    config.defaults.neededByHour = 17;
  }

  // Log configuration (without sensitive data)
  logger.info({
    slack: {
      watchChannelId: config.slack.watchChannelId || 'all channels',
      allowThreads: config.slack.allowThreads
    },
    defaults: config.defaults,
    api: {
      timeout: `${config.api.timeout}ms`,
      rateLimit: `${config.api.rateLimitPerSecond} requests/second`
    },
    server: {
      port: config.server.port,
      healthPort: config.server.healthPort
    },
    env: config.env
  }, 'Configuration loaded and validated');

  return config;
}

/**
 * Export configuration singleton
 * Only load once to avoid multiple validation passes
 */
let cachedConfig = null;

export function getConfig() {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Gets the Notion database ID for a given Slack channel
 * @param {string} channelId - Slack channel ID
 * @returns {string|null} Notion database ID or null if channel not mapped
 */
export function getDatabaseIdForChannel(channelId) {
  const config = getConfig();
  
  // Check channel mappings first
  if (config.notion.channelMappings && config.notion.channelMappings.length > 0) {
    const mapping = config.notion.channelMappings.find(m => m.channelId === channelId);
    return mapping ? mapping.databaseId : null;
  }
  
  // Fallback to legacy single-channel mode
  if (config.slack.watchChannelId && channelId === config.slack.watchChannelId) {
    return config.notion.databaseId;
  }
  
  // If no watchChannelId set (all channels mode) and only one database
  if (!config.slack.watchChannelId && config.notion.databaseId) {
    return config.notion.databaseId;
  }
  
  return null;
}

/**
 * Checks if a channel is monitored by the bot
 * @param {string} channelId - Slack channel ID
 * @returns {boolean} True if channel should be monitored
 */
export function isChannelMonitored(channelId) {
  return getDatabaseIdForChannel(channelId) !== null;
}
