# Google Cloud Platform Deployment Guide

Complete guide for deploying On-Call Cat to Google Cloud Run with SDK-based Cloud Build automation.

## Table of Contents

1. [Overview](#overview)
2. [Infrastructure Components](#infrastructure-components)
3. [Prerequisites](#prerequisites)
4. [Initial Setup](#initial-setup)
5. [Cloud Build SDK Architecture](#cloud-build-sdk-architecture)
6. [Deployment](#deployment)
7. [Verification](#verification)
8. [Configuration Updates](#configuration-updates)
9. [Monitoring & Operations](#monitoring--operations)
10. [IAM & Security](#iam--security)
11. [CI/CD Setup](#cicd-setup)
12. [Troubleshooting](#troubleshooting)
13. [Quick Reference](#quick-reference)
14. [Cost Estimates](#cost-estimates)

---

## Overview

This project uses **SDK-based Cloud Build automation** instead of complex YAML configurations. Benefits include:

✅ **No substitution errors** - All values computed at runtime in JavaScript
✅ **Unique release names** - Format: `rel-<SHA>-<timestamp>`
✅ **Under 63 chars** - Fits Cloud Run rollout resource ID limits
✅ **Maintainable** - Logic in JavaScript, not YAML + bash
✅ **GitHub integration** - Automatic builds on push to main

### How It Works

```
GitHub Push → Cloud Build Trigger
    ↓
cloudbuild.yaml (2-step wrapper)
    ├─ Install npm dependencies
    └─ Run infrastructure/cloud-build-automation.mjs
        ├─ Build Docker image (Cloud Build SDK)
        ├─ Push to Artifact Registry
        └─ Create release: rel-<SHA>-<timestamp> (Cloud Deploy SDK)
```

---

## Infrastructure Components

### SDK Scripts

| File | Purpose |
|------|---------|
| [infrastructure/cloud-build-automation.mjs](../infrastructure/cloud-build-automation.mjs) | SDK-based build & deploy automation (replaces complex cloudbuild.yaml) |
| [infrastructure/setup-infrastructure.mjs](../infrastructure/setup-infrastructure.mjs) | Enable APIs, create Artifact Registry, manage secrets, apply IAM |
| [infrastructure/deploy-automation.mjs](../infrastructure/deploy-automation.mjs) | Initialize Cloud Deploy pipeline, create releases, promote targets |

### Configuration & Validation

| File | Purpose |
|------|---------|
| [config/defaults.mjs](../config/defaults.mjs) | Centralized configuration values (regions, timeouts, service names) |
| [lib/validators.mjs](../lib/validators.mjs) | Validation functions for GCP resources, secrets, and error sanitization |

### Deployment Configuration

| File | Purpose |
|------|---------|
| [cloudbuild.yaml](../cloudbuild.yaml) | Minimal wrapper for Cloud Build triggers (GitHub integration) |
| [clouddeploy.yaml](../clouddeploy.yaml) | Pipeline & targets (staging, production) |
| [skaffold.yaml](../skaffold.yaml) | Build + deploy definitions |
| [service.yaml](../service.yaml) | Cloud Run service spec (resources, env, secrets, health) |

---

## Prerequisites

### Required Tools

- **gcloud SDK**: [Install here](https://cloud.google.com/sdk/docs/install)
- **Node.js 20+**: [Install here](https://nodejs.org/)
- **jq** (for health checks): `brew install jq`
- **Docker** (for local testing): [Install here](https://docs.docker.com/get-docker/)

### Required Credentials

Have these ready before starting:

- **Slack Bot Token** (starts with `xoxb-`)
- **Slack App-Level Token** (starts with `xapp-`)
- **Notion Integration Token** (starts with `secret_` or `ntn_`)
- **Channel ID(s)** and **Database ID(s)** from your Slack/Notion setup

### Required Secrets

| Secret | Description |
|--------|-------------|
| `slack-bot-token` | Slack bot OAuth token (xoxb-) |
| `slack-app-token` | Slack app-level token (xapp-) |
| `notion-token` | Notion integration token |
| `channel-mappings` (optional) | Multi-channel config JSON |

### GCP Account Setup

1. Create or select a GCP project
2. Enable billing for the project
3. Note your **Project ID**

---

## Initial Setup

### 1. Authenticate with GCP

```bash
# Login to GCP
gcloud auth login

# Set your project ID (replace with your actual project ID)
export PROJECT_ID="your-gcp-project-id"
gcloud config set project $PROJECT_ID

# Set your preferred region
export REGION="us-central1"  # or us-east1, europe-west1, etc.
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Infrastructure Setup

Provision required resources (APIs, Artifact Registry, secrets, IAM roles):

```bash
# Interactive (recommended locally; will prompt for secrets)
npm run infra:setup

# Or with explicit flags
node infrastructure/setup-infrastructure.mjs --project $PROJECT_ID --region $REGION

# Non-interactive / automation
echo 'y' | npm run infra:setup

# Dry run (preview actions; no changes made)
DRY_RUN=1 npm run infra:setup
```

If using a custom Cloud Build service account:

```bash
export CLOUD_BUILD_SA_EMAIL="cloud-build@${PROJECT_ID}.iam.gserviceaccount.com"
npm run infra:setup
```

**What this does:**

- Enables APIs: Cloud Run, Artifact Registry, Secret Manager, Cloud Build, Cloud Deploy, IAM
- Creates Artifact Registry repository (Docker)
- Configures Docker authentication
- Prompts for secrets (tokens, channel mappings) if not present
- Grants IAM roles to Cloud Build service account:
  - `roles/run.admin`
  - `roles/iam.serviceAccountUser`
  - `roles/clouddeploy.releaser`
  - `roles/clouddeploy.viewer`
  - `roles/artifactregistry.writer`
- Grants IAM roles to runtime service account:
  - `roles/secretmanager.secretAccessor`
  - `roles/artifactregistry.reader`
  - `roles/aiplatform.user` (only if ML features used)
- Grants Cloud Deploy service agent ActAs permission on runtime SA

**Context resolution precedence:**

All infra/ops scripts use: **Flags > gcloud config > environment**

Examples:

```bash
# Explicit flags (recommended for CI or multiple projects)
node infrastructure/setup-infrastructure.mjs --project $PROJECT_ID --region us-central1

# Or rely on gcloud config (no flags needed)
gcloud config set project $PROJECT_ID
node infrastructure/setup-infrastructure.mjs --region us-central1

# Env vars are last resort and optional
export GCP_PROJECT_ID=$PROJECT_ID
export REGION=us-central1
node infrastructure/setup-infrastructure.mjs
```

**Safe re-run:**

It is safe to re-run `setup-infrastructure.mjs`; idempotent operations (enable APIs, existing secrets, existing repo) are skipped; IAM bindings are merged.

Verify secrets:

```bash
gcloud secrets list
```

---

## Cloud Build SDK Architecture

### Files

- **[cloudbuild.yaml](../cloudbuild.yaml)** - Minimal wrapper for Cloud Build triggers
- **[infrastructure/cloud-build-automation.mjs](../infrastructure/cloud-build-automation.mjs)** - SDK automation logic
- **[package.json](../package.json)** - Npm scripts for local/manual builds

### Release Naming

Releases are named: `rel-<SHORT_SHA>-<TIMESTAMP>`

Examples:

- `rel-a1b2c3d-1732137600`
- `rel-9f8e7d6-1732141200`

This ensures:

- **Uniqueness** (no ALREADY_EXISTS errors)
- **Traceability** (SHA shows commit)
- **Resource ID compliance** (under 63 chars for rollout names like `rel-...-to-staging-0001`)

### SDK Script Features

The `cloud-build-automation.mjs` script:

- Works in both Cloud Build and local environments
- Uses environment variables in CI (`GOOGLE_CLOUD_PROJECT`, `PROJECT_ID`)
- Uses CliContext for local development
- Generates unique release names automatically
- Provides detailed logging throughout the build process

---

## Deployment

### Option A: Automatic Deployment (GitHub Push)

1. **Set up Cloud Build trigger** (see [CI/CD Setup](#cicd-setup))
2. **Push to main branch**:

   ```bash
   git push origin main
   ```

3. Cloud Build automatically:
   - Installs dependencies
   - Runs SDK build script
   - Creates release
   - Deploys to staging

### Option B: Manual Deployment (Local)

```bash
# Build Docker image only
npm run build:cloud

# Build and deploy to staging
npm run deploy:cloud
```

### Option C: Using Deploy Automation

```bash
# Initialize Cloud Deploy pipeline (one-time)
npm run deploy:init

# Create release and deploy to staging (with interactive promote to prod)
npm run deploy
```

### Promote to Production

If not auto-approved, manually promote:

```bash
gcloud deploy releases promote \
  --delivery-pipeline=oncall-cat-pipeline \
  --region=$REGION \
  --release=<RELEASE_NAME>
```

---

## Verification

### 1. Preflight IAM & Pipeline Check

Before deploying, verify IAM permissions and pipeline access:

```bash
npm run preflight
```

**Validates:**

- Cloud Build SA has required roles
- Runtime SA restricted to minimal roles
- Cloud Deploy service agent ActAs binding present
- Pipeline readable

Exits non-zero if any check fails.

### 2. Check Deployment Status

```bash
# View service details
gcloud run services describe oncall-cat --region=$REGION

# Get service URL
SERVICE_URL=$(gcloud run services describe oncall-cat --region=$REGION --format='value(status.url)')
echo "Service URL: $SERVICE_URL"
```

### 3. Test Health Endpoint

```bash
npm run health
```

**Expected output:**

```json
{
  "status": "healthy",
  "uptime": 123.45,
  "metrics": {
    "messagesProcessed": 0,
    "messagesCreated": 0
  }
}
```

### 4. View Logs

```bash
# View recent logs
npm run logs

# Follow logs in real-time
npm run logs -- --follow

# Include Cloud Run request logs
npm run logs -- --include-requests
```

**Look for:**

```
On-Call Cat running (Socket Mode)
```

### 5. Test with Slack

1. Go to your monitored Slack channel
2. Post a test message:

   ```
   @auto
   Priority: P2
   Issue: Test deployment
   How to replicate: Post this message
   Customer: Internal Testing
   1Password: test@example.com
   Needed by: ASAP
   ```

3. Bot should respond with success message
4. Check Notion database for new entry

---

## Configuration Updates

### Update Environment Variables

```bash
# Example: Change log level to debug
gcloud run services update oncall-cat \
  --region=$REGION \
  --set-env-vars="LOG_LEVEL=debug"
```

**Available environment variables:**

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | Must remain `1987` per project standard | `1987` |
| `LOG_LEVEL` | Logging verbosity (info or debug) | `info` |
| `CHANNEL_DB_MAPPINGS` | `true` enables multi-channel mode | `false` |
| `CHANNEL_DB_MAPPINGS_FILE` | Override path for mappings JSON | `/secrets/channel-mappings` |
| `CHANNEL_MAPPINGS_JSON` | Inline JSON for mappings (alternative) | - |
| `ALLOW_THREADS` | Allow processing thread replies | `false` |
| `API_TIMEOUT` | API timeout in ms | `10000` |
| `SCHEMA_CACHE_TTL` | Schema cache TTL in ms | `3600000` |
| `HEALTH_PORT` | Health check port | `1987` |

### Update Secrets

```bash
# Create new version of a secret
echo -n "new-token-value" | \
  gcloud secrets versions add slack-bot-token --data-file=-

# Service will automatically use the new version on next cold start
# Or force restart:
gcloud run services update oncall-cat \
  --region=$REGION \
  --update-labels="updated=$(date +%s)"
```

### Update Channel Mappings (Multi-Channel Mode)

```bash
# Edit your local channel-mappings.json
vim channel-mappings.json

# Upload new version
gcloud secrets versions add channel-mappings --data-file=channel-mappings.json

# Restart service
gcloud run services update oncall-cat \
  --region=$REGION \
  --update-labels="updated=$(date +%s)"
```

### Deploy New Version

**Automatic (recommended):**

```bash
git commit -m "Your changes"
git push origin main
```

**Manual:**

```bash
npm run deploy:cloud
```

---

## Monitoring & Operations

### Cloud Console

View in GCP Console:

- **Cloud Run**: <https://console.cloud.google.com/run>
- **Cloud Build**: <https://console.cloud.google.com/cloud-build>
- **Cloud Deploy**: <https://console.cloud.google.com/deploy>
- **Logs**: <https://console.cloud.google.com/logs>
- **Metrics**: <https://console.cloud.google.com/monitoring>

### Command Line Monitoring

```bash
# Check service health
npm run health

# View recent logs
npm run logs

# Follow logs in real-time
npm run logs -- --follow

# Filter logs by severity
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=oncall-cat AND severity>=ERROR" \
  --limit=50 \
  --project=$PROJECT_ID

# Check service metrics
gcloud run services describe oncall-cat \
  --region=$REGION \
  --format='yaml(status.conditions)'

# View build history
gcloud builds list --limit=10

# View specific build logs
gcloud builds log <BUILD_ID>

# List recent releases
npm run deploy:list

# Check deployment status
npm run deploy:status
```

### Set Up Alerts

```bash
# Create alert policy for service errors
gcloud alpha monitoring policies create \
  --notification-channels=YOUR_CHANNEL_ID \
  --display-name="OnCall Cat Error Alert" \
  --condition-display-name="Error rate high" \
  --condition-threshold-value=5 \
  --condition-threshold-duration=60s \
  --condition-filter='resource.type="cloud_run_revision" AND severity="ERROR"'
```

---

## IAM & Security

### Minimal IAM Expectations

**Cloud Build SA (deploy actions only):**

```
roles/run.admin
roles/iam.serviceAccountUser
roles/clouddeploy.releaser
roles/clouddeploy.viewer
roles/artifactregistry.writer
```

**Runtime SA (execution only):**

```
roles/secretmanager.secretAccessor
roles/artifactregistry.reader
roles/aiplatform.user (only if ML features used)
```

**Cloud Deploy service agent:** `roles/iam.serviceAccountUser` on runtime SA (ActAs permission)

### Verify IAM Configuration

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
CB_SA=${CLOUD_BUILD_SA_EMAIL:-${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com}
RUNTIME_SA=${PROJECT_NUMBER}-compute@developer.gserviceaccount.com

# Cloud Build roles
gcloud projects get-iam-policy $PROJECT_ID --format=json | \
  jq --arg sa "serviceAccount:${CB_SA}" '.bindings[] | select(.members[]?==$sa) | .role'

# Runtime minimal roles
gcloud projects get-iam-policy $PROJECT_ID --format=json | \
  jq --arg sa "serviceAccount:${RUNTIME_SA}" '.bindings[] | select(.members[]?==$sa) | .role'

# ActAs binding
gcloud iam service-accounts get-iam-policy ${RUNTIME_SA} --format=json | \
  jq '.bindings[] | select(.role=="roles/iam.serviceAccountUser")'
```

### Least-Privilege Runtime Pruning

To remove previously granted elevated roles from the runtime service account (safe list approach):

```bash
export PRUNE_RUNTIME_ROLES=1   # removes run.admin, artifactregistry.writer, secretmanager.admin, clouddeploy.releaser, storage.admin if present
echo 'y' | npm run infra:setup
```

**Warning:** Set `PRUNE_RUNTIME_ROLES=1` consciously—avoid on shared projects where other services may rely on those roles. The script only removes the known unnecessary elevated roles; it does not touch unrelated bindings (e.g., monitoring, logging).

### Manual IAM Grants

If needed, manually grant IAM roles:

```bash
# Cloud Build SA
export CLOUD_BUILD_SA_EMAIL="PROJECT_NUMBER@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA_EMAIL}" \
  --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA_EMAIL}" \
  --role="roles/clouddeploy.releaser"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA_EMAIL}" \
  --role="roles/run.admin"

# Runtime SA
COMPUTE_SA="$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/artifactregistry.reader"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor"

# Allow Cloud Deploy service agent to ActAs the runtime SA
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding \
  ${COMPUTE_SA} \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-clouddeploy.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

### Security Best Practices

#### Secret Validation

All secrets are validated before storage using [lib/validators.mjs](../lib/validators.mjs):

```javascript
// Slack Bot Token validation
validateSlackBotToken(value);  // Must start with 'xoxb-'

// Slack App Token validation
validateSlackAppToken(value);   // Must start with 'xapp-'

// Notion Token validation
validateNotionToken(value);     // Must start with 'secret_' or 'ntn_'

// Channel Mappings validation
validateChannelMappings(json);  // Must have valid JSON structure
```

**Benefits:**
- Prevents storing invalid credentials
- Catches typos and format errors early
- Reduces runtime authentication failures

#### Error Sanitization

Error messages are automatically sanitized to prevent secret leakage:

```javascript
// Before: "Error: Invalid token xoxb-XXXX-YYYY-ZZZZ"
// After:  "Error: Invalid token xoxb**********************"

const sanitizedMessage = sanitizeError(error, [secretValue]);
logger.error(sanitizedMessage);
```

**Protection:**
- First 4 characters visible for debugging
- Remaining characters replaced with asterisks
- Prevents secrets from appearing in logs

#### Configuration Validation

Project IDs and regions are validated against GCP requirements:

```javascript
// Project ID validation
validateProjectId(projectId);
// - Must be 6-30 characters
// - Start with lowercase letter
// - Only lowercase letters, digits, hyphens
// - Cannot end with hyphen

// Region validation
validateRegion(region);
// - Must be in list of 18 supported regions
// - Prevents invalid region deployment errors
```

---

## CI/CD Setup

### Connect GitHub Repository

```bash
# Create Cloud Build trigger for GitHub
gcloud beta builds triggers create github \
  --repo-name=slack-notion-sync-bot \
  --repo-owner=YOUR_GITHUB_USERNAME \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml \
  --region=$REGION
```

### Manage Triggers

```bash
# List triggers
gcloud builds triggers list

# Run trigger manually
gcloud builds triggers run TRIGGER_ID

# Delete trigger
gcloud builds triggers delete TRIGGER_ID
```

### Verify IAM Permissions

Ensure Cloud Build SA has required roles:

```bash
# Run preflight checks
npm run preflight

# Or manually verify
export CLOUD_BUILD_SA_EMAIL="PROJECT_NUMBER@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA_EMAIL}" \
  --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA_EMAIL}" \
  --role="roles/clouddeploy.releaser"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA_EMAIL}" \
  --role="roles/run.admin"
```

---

## Troubleshooting

### Build Errors

#### Authentication errors in Cloud Build

Ensure the Cloud Build service account has required roles:

```bash
npm run preflight
```

Check build logs:

```bash
gcloud builds list --limit=5
gcloud builds log <BUILD_ID>
```

### Recent Infrastructure Improvements

The following issues have been fixed in recent updates:

#### ✅ API Enabling Reliability

**Issue:** `setup-infrastructure.mjs` used the deprecated Service Management API, causing intermittent failures.

**Fix:** Migrated to the Service Usage API for reliable API enablement:

```javascript
// Before: servicemanagement.services.list() - unreliable
// After: serviceusage.services.get() - reliable
const serviceusage = google.serviceusage('v1');
const serviceName = `projects/${projectId}/services/${api}`;
const { data: service } = await serviceusage.services.get({ name: serviceName });
const isEnabled = service.state === 'ENABLED';
```

#### ✅ Cross-Platform File Operations

**Issue:** `deploy-automation.mjs` used macOS-specific `sed` commands, failing on Linux/Windows and leaving `.bak` files.

**Fix:** Replaced with Node.js fs/promises for cross-platform compatibility:

```javascript
// Before: sed -i.bak 's/OLD/NEW/' file.yaml
// After: Node.js replaceAll()
async function replaceInFile(filePath, replacements) {
  let content = await readFile(filePath, 'utf8');
  for (const [find, replace] of Object.entries(replacements)) {
    content = content.replaceAll(find, replace);
  }
  await writeFile(filePath, content, 'utf8');
}
```

#### ✅ Secret Validation

**Issue:** Invalid secrets were stored without validation, causing runtime errors.

**Fix:** Added comprehensive validation in `lib/validators.mjs`:

- Slack bot tokens must start with `xoxb-`
- Slack app tokens must start with `xapp-`
- Notion tokens must start with `secret_` or `ntn_`
- Error messages sanitized to prevent secret leakage

#### ✅ Configuration Centralization

**Issue:** Configuration values scattered across multiple files.

**Fix:** Created `config/defaults.mjs` with centralized configuration:

```javascript
export const DEFAULTS = {
  serviceName: 'oncall-cat',
  repoName: 'oncall-cat',
  pipelineName: 'oncall-cat-pipeline',
  machineType: 'E2_HIGHCPU_8',
  buildTimeoutSeconds: 600,
  region: 'us-central1',
  validRegions: [/* 18 supported regions */]
};
```

#### ✅ Error Handling in Cloud Build

**Issue:** `cloud-build-automation.mjs` used `execSync` without error handling.

**Fix:** Added proper error handling with stdout/stderr capture:

```javascript
try {
  const result = execSync(cmd, { encoding: 'utf8', stdio: opts.capture ? 'pipe' : 'inherit' });
  return { stdout: result || '', exitCode: 0 };
} catch (error) {
  logger.warn(`Command failed: ${cmd}`);
  return { stdout: error.stdout || '', stderr: error.stderr || '', exitCode: error.status || 1 };
}
```

### Deployment Errors

#### Cloud Deploy release creation fails with PERMISSION_DENIED

Error example:

```
ERROR: PERMISSION_DENIED: Permission 'clouddeploy.deliveryPipelines.get' denied
```

Fix IAM permissions:

```bash
export CLOUD_BUILD_SA_EMAIL="PROJECT_NUMBER@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA_EMAIL}" \
  --role="roles/clouddeploy.releaser"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${CLOUD_BUILD_SA_EMAIL}" \
  --role="roles/clouddeploy.viewer"
```

#### Runtime SA permission errors

```bash
COMPUTE_SA="$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/artifactregistry.reader"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor"

# Allow Cloud Deploy service agent to ActAs the runtime SA
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding \
  ${COMPUTE_SA} \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-clouddeploy.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

### Service Not Starting

**Check logs for errors:**

```bash
npm run logs
```

**Common issues:**

- Missing secrets → Verify: `gcloud secrets list`
- Wrong secret names → Check service.yaml configuration
- Insufficient permissions → Run: `npm run preflight`

### Socket Mode Connection Issues

**Symptoms:** Service starts but doesn't respond to Slack messages

**Fix:**

1. Verify `SLACK_APP_LEVEL_TOKEN` is correct (starts with `xapp-`)
2. Check Socket Mode is enabled in Slack app settings
3. Ensure `--min-instances=1` (connection requires persistent instance)
4. Check logs for connection errors: `npm run logs`

### Rollback to Previous Version

```bash
# List revisions
gcloud run revisions list \
  --service=oncall-cat \
  --region=$REGION

# Rollback to specific revision
gcloud run services update-traffic oncall-cat \
  --region=$REGION \
  --to-revisions=oncall-cat-00002-abc=100
```

### Delete and Redeploy

```bash
# Delete service
gcloud run services delete oncall-cat --region=$REGION

# Redeploy
npm run deploy:cloud
```

---

## Quick Reference

### Essential Commands

```bash
# Deploy
git push origin main                      # Automatic via CI/CD
npm run deploy:cloud                      # Manual build and deploy

# Monitor
npm run health                            # Check service health
npm run logs                              # View recent logs
npm run logs -- --follow                  # Follow logs in real-time
gcloud builds list --limit=5              # View build history

# Update
echo -n "new-token" | \
  gcloud secrets versions add SECRET_NAME --data-file=-
gcloud run services update oncall-cat \
  --region=$REGION --update-labels="updated=$(date +%s)"

# Troubleshoot
npm run preflight                         # Check IAM permissions
gcloud builds log <BUILD_ID>              # View build logs
gcloud run revisions list \               # List service revisions
  --service=oncall-cat --region=$REGION
```

### NPM Scripts Reference

All scripts are organized by category in [package.json](../package.json):

#### Development

```bash
npm start                  # Start local server
npm stop                   # Stop local server
npm run build              # Build Docker image locally
npm run cat                # Run cat demo
```

#### Testing & Coverage

```bash
npm test                   # Run all tests
npm run test:cli           # Run CLI tests
npm run test:parser        # Run parser tests
npm run test:validation    # Run validation tests
npm run test:coverage      # Generate coverage report (text + HTML)
npm run test:coverage:check # Check coverage thresholds (75% lines, 60% functions/branches)
```

#### Code Quality

```bash
npm run lint               # Lint JavaScript/ESM files
npm run lint:fix           # Auto-fix linting issues
npm run lint:md            # Lint Markdown files
npm run lint:no-emoji      # Check for emoji usage
```

#### Infrastructure Setup

```bash
npm run infra:setup        # Complete GCP infrastructure setup (APIs, Artifact Registry, secrets, IAM)
```

#### Cloud Build & Deploy

```bash
npm run deploy             # Deploy via ops script
npm run deploy:init        # Initialize Cloud Deploy pipeline
npm run deploy:list        # List recent releases
npm run deploy:status      # Check deployment status
npm run build:cloud        # Build Docker image in Cloud Build
npm run deploy:cloud       # Build and deploy to Cloud Run
npm run preflight          # Verify permissions and configuration
npm run preflight:slack    # Verify Slack configuration only
```

#### Health & Monitoring

```bash
npm run health             # Check service health (single check)
npm run health:watch       # Watch health status (continuous)
npm run health:json        # Output health status as JSON
npm run status             # Check Cloud Run service status
npm run logs               # View recent Cloud Run logs
```

### Environment Variables Reference

#### Required (Single-Channel)

- `SLACK_BOT_TOKEN` (secret)
- `SLACK_APP_LEVEL_TOKEN` (secret)
- `NOTION_TOKEN` (secret)
- `WATCH_CHANNEL_ID`
- `NOTION_DATABASE_ID`
- `CHANNEL_DB_MAPPINGS=false`

#### Required (Multi-Channel)

- `SLACK_BOT_TOKEN` (secret)
- `SLACK_APP_LEVEL_TOKEN` (secret)
- `NOTION_TOKEN` (secret)
- `CHANNEL_DB_MAPPINGS=true`
- `/secrets/channel-mappings` (secret file)

#### Optional

- `ALLOW_THREADS=false`
- `API_TIMEOUT=10000`
- `SCHEMA_CACHE_TTL=3600000`
- `HEALTH_PORT=1987`
- `PORT=1987`
- `LOG_LEVEL=info`

### Cloud Run Configuration

#### Recommended Settings (Socket Mode)

```bash
--min-instances=1          # Keep Socket Mode connection alive
--max-instances=3          # Prevent runaway costs
--memory=512Mi             # Sufficient for most workloads
--cpu=1                    # Adequate performance
--timeout=300              # 5-minute timeout
--port=1987                # Application port
```

#### Performance Settings (High Volume)

```bash
--memory=1Gi               # For high-volume channels
--cpu=2                    # For faster processing
--concurrency=80           # Default, adjust if needed
```

### Secret Management

```bash
# Create secret
echo -n "value" | gcloud secrets create NAME --data-file=-

# Update secret
echo -n "new-value" | gcloud secrets versions add NAME --data-file=-

# View secret value
gcloud secrets versions access latest --secret=NAME

# List secrets
gcloud secrets list

# Update channel mappings
gcloud secrets versions add channel-mappings \
  --data-file=channel-mappings.json
```

### Log Filtering

```bash
# Filter by severity
gcloud logging read "resource.type=cloud_run_revision AND severity>=ERROR" \
  --limit=50 --project=$PROJECT_ID

# Filter by trigger
gcloud run services logs read oncall-cat \
  --region=$REGION \
  --log-filter='jsonPayload.trigger="auto"'

# Filter by time range
gcloud run services logs read oncall-cat \
  --region=$REGION \
  --log-filter='timestamp>="2025-11-10T00:00:00Z"'
```

---

## Cost Estimates

**Typical monthly costs for 24/7 operation:**

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| **Cloud Run** | 1 instance always running (min-instances=1)<br>512Mi RAM, 1 CPU<br>Minimal request volume | $15-25 |
| **Secret Manager** | 6 active secrets<br>Minimal access requests | ~$0.60 |
| **Artifact Registry** | <1GB storage for Docker images | ~$0.10 |
| **Cloud Build** | ~10 builds/month<br>(first 120 min free) | ~$0.50 |
| **Cloud Deploy** | Release management | Free |

**Total: ~$16-27/month** (significantly cheaper than a VM!)

### Cost Optimization Tips

- Set `--max-instances=3` to prevent runaway costs
- Keep `--min-instances=1` for Socket Mode (required for WebSocket connection)
- Review logs for excessive errors causing restarts
- Use `--memory=512Mi` (adequate for most workloads)
- Clean up old Docker images in Artifact Registry

---

## Additional Resources

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Cloud Build Documentation](https://cloud.google.com/build/docs)
- [Cloud Deploy Documentation](https://cloud.google.com/deploy/docs)
- [Secret Manager Documentation](https://cloud.google.com/secret-manager/docs)
- [Artifact Registry Documentation](https://cloud.google.com/artifact-registry/docs)
- [Health Checks Documentation](./HEALTH_CHECKS.md)
- [Main README](../README.md)
- [Getting Started Guide](../GETTING_STARTED.md)

---

## Support

For issues or questions:

1. Check this guide's [Troubleshooting section](#troubleshooting)
2. Run preflight checks: `npm run preflight`
3. Check logs: `npm run logs`
4. Review the [main README](../README.md)

---

*Last Updated: 2025-11-20*
