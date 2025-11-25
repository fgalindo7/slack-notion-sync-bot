# Health Checks & Monitoring

Comprehensive guide to the unified health check system for On-Call Cat, supporting both local and GCP environments with a modular OO architecture.

## Overview

The health check system provides real-time visibility into:
- **Application health** and configuration (local + GCP)
- **Local environment** (Docker, Node.js, Filesystem, Ports)
- **GCP services** (Cloud Run, Cloud Deploy, Cloud Build)
- **Git version** synchronization

### Architecture Highlights

- **7 Modular Checkers**: Git, App, GCP, Docker, Node, Filesystem, Port
- **3 Flexible Renderers**: Terminal (rich UI), JSON (structured), Watch (animated)
- **OO Design**: Base classes with extensible checkers and renderers
- **Target-Aware**: Automatically runs appropriate checks based on environment

## Quick Start

### Basic Commands

```shell
# Local environment (Docker, Node.js, Filesystem, Ports)
npm run health:local

# GCP environment (Cloud Run, Deploy, Build)
npm run health:gcp

# Auto-detected (via ops.mjs - backward compatible)
npm run health
```

### Watch Mode (Live Updates)

```shell
# Watch GCP services with live updates every 30s
npm run health:watch

# Watch local environment
npm run health:watch:local

# Custom refresh interval (60 seconds)
node scripts/check-health.mjs --watch --target=gcp --interval=60000
```

### JSON Output (CI/CD Integration)

```shell
# GCP services as JSON
npm run health:json

# Local environment as JSON
npm run health:json:local

# Suppress npm header for clean JSON
npm run health:json --silent | jq '.health.status'
```

### Advanced Usage

```shell
# Show specific section only
node scripts/check-health.mjs --target=gcp --section=app     # Application only
node scripts/check-health.mjs --target=gcp --section=run     # Cloud Run only
node scripts/check-health.mjs --target=gcp --section=deploy  # Cloud Deploy only
node scripts/check-health.mjs --target=gcp --section=build   # Cloud Build only
node scripts/check-health.mjs --target=gcp --section=git     # Version info only

# Custom health endpoint URL
node scripts/check-health.mjs --target=local --url=http://localhost:8080

# Verbose mode
node scripts/check-health.mjs --target=gcp --verbose
```

## Available Checks

### Universal Checks (Both Local & GCP)

#### [GIT] Version Info
Shows git repository status and synchronization.

**Local Mode:**
- Current commit SHA and timestamp
- Branch name
- Uncommitted changes warning
- GitHub commit link

**GCP Mode:**
- Deployed version comparison with local
- Sync status (up to date / local ahead / deployed ahead)
- Uncommitted changes warning
- GitHub commit link

#### [APP] Application Health
Checks the `/health` endpoint of the running application.

**Information Displayed:**
- Status: Healthy/Unhealthy indicator
- Uptime: Time since last restart
- Last Activity: Time since last Slack message processed
- Mode: Single-channel or Multi-channel configuration
- Channels: List of monitored Slack channels with:
  - Real channel names (fetched via Slack API)
  - Channel IDs
  - Mapped Notion database titles
- Message Metrics:
  - Total messages processed
  - Messages created vs updated
  - Success rate with warning indicator (!! if < 95%)
  - Failures and API timeouts

**Health Indicators:**
- `OK HEALTHY` (green) - Service operational
- `ERR UNHEALTHY` (red) - Service degraded or down
- `N/A 0%` (gray) - No activity yet (normal for new deployments)
- `!! 94.2%` (yellow) - Success rate below 95%

### Local-Only Checks

#### [🐳] Docker
Checks Docker daemon and container status.

**Information Displayed:**
- Docker version
- Running containers list
- oncall-cat image presence

#### [🟩] Node.js
Checks Node.js environment and dependencies.

**Information Displayed:**
- Node.js version
- npm version
- Dependencies status (OK/ERR based on `npm ls`)

#### [FS] Filesystem
Checks for required configuration files.

**Files Checked:**
- `channel-mappings.json` - Multi-channel configuration
- `.env` - Environment variables

#### [PORT] Ports
Checks if required ports are available or in use.

**Information Displayed:**
- Port 1987 status (available / in use)

### GCP-Only Checks

#### [CR] Cloud Run Service
Shows the current Cloud Run deployment configuration.

**Information Displayed:**
- Service Name: `oncall-cat`
- Current Revision: Active revision with creation timestamp
- Traffic Split: Percentage distribution across revisions
- Resources: Allocated CPU and memory
- Scaling: Min/max instances configuration
- Service URL: Direct link to the service
- Console Link: Opens Cloud Run service in GCP Console

