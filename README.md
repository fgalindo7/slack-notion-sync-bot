<p align="center">
  <img src="logo/on-call-cat.png" alt="On-Call Cat Logo" width="180" height="180" />
</p>

<h1 align="center">⚡️ On-Call Cat</h1>

<p align="center">
  <b>Automate incident tracking, Slack triage, and Notion updates — effortlessly.</b><br>
  A lightweight <code>@slack/bolt</code> and <code>@notionhq/client</code> powered assistant for modern teams.
</p>

---

## Overview

**On-Call Cat** streamlines the process of handling on-call incidents in Slack by automatically parsing specially formatted messages (using the `@auto` syntax), validating key fields, and syncing updates directly into Notion.

No more manual copy-pasting — just type `@auto` in Slack and let the bot take care of the rest.

---

## Features

- **Smart message parsing:** Extracts structured data like priority, issue, customer, replication steps, etc.
- **Notion integration:** Automatically creates or updates corresponding pages in your Notion database.
- **Message edit support:** Edit your Slack message and the corresponding Notion page updates automatically.
- **Thread awareness:** Responds only to top-level messages (or optionally to threads).
- **Validation feedback:** Instantly replies if required fields are missing or have type errors.
- **Schema detection:** Dynamically matches your Notion DB schema without hardcoding.
- **Rate limiting:** Throttles Notion API calls to 3 requests/second to prevent rate limit errors.
- **Timeout protection:** 10-second timeout on API calls with graceful error handling.
- **Health monitoring:** Built-in health check and metrics endpoints for observability.
- **Graceful shutdown:** Proper cleanup on SIGTERM/SIGINT for zero-downtime deployments.
- **Structured logging:** JSON logs with Pino for production-ready observability.
- **Socket Mode ready:** Runs seamlessly via Slack Socket Mode for instant responsiveness.

---

## Architecture

```sh
Slack Message (@auto) 
    ↓
Bolt App (Socket Mode)
    ↓
Parser & Validator
    ↓
Rate Limiter (3 req/s) → Timeout Protection (10s) → Notion API
    ↓
Notion Database (Create/Update Page)
    ↓
Success/Error Response to Slack Thread
```

**Flow:**

1. **Slack** users post messages starting with `@auto` (or edit existing messages).
2. **Bolt App** listens via Socket Mode and extracts the message.
3. **Parser** extracts key-value pairs from the message text.
4. **Validator** checks for required fields and type correctness.
5. **Schema Cache** provides Notion DB schema (cached for 1 hour by default).
6. **Rate Limiter** throttles requests to prevent API abuse.
7. **Timeout Protection** ensures API calls complete within 10 seconds.
8. **Notion API** creates or updates the corresponding database entry.
9. **Response** posted to Slack thread with success confirmation or error details.

---

## Configuration

### Notion Database Requirements

Your Notion database must include at least one of these properties for message tracking:

- **Slack Message URL** (URL or Text type) - Stores the permalink to the Slack message
- **Slack Message TS** (Text or Number type) - Stores the message timestamp (canonical identifier)

The bot will auto-detect these columns by name. If neither exists, message updates won't work.

### Required Environment Variables

| Variable | Description | Required |
|-----------|-------------|----------|
| SLACK_BOT_TOKEN | Bot token from your Slack App | ✅ Yes |
| SLACK_APP_LEVEL_TOKEN | App-level token for Socket Mode | ✅ Yes |
| SLACK_SIGNING_SECRET | Slack signing secret (optional if using Socket Mode only) | ⚠️ Optional |
| NOTION_TOKEN | Notion API integration token | ✅ Yes |
| NOTION_DATABASE_ID | Target Notion database ID | ✅ Yes |
| WATCH_CHANNEL_ID | Slack channel ID to monitor | ✅ Yes |
| ALLOW_THREADS | Allow parsing inside threads (true/false, default: false) | ⚠️ Optional |
| NOTION_TIMEOUT | Timeout for Notion API calls in ms (default: 10000) | ⚠️ Optional |
| SCHEMA_CACHE_TTL | Schema cache TTL in ms (default: 3600000 = 1 hour) | ⚠️ Optional |
| HEALTH_CHECK_PORT | Port for health check server (default: 3001) | ⚠️ Optional |
| LOG_LEVEL | Logging level: trace, debug, info, warn, error (default: info) | ⚠️ Optional |

Store these in `.env` or a secret manager (Doppler, Vault, etc).

---

### Invite the bot in your target channel

`/invite @On-Call Cat`

## 🚀 Running Locally

### Step 1: Install dependencies

```sh
npm install
```

### Step 2: Create `.env`

```sh
# Required
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_LEVEL_TOKEN=xapp-...
NOTION_TOKEN=secret_...
NOTION_DATABASE_ID=abc123def456
WATCH_CHANNEL_ID=C123456789

# Optional
ALLOW_THREADS=false
NOTION_TIMEOUT=10000
SCHEMA_CACHE_TTL=3600000
HEALTH_CHECK_PORT=3001
LOG_LEVEL=info
```

### Step 3: Start the app

```sh
npm start
```

✅ You should see:
⚡️ On-Call Cat running (Socket Mode)

---

## Example Slack Message

**Creating a new incident:**

```sh
@auto  
Priority: P1  
Issue: Production API timeout on checkout  
How to replicate: Attempt to purchase via /checkout  
Customer: Acme Corp  
1Password: acme-prod-api  
Needed by: 2025-11-07 17:00 PT  
Relevant Links: <https://status.acme.io>, <https://notion.so/acme-api>
```

**Updating an incident:** Simply edit your original message - the bot will detect the change and update the corresponding Notion page automatically!

