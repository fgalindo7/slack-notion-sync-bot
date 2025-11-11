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
- **Rich text handling:** Automatically strips Slack formatting (bold, italic) from field values while preserving email links.
- **ASAP date support:** Use "ASAP" as a shorthand for "20 minutes from now" in date fields.
- **Multi-channel support:** Monitor multiple Slack channels, each routing to different Notion databases (or many-to-one).
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

```shell
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

### Channel Monitoring Modes

On-Call Cat supports two modes for monitoring Slack channels:

#### **Single-Channel Mode (Default)**

Monitor one Slack channel and write to one Notion database.

```env
CHANNEL_DB_MAPPINGS=false
WATCH_CHANNEL_ID=C1234567890
NOTION_DATABASE_ID=abc123def456ghi789
```

#### **Multi-Channel Mode**

Monitor multiple Slack channels, each routing to potentially different Notion databases. This mode reads configuration from a `channel-mappings.json` file.

```env
CHANNEL_DB_MAPPINGS=true
# Optional: Custom path (defaults to ./channel-mappings.json)
CHANNEL_DB_MAPPINGS_FILE=/path/to/mappings.json
```

**channel-mappings.json format:**

```json
{
  "databases": [
    {
      "databaseId": "abc123def456ghi789",
      "description": "On-Call Issue Tracker - Main",
      "channels": [
        {
          "channelId": "C1234567890",
          "description": "#eng-pmo-lobby"
        },
        {
          "channelId": "C0987654321",
          "description": "#on-call-bot-test"
        }
      ]
    },
    {
      "databaseId": "xyz789uvw456rst123",
      "description": "Secondary Issue Tracker",
      "channels": [
        {
          "channelId": "C5555555555",
          "description": "#support-team"
        }
      ]
    }
  ]
}
```

This configuration allows:
- **One database → Many channels** (multiple channels write to the same database)
- **Many databases** (different channels route to different databases)
- **Self-documenting** with optional description fields for clarity

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
| CHANNEL_DB_MAPPINGS | Enable multi-channel mode (true/false, default: false) | ⚠️ Optional |
| CHANNEL_DB_MAPPINGS_FILE | Path to channel mappings JSON (default: ./channel-mappings.json) | ⚠️ Optional |
| WATCH_CHANNEL_ID | Slack channel ID to monitor (single-channel mode only) | ✅ Yes (single-channel) |
| NOTION_DATABASE_ID | Target Notion database ID (single-channel mode only) | ✅ Yes (single-channel) |
| ALLOW_THREADS | Allow parsing inside threads (true/false, default: false) | ⚠️ Optional |
| API_TIMEOUT | Timeout for API calls in ms (default: 10000) | ⚠️ Optional |
| SCHEMA_CACHE_TTL | Schema cache TTL in ms (default: 3600000 = 1 hour) | ⚠️ Optional |
| HEALTH_PORT | Port for health check server (default: 1987) | ⚠️ Optional |
| PORT | Port for main app (default: 1987) | ⚠️ Optional |
| LOG_LEVEL | Logging level: trace, debug, info, warn, error (default: info) | ⚠️ Optional |

Store these in `.env` or a secret manager (Doppler, Vault, etc).

---

### Invite the bot in your target channel

`/invite @On-Call Cat`

## 🚀 Running Locally

### Step 1: Install dependencies

```shell
npm install
```

### Step 2: Create `.env`

**Single-channel mode:**

```shell
# Required
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_LEVEL_TOKEN=xapp-...
NOTION_TOKEN=secret_...
NOTION_DATABASE_ID=abc123def456
WATCH_CHANNEL_ID=C123456789
CHANNEL_DB_MAPPINGS=false

# Optional
ALLOW_THREADS=false
API_TIMEOUT=10000
SCHEMA_CACHE_TTL=3600000
HEALTH_PORT=3000
LOG_LEVEL=info
```

**Multi-channel mode:**

```shell
# Required
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_LEVEL_TOKEN=xapp-...
NOTION_TOKEN=secret_...
CHANNEL_DB_MAPPINGS=true