**Example Output:**
```
Service:       oncall-cat
Revision:      oncall-cat-mhybstgq (Nov 14 03:57)
Traffic:       100% → latest
Resources:     2 vCPU | 1Gi memory
Scaling:       1-10 instances
URL:           https://oncall-cat-xxx.run.app
Console:       -> View in GCP Console
```

#### [CD] Cloud Deploy Pipeline
Tracks deployment pipeline status and target environments.

**Information Displayed:**
- Pipeline Name: `oncall-cat-pipeline`
- Latest Release: Release name and creation time
- Render State: SUCCEEDED, IN_PROGRESS, or FAILED
- Deployment Targets:
  - **Staging:** Status and auto-deploy indicator
  - **Production:** Status and approval requirement
- Console Link: Opens Cloud Deploy pipeline in GCP Console

**Target States:**
- `[OK] SUCCEEDED` (green) - Deployed successfully
- `[ERR] FAILED` (red) - Deployment failed
- `[...] IN_PROGRESS` (yellow) - Currently deploying
- `[WAIT] PENDING_APPROVAL` (yellow) - Waiting for manual approval

#### [CB] Cloud Build
Shows recent build history and trigger information.

**Information Displayed:**
- Recent Builds (last 3):
  - Build ID (first 8 characters)
  - Status: SUCCESS, FAILURE, or IN_PROGRESS
  - Duration
  - Git commit SHA
  - Trigger type: `[T]` (automatic) or `[M]` (manual)
  - Build timestamp
- Console Link: Opens Cloud Build history in GCP Console

**Build Status Icons:**
- `[OK]` (green) - Successful build
- `[ERR]` (red) - Failed build
- `⟳` (yellow) - Build in progress

## Features

### Terminal Hyperlink Support

The health check script automatically detects terminal capabilities for clickable links.

**Supported Terminals (Clickable Links):**
- iTerm2 (macOS)
- VS Code integrated terminal
- WezTerm
- Hyper
- Windows Terminal (recent versions)

**Fallback (URL Truncation):**
For terminals without hyperlink support, URLs are intelligently truncated:
```
https://console.cloud.google.com/r...383416
```

### Animated Watch Mode

Watch mode includes an animated ASCII cat that blinks periodically:

```
  /\_/\
 ( o.o )
  > ^ <
```

The cat animation runs independently of dashboard updates, providing a live indication that the system is running.

### Real-Time Data Fetching

- **Slack channel names**: Fetched via Slack API using `SLACK_BOT_TOKEN`
- **Notion database titles**: Fetched via Notion API using `NOTION_TOKEN`
- **GCP service status**: Fetched via gcloud CLI commands
- **Git information**: Extracted from local repository

## Monitoring Strategies

### Development Workflow

```shell
# Terminal 1: Watch health during development
npm run health:watch:local

# Terminal 2: Make code changes and test
npm run start
npm run logs -- --target=local

# Terminal 3: Monitor GCP deployment
npm run health:watch
```

### Production Monitoring

```shell
# Check production health every 5 minutes
watch -n 300 'npm run health:gcp'

# Or use cron (add to crontab)
*/5 * * * * cd /path/to/repo && npm run health:json >> /var/log/oncall-cat-health.log
```

### CI/CD Integration

```yaml
# GitHub Actions workflow
- name: Health Check
  run: |
    npm run health:json > health-report.json
    # Parse and validate critical metrics
    if jq -e '.health.json.status != "healthy"' health-report.json; then
      echo "Health check failed!"
      exit 1
    fi

    # Check success rate
    SUCCESS_RATE=$(jq -r '.health.json.metrics.successRate' health-report.json | tr -d '%')
    if (( $(echo "$SUCCESS_RATE < 95" | bc -l) )); then
      echo "Success rate below 95%: $SUCCESS_RATE%"
      exit 1
    fi
```

### Docker Health Check Integration