---

## How It Works

### Core Components

| Component | Responsibility | Location |
|------------|----------------|----------|
| **BotMetrics** | Tracks success/failure metrics with encapsulated state | `lib/metrics.js` |
| **NotionSchemaCache** | Caches Notion DB schema with TTL-based auto-refresh | `lib/schema-cache.js` |
| **parseAutoBlock()** | Extracts key-value pairs from Slack messages | `lib/parser.js` |
| **missingFields()** | Validates that all required data is present | `lib/validation.js` |
| **typeIssues()** | Validates field types (dates, priorities, etc.) | `lib/validation.js` |
| **createOrUpdateNotionPage()** | Creates or updates Notion pages dynamically | `app.js` |
| **findPageForMessage()** | Finds existing pages by Slack TS (ensures idempotent updates) | `app.js` |
| **getSchema()** | Retrieves cached Notion DB schema, auto-refreshes when expired | `app.js` |

### Modular Architecture

The codebase follows a hybrid functional/OO approach:
- **Stateful components** (metrics, cache) use classes with private fields
- **Pure functions** (parsers, validators) remain functional for testability
- **Configuration** centralized in `lib/config.js`
- **Constants** extracted to `lib/constants.js` for maintainability

---

## Tech Stack

- **Slack Bolt JS** (v3.18.0) - Slack app framework with Socket Mode
- **Notion SDK** (v2.2.15) - Official Notion API client
- **Node.js 20** - Alpine-based Docker image
- **Pino** - High-performance structured JSON logging
- **p-throttle** - Rate limiting (3 req/s to Notion API)
- **p-timeout** - Timeout protection for API calls
- **ES Modules** - Modern JavaScript module system

---

## Development

Run with hot reload:

```sh
npm run dev
```

Run linter:

```sh
npm run lint
```

Check syntax:

```sh
node --check app.js
```

---

## Monitoring & Health Checks

The bot exposes two HTTP endpoints for monitoring:

### Health Check Endpoint

```sh
curl http://localhost:3001/health
```

**Response (healthy):**

```json
{
  "status": "healthy",
  "uptime": 3600.5,
  "lastActivity": "2025-11-06T10:30:00.000Z",
  "metrics": {
    "messagesProcessed": 42,
    "messagesCreated": 30,
    "messagesUpdated": 12,
    "messagesFailed": 2,
    "validationErrors": 5,
    "apiTimeouts": 1,
    "rateLimitHits": 0,
    "notionErrors": 1,
    "uptimeSeconds": 3600,
    "successRate": "95.24%"
  }
}
```

### Metrics Endpoint

```sh
curl http://localhost:3001/metrics
```

Returns detailed metrics in JSON format with success rates and uptime.

---

## 🐳 Deployment

You can deploy easily using Docker:

```sh
docker compose build --no-cache
docker compose up -d
docker logs -f oncall-auto

# Expect: "⚡️ On-Call Cat running (Socket Mode)"
```

Or via Cloud Run / Fly.io / Railway.app.

---

## Folder Structure

```
on-call-cat/
├── app.js                    # Main application entry point
├── package.json              # Dependencies and scripts
├── Dockerfile                # Container image definition
├── docker-compose.yml        # Docker Compose configuration
├── manifest.json             # Slack app manifest
├── lib/                      # Modular components
│   ├── config.js            # Centralized configuration
│   ├── constants.js         # App-wide constants (defaults, regexes)
│   ├── metrics.js           # BotMetrics class for tracking
│   ├── parser.js            # Message parsing utilities
│   ├── schema-cache.js      # NotionSchemaCache class with TTL
│   └── validation.js        # Field validation functions
├── logo/                     # Brand assets
│   ├── on-call-cat.png      # Main logo
│   └── on-call-cat-2.png    # Small logo variant
└── README.md                 # This file
```

---

## Troubleshooting

### Common Issues

**"Failed to load Notion schema" error**
- Verify `NOTION_TOKEN` has access to the database
- Check `NOTION_DATABASE_ID` is correct
- Ensure the Notion integration is connected to the database (Share → Add connection)

**"I couldn't write to Notion due to insufficient permissions"**
- Open the database in Notion as a full page
- Click **Share** → **Add connections** → Select your integration
- Grant **Can edit** access

**"Request timed out" errors**
- Default timeout is 10 seconds - increase with `NOTION_TIMEOUT=15000`
- Check your network connection to Notion API
- Verify Notion API status at status.notion.so

**Bot doesn't respond to messages**
- Verify `WATCH_CHANNEL_ID` matches the channel where you're posting
- Invite the bot to the channel: `/invite @On-Call Cat`
- Check bot has `channels:history` and `channels:read` scopes
- Ensure Socket Mode is enabled in Slack app settings

**Message edits don't update Notion**
- Verify your Notion database has "Slack Message URL" or "Slack Message TS" property
- Check the property type is URL/Text (for URL) or Text/Number (for TS)
- Original message must have been successfully created first

**High validation error rate**
- Check the example message format matches your Notion schema
- Required fields are case-insensitive but must match property names
- Date formats should be ISO-8601 or natural language (e.g., "2025-11-07 17:00 PT")

---

## 🤝 Contributing

1. Fork  
2. Create a branch (git checkout -b feature/awesome)  
3. Commit (git commit -am "Add awesome feature")  
4. Push and open a PR  

---

## License

MIT © 2025 — Francisco

---

<p align="center">
  <sub>Built with 💙 by humans (and cats) who hate manual Notion updates.</sub><br>
  <img src="logo/on-call-cat-2.png" width="100" alt="On-Call Cat logo small">
</p>
