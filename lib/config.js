/**
 * Application configuration
 * Centralizes all environment variable loading and validation
 */

import pino from 'pino';

// Initialize logger for config validation
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: { colorize: true }
  } : undefined
});

/**
 * Loads and validates all configuration from environment variables
 * @returns {Object} Configuration object with all validated settings
 * @throws {Error} If required environment variables are missing
 */
export function loadConfig() {
  const config = {
    // Slack configuration
    slack: {
      botToken: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_LEVEL_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET || 'unused',
      watchChannelId: process.env.WATCH_CHANNEL_ID || '',
      allowThreads: String(process.env.ALLOW_THREADS || '').toLowerCase() === 'true'
    },
    
    // Notion configuration
    notion: {
      token: process.env.NOTION_TOKEN,
      databaseId: process.env.NOTION_DATABASE_ID
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
      healthPort: parseInt(process.env.HEALTH_PORT || '3000', 10)
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
    { path: 'notion.token', name: 'NOTION_TOKEN' },
    { path: 'notion.databaseId', name: 'NOTION_DATABASE_ID' }
  ];

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
        databaseId: !!config.notion.databaseId
      }
    }, 'Missing required environment variables');
    throw new Error(`Missing required environment variables: ${missingNames}`);
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