```yaml
# docker-compose.yml
services:
  oncall-auto:
    healthcheck:
      test: ["CMD", "node", "scripts/check-health.mjs", "--json", "--target=local"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Warning Indicators

### Application Warnings

- **Success rate < 95%:** `!! 94.2%` - Indicates increased error rate
- **No recent activity:** Gray metrics - Normal for low-traffic channels
- **Uncommitted changes:** `! Uncommitted changes` - Local differs from deployed
- **Port in use:** `[PORT] In use` - Port 1987 occupied (expected when running)

### Deployment Warnings (GCP)

- **Pending approvals:** `[WAIT] PENDING_APPROVAL` - Production needs manual promotion
- **Failed deployments:** `[ERR] FAILED` - Check logs for errors
- **Render failures:** `RENDER_STATE: FAILED` - Skaffold or manifest issues

### Build Warnings (GCP)

- **All manual builds:** No `[T]` indicator - GitHub trigger not connected
- **Recent failures:** `[ERR]` in build list - Check build logs

### Local Environment Warnings

- **Docker not running:** `[ERR]` - Start Docker daemon
- **Missing image:** `oncall-cat missing` - Build image with `npm run build`
- **Dependencies issues:** Check with `npm ls`
- **Missing files:** `.env` or `channel-mappings.json` not found

## Troubleshooting

### Local Environment Issues

#### Issue: "Docker: ERR"

**Cause:** Docker daemon not running

**Solution:**
```shell
# macOS
open -a Docker

# Linux
sudo systemctl start docker

# Verify
docker ps
```

#### Issue: "oncall-cat missing"

**Cause:** Docker image not built

**Solution:**
```shell
npm run build
npm run health:local
```

#### Issue: "Dependencies: ERR"

**Cause:** Missing or incompatible npm packages

**Solution:**
```shell
rm -rf node_modules package-lock.json
npm install
npm run health:local
```

#### Issue: "Port 1987: In use"

**Cause:** Application is running (this is expected!)

**Note:** This is normal when the app is running. It's only a problem if the app is NOT running but the port is occupied.

**Solution (if app not running):**
```shell
# Find process using port
lsof -i :1987

# Kill process
kill -9 <PID>
```

### GCP Environment Issues

#### Issue: "Service not found or not deployed"

**Cause:** Cloud Run service doesn't exist or wrong project/region

**Solution:**
```shell
# Verify project and region
echo $GCP_PROJECT_ID
echo $REGION

# List services
gcloud run services list --region=$REGION
```

#### Issue: "Status: UNHEALTHY"

**Causes:**
1. Socket Mode connection failed
2. Missing environment variables
3. Invalid secrets

**Solution:**
```shell
# Check service logs
npm run logs -- --target=gcp

# Verify secrets exist
gcloud secrets list | grep -E "slack|notion|channel"

# Check current revision
gcloud run revisions describe \
  $(gcloud run services describe oncall-cat \
    --region=$REGION \
    --format='value(status.latestReadyRevisionName)') \
  --region=$REGION
```

#### Issue: "Success rate < 95%"

**Causes:**
1. Validation errors in Slack messages
2. Notion API errors
3. Network timeouts

**Solution:**
```shell
# Check recent errors
gcloud logging read \
  "resource.type=cloud_run_revision AND \
   resource.labels.service_name=oncall-cat AND \
   severity>=ERROR" \
  --limit=10

# Review metrics endpoint
curl $(gcloud run services describe oncall-cat \
  --region=$REGION \
  --format='value(status.url)')/metrics | jq '.'
```

#### Issue: "No channel names displayed"

**Cause:** Missing `SLACK_BOT_TOKEN` environment variable or invalid token

**Solution:**
```shell
# Verify token is set (in local environment for health check)
echo $SLACK_BOT_TOKEN

# Or set temporarily
export SLACK_BOT_TOKEN=$(gcloud secrets versions access latest --secret=slack-bot-token)
npm run health:gcp
```

#### Issue: "All builds show [M] (manual)"

**Cause:** GitHub App trigger not connected

**Solution:**
1. Open Cloud Build Triggers console
2. Connect GitHub repository
3. Update trigger to use GitHub App connection
4. Test with a commit

See [GETTING_STARTED.md - Step 6](../GETTING_STARTED.md#step-6-connect-github-repository) for details.

#### Issue: "Slack channels not responding / missing events"

**Cause:** Missing Slack scopes (e.g., `channels:read`) or bot not a member of target channels

**Solution:**
```shell
# Validate Slack token and scopes; checks mapped channels access
export SLACK_BOT_TOKEN=$(gcloud secrets versions access latest --secret=slack-bot-token)
npm run preflight:slack

# If you see "[Slack] Slack scope missing: channels:read"
# 1) Add channels:read to the Slack app in OAuth & Permissions
# 2) Reinstall the app to the workspace
# 3) Rotate the bot token in Secret Manager and redeploy
```

## Integration Examples

### Slack Notifications

```shell
#!/bin/bash
# Post health status to Slack