# Optional
CHANNEL_DB_MAPPINGS_FILE=./channel-mappings.json
ALLOW_THREADS=false
API_TIMEOUT=10000
SCHEMA_CACHE_TTL=3600000
HEALTH_PORT=3000
LOG_LEVEL=info
```

Then create `channel-mappings.json` (see Configuration section above for format).

### Step 3: Start the app

```shell
npm start
```

✅ You should see:
⚡️ On-Call Cat running (Socket Mode)

---

## Example Slack Message

**Creating a new incident:**

```shell
@auto  
Priority: P1  
Issue: Production API timeout on checkout  
How to replicate: Attempt to purchase via /checkout  
Customer: Acme Corp  
1Password: support+k1893@acme.com
Needed by: ASAP
Relevant Links: <https://status.acme.io>, <https://notion.so/acme-api>
```

**Notes:**
- **Email formatting:** The bot automatically handles Slack's email formatting (e.g., `*<mailto:user@domain.com|user@domain.com>*`)
- **ASAP dates:** Use `ASAP` for urgent issues - it sets "Needed by" to 20 minutes from now
- **Rich text:** Bold (`*text*`) and italic (`_text_`) formatting is automatically stripped from all fields except "Reported by (text)"

**Updating an incident:** Simply edit your original message - the bot will detect the change and update the corresponding Notion page automatically!

---

## How It Works

### Core Components

| Component | Responsibility | Location |
|------------|----------------|----------|
| **BotMetrics** | Tracks success/failure metrics with encapsulated state | `lib/metrics.js` |
| **NotionSchemaCache** | Caches Notion DB schema with TTL-based auto-refresh | `lib/schema-cache.js` |
| **parseAutoBlock()** | Extracts key-value pairs from Slack messages | `lib/parser.js` |
| **normalizeEmail()** | Strips Slack formatting from emails (handles `*<mailto:...>*`) | `lib/parser.js` |
| **stripRichTextFormatting()** | Removes bold/italic markers while preserving URLs | `lib/parser.js` |
| **parseNeededByString()** | Parses dates including "ASAP" (20 min from now) | `lib/parser.js` |
| **missingFields()** | Validates that all required data is present | `lib/validation.js` |
| **typeIssues()** | Validates field types (dates, priorities, emails, etc.) | `lib/validation.js` |
| **loadChannelMappingsFromFile()** | Loads multi-channel configuration from JSON | `lib/config.js` |
| **getDatabaseIdForChannel()** | Routes channel messages to appropriate Notion database | `lib/config.js` |
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
- **Validator** (v13.12.0) - RFC-compliant email validation
- **Node.js 20** - Alpine-based Docker image
- **Pino** - High-performance structured JSON logging
- **p-throttle** - Rate limiting (3 req/s to Notion API)
- **p-timeout** - Timeout protection for API calls
- **ES Modules** - Modern JavaScript module system

---

## Development

Run with hot reload:

```shell
npm run dev
```

Run linter:

```shell
npm run lint
```

Check syntax:

```shell
node --check app.js
```

---

## Monitoring & Health Checks

The bot exposes two HTTP endpoints for monitoring:

### Health Check Endpoint

```shell
curl http://localhost:1987/health
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

```shell
curl http://localhost:1987/metrics
```

Returns detailed metrics in JSON format with success rates and uptime.

---

## 🐳 Deployment

### Local / Docker Deployment

```shell
docker compose build --no-cache
docker compose up -d
docker logs -f oncall-auto

# Expect: "⚡️ On-Call Cat running (Socket Mode)"
```

### Google Cloud Platform (Cloud Run)

Deploy to GCP Cloud Run for a production-ready, auto-scaling serverless environment.

#### Prerequisites

```shell
# Install gcloud SDK (macOS)
brew install google-cloud-sdk

# Authenticate and set project
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com
```

#### Quick Deployment with Interactive Wizard

The easiest way to deploy is using the interactive wizard that handles everything:

```shell
# Full deployment wizard (all 8 steps)
./scripts/setup-and-deploy.sh

# Or run specific steps only
./scripts/setup-and-deploy.sh --help
```

**Common scenarios:**

```shell
# Update secrets only
./scripts/setup-and-deploy.sh --required-secrets

# Rebuild and redeploy after code changes
./scripts/setup-and-deploy.sh --build-image --deploy

# Update channel mappings and redeploy
./scripts/setup-and-deploy.sh --channels-and-dbs --deploy
```

See [Script Flags Reference](docs/SCRIPT_FLAGS.md) for all available options.

#### Manual Deployment Steps

**1. Store secrets in Secret Manager:**

```shell
# Create secrets for credentials
echo -n "xoxb-your-slack-bot-token" | \
  gcloud secrets create slack-bot-token --data-file=-

echo -n "xapp-your-slack-app-token" | \
  gcloud secrets create slack-app-token --data-file=-

echo -n "your-notion-token" | \
  gcloud secrets create notion-token --data-file=-

# For multi-channel mode
cat channel-mappings.json | \
  gcloud secrets create channel-mappings --data-file=-
```

**2. Build and push Docker image:**

```shell
# Create Artifact Registry repository
gcloud artifacts repositories create oncall-cat \
  --repository-format=docker \
  --location=$REGION \
  --description="On-Call Cat Docker images"

# Submit build
gcloud builds submit --config cloudbuild.yaml
```

**3. Deploy to Cloud Run:**