HEALTH=$(npm run health:json --silent)
STATUS=$(echo $HEALTH | jq -r '.health.json.status')

if [ "$STATUS" != "healthy" ]; then
  curl -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"[!] On-Call Cat is unhealthy!\"}" \
    $SLACK_WEBHOOK_URL
fi
```

### Prometheus Metrics Export

```javascript
// Export health check data to Prometheus format
import { execSync } from 'child_process';

const health = JSON.parse(execSync('npm run health:json --silent').toString());

console.log(`oncall_cat_status{status="${health.health.json.status}"} 1`);
console.log(`oncall_cat_messages_processed ${health.health.json.metrics.messagesProcessed}`);
console.log(`oncall_cat_success_rate ${parseFloat(health.health.json.metrics.successRate)}`);
```

### Grafana Dashboard

Use the JSON output to create custom dashboards:
- Graph success rate over time
- Alert on unhealthy status
- Track deployment frequency
- Monitor build durations

## Environment Variables

The health check script uses these environment variables:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GCP_PROJECT_ID` or `PROJECT_ID` | For GCP checks | - | GCP project ID |
| `REGION` | No | `us-central1` | GCP region |
| `SLACK_BOT_TOKEN` | No | - | Fetch real channel names |
| `NOTION_TOKEN` | No | - | Fetch database titles |
| `TERM_PROGRAM` | Auto-detected | - | Terminal hyperlink support |
| `DRY_RUN` | No | - | Enable dry-run mode for testing |

## CLI Flags Reference

All flags can be passed to `scripts/check-health.mjs`:

| Flag | Values | Description |
|------|--------|-------------|
| `--target` | `local`, `gcp` | Environment to check |
| `--json` | - | JSON output mode |
| `--watch` | - | Watch mode with live updates |
| `--section` | `app`, `run`, `deploy`, `build`, `git` | Show specific section only |
| `--interval` | milliseconds | Refresh interval for watch mode (default: 30000) |
| `--url` | URL | Custom health endpoint |
| `--verbose` | - | Verbose output |
| `--anim-interval` | milliseconds | Animation frame interval (default: 650) |
| `--anim-mode` | `gentle`, `blink` | Animation style |

## Architecture & Extensibility

### Adding New Checkers

Extend the `HealthChecker` base class to add new checks:

```javascript
// lib/health-check/checks/redis-check.mjs
import { HealthChecker } from '../health-checker.mjs';
import icons from '../../ascii-icons.js';

export class RedisCheck extends HealthChecker {
  constructor(config = {}) {
    super('Redis', config);
  }

  async check() {
    // Your check logic here
    return {
      status: 'ok',  // or 'warn' or 'error'
      data: { /* your data */ },
      error: null
    };
  }

  isApplicable(target) {
    return target === 'local';  // or 'gcp' or true for both
  }

  getIcon() {
    return '🔴';  // or icons.redis
  }
}
```

### Adding New Renderers

Extend the `Renderer` base class for new output formats:

```javascript
// lib/health-check/renderers/html-renderer.mjs
import { Renderer } from '../renderer.mjs';

export class HTMLRenderer extends Renderer {
  async render(results) {
    let html = '<html><body>';

    for (const result of results) {
      html += `<h2>${result.checker}</h2>`;
      html += `<p>Status: ${result.status}</p>`;
      // ... render data
    }

    html += '</body></html>';
    console.log(html);
  }
}
```

## Best Practices

### Regular Checks

- Run `npm run health:local` before starting development
- Run `npm run health:gcp` before making changes to production
- Use `npm run health:watch` during deployments
- Add health check to deployment scripts

### Automation

- Schedule periodic health checks with cron
- Export JSON for monitoring systems
- Alert on status changes via Slack/PagerDuty
- Integrate with CI/CD pipelines

### Version Control

- Always check `[GIT] Version Info` before pushing
- Resolve `! Uncommitted changes` warnings
- Verify deployed version matches expected commit

### Deployment Monitoring

- Monitor success rate daily
- Review failed builds immediately
- Promote to production only when staging shows `[OK] SUCCEEDED`

## Related Documentation

- [README.md](../README.md) - Project overview
- [GETTING_STARTED.md](../GETTING_STARTED.md) - Initial setup
- [docs/CLOUD-BUILD-SDK.md](CLOUD-BUILD-SDK.md) - Operations guide

---

<p align="center">
  <sub>Health monitoring for On-Call Cat</sub><br>
  <sub>Last updated: November 25, 2025</sub>
</p>