```shell
# Single-channel mode
gcloud run deploy oncall-cat \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/oncall-cat/app:latest \
  --platform=managed \
  --region=$REGION \
  --min-instances=1 \
  --max-instances=3 \
  --memory=512Mi \
  --cpu=1 \
  --port=1987 \
  --set-env-vars="CHANNEL_DB_MAPPINGS=false,ALLOW_THREADS=false,LOG_LEVEL=info" \
  --set-secrets="SLACK_BOT_TOKEN=slack-bot-token:latest,SLACK_APP_LEVEL_TOKEN=slack-app-token:latest,NOTION_TOKEN=notion-token:latest" \
  --set-env-vars="WATCH_CHANNEL_ID=C1234567890,NOTION_DATABASE_ID=abc123def456"

# Multi-channel mode
gcloud run deploy oncall-cat \
  --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/oncall-cat/app:latest \
  --platform=managed \
  --region=$REGION \
  --min-instances=1 \
  --max-instances=3 \
  --memory=512Mi \
  --cpu=1 \
  --port=1987 \
  --set-env-vars="CHANNEL_DB_MAPPINGS=true,LOG_LEVEL=info" \
  --set-secrets="SLACK_BOT_TOKEN=slack-bot-token:latest,SLACK_APP_LEVEL_TOKEN=slack-app-token:latest,NOTION_TOKEN=notion-token:latest,/secrets/channel-mappings=channel-mappings:latest"
```

**4. Verify deployment:**

```shell
# Get service URL
gcloud run services describe oncall-cat --region=$REGION --format='value(status.url)'

# Check health
curl $(gcloud run services describe oncall-cat --region=$REGION --format='value(status.url)')/health

# View logs
gcloud run services logs tail oncall-cat --region=$REGION
```

#### Important Configuration Notes

- **`--min-instances=1`**: Required for Socket Mode (persistent Slack connection)
- **`--memory=512Mi`**: Sufficient for most workloads
- **`--timeout=300`**: 5-minute timeout for Notion API calls
- **Estimated cost**: ~$15-25/month for 24/7 operation

#### Updating Configuration

```shell
# Update environment variables
gcloud run services update oncall-cat \
  --region=$REGION \
  --set-env-vars="LOG_LEVEL=debug"

# Update secrets
echo -n "new-token" | \
  gcloud secrets versions add slack-bot-token --data-file=-

# Rollback if needed
gcloud run revisions list --service=oncall-cat --region=$REGION
gcloud run services update-traffic oncall-cat \
  --to-revisions=REVISION_NAME=100
```

#### CI/CD with GitHub

```shell
# Connect GitHub repository
gcloud beta builds triggers create github \
  --repo-name=slack-notion-sync-bot \
  --repo-owner=fgalindo7 \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml
```

See `scripts/` directory for automation scripts and `cloudbuild.yaml` for build configuration.

### Other Platforms

- **Fly.io**: `fly launch` and configure secrets
- **Railway.app**: Connect repo and set environment variables
- **AWS ECS/Fargate**: Use provided Dockerfile

---

## Folder Structure

```
on-call-cat/
├── app.js                        # Main application entry point
├── package.json                  # Dependencies and scripts
├── Dockerfile                    # Container image definition
├── docker-compose.yml            # Docker Compose configuration
├── cloudbuild.yaml               # GCP Cloud Build configuration
├── manifest.json                 # Slack app manifest
├── channel-mappings.json.example # Example multi-channel config
├── docs/                         # Documentation
│   ├── GCP_DEPLOYMENT.md        # Comprehensive GCP deployment guide
│   ├── GCP_QUICK_REFERENCE.md   # Quick command reference
│   ├── SETUP_FLOW.md            # Deployment wizard flow diagram
│   └── SCRIPT_FLAGS.md          # Script flags and selective execution
├── scripts/                      # Deployment automation scripts
│   ├── setup-gcp.sh             # Initial GCP setup (APIs, registry)
│   ├── create-secrets.sh        # Create secrets in Secret Manager
│   ├── deploy-gcp.sh            # Deploy to Cloud Run
│   ├── setup-and-deploy.sh      # Interactive deployment wizard
│   ├── view-logs.sh             # View Cloud Run logs
│   └── check-health.sh          # Check service health status
├── lib/                          # Modular components
│   ├── config.js                # Centralized configuration & multi-channel routing
│   ├── constants.js             # App-wide constants (defaults, regexes)
│   ├── metrics.js               # BotMetrics class for tracking
│   ├── parser.js                # Message parsing, email normalization, date parsing
│   ├── parser.test.js           # Unit tests for parser functions
│   ├── validation.js            # Field validation functions
│   ├── validation.test.js       # Unit tests for validation functions
│   └── schema-cache.js          # NotionSchemaCache class with TTL
├── logo/                         # Brand assets
│   ├── on-call-cat.png          # Main logo
│   └── on-call-cat-2.png        # Small logo variant
└── README.md                     # This file
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
- Default timeout is 10 seconds - increase with `API_TIMEOUT=15000`
- Check your network connection to Notion API
- Verify Notion API status at status.notion.so

**Bot doesn't respond to messages**
- In single-channel mode: Verify `WATCH_CHANNEL_ID` matches the channel
- In multi-channel mode: Check `channel-mappings.json` includes the channel
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
- Date formats: ISO-8601, natural language (e.g., "2025-11-07 17:00 PT"), or "ASAP"
- Emails: RFC-compliant format, supports +, -, numbers, and dots

**Email validation failing**
- Bot handles Slack's email formatting automatically (e.g., `*<mailto:user@domain.com|user@domain.com>*`)
- Supports complex emails like `support+k1893@domain.com`
- Check that the email follows RFC 5322 format

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
