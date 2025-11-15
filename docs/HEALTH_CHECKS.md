# Health Checks & Monitoring

Comprehensive guide to monitoring On-Call Cat's health, performance, and deployment status.

## Overview

The enhanced health check system provides real-time visibility into:
- Application health and configuration
- Cloud Run service status
- Cloud Deploy pipeline state
- Cloud Build history
- Git version synchronization

## Quick Start

### Basic Usage

```shell
# Single health check
npm run health

# Watch mode (auto-refresh every 30s)
npm run health:watch

# JSON output (for automation - use --silent to suppress npm output)
npm run health:json --silent
```

### Custom Options

```shell
# Custom refresh interval (watch mode)
node scripts/check-health.mjs --watch --interval=60000  # 60 seconds

# Show specific section only
node scripts/check-health.mjs --section=app     # Application only
node scripts/check-health.mjs --section=run     # Cloud Run only
node scripts/check-health.mjs --section=deploy  # Cloud Deploy only
node scripts/check-health.mjs --section=build   # Cloud Build only
node scripts/check-health.mjs --section=git     # Version info only

# Verbose mode
node scripts/check-health.mjs --verbose
```

## Dashboard Sections

### [APP] Application Health

Displays the bot's runtime status and configuration.

**Metrics Shown:**
- **Status:** Healthy/Unhealthy indicator
- **Uptime:** Time since last restart
- **Last Activity:** Time since last Slack message processed
- **Mode:** Single-channel or Multi-channel configuration
- **Channels:** List of monitored Slack channels with:
  - Real channel names (fetched via Slack API)
  - Channel IDs
  - Mapped Notion database titles
- **Message Metrics:**
  - Total messages processed
  - Messages created vs updated
  - Success rate with warning indicator (!! if < 95%)
  - Failures and API timeouts

**Health Indicators:**
- `OK HEALTHY` (green) - Service operational
- `ERR UNHEALTHY` (red) - Service degraded or down
- `N/A 0%` (gray) - No activity yet (normal for new deployments)
- `!! 94.2%` (yellow) - Success rate below 95%

### [CR] Cloud Run Service

Shows the current Cloud Run deployment configuration.

**Information Displayed:**
- **Service Name:** `oncall-cat`
- **Current Revision:** Active revision with creation timestamp
- **Traffic Split:** Percentage distribution across revisions
- **Resources:** Allocated CPU and memory
- **Scaling:** Min/max instances configuration
- **Service URL:** Direct link to the service
- **Console Link:** Opens Cloud Run service in GCP Console

**Example Output:**

```
Service:       oncall-cat
Revision:      oncall-cat-mhybstgq (2025-11-14 03:57:05 UTC)
Traffic:       100% → latest
Resources:     2 vCPU | 1Gi memory
Scaling:       1-10 instances
URL:           https://oncall-cat-xxx.run.app
Console:       -> View in GCP Console
```

### [CD] Cloud Deploy Pipeline

Tracks deployment pipeline status and target environments.

**Information Displayed:**
- **Pipeline Name:** `oncall-cat-pipeline`
- **Latest Release:** Release name and creation time
- **Render State:** SUCCEEDED, IN_PROGRESS, or FAILED
- **Deployment Targets:**
  - **Staging:** Status and auto-deploy indicator
  - **Production:** Status and approval requirement
- **Console Link:** Opens Cloud Deploy pipeline in GCP Console

**Target States:**
- `[OK] SUCCEEDED` (green) - Deployed successfully
- `[ERR] FAILED` (red) - Deployment failed
- `[...] IN_PROGRESS` (yellow) - Currently deploying
- `[WAIT] PENDING_APPROVAL` (yellow) - Waiting for manual approval

### [CB] Cloud Build

Shows recent build history and trigger information.

**Information Displayed:**
- **Recent Builds (last 3):**
  - Build ID (first 8 characters)
  - Status: SUCCESS, FAILURE, or IN_PROGRESS
  - Duration
  - Git commit SHA
  - Trigger type: `[TRIGGER]` (automatic) or `[MANUAL]`
  - Build timestamp
- **Console Link:** Opens Cloud Build history in GCP Console

**Build Status Icons:**
- `[OK]` (green) - Successful build
- `[ERR]` (red) - Failed build
- Status text (yellow) - Build in progress

### [GIT] Version Info

Compares deployed version with local repository state.

**Information Displayed:**
- **Deployed Version:** Build time and commit info from running service
- **Local Version:** Current git commit and timestamp
- **Sync Status:**
  - `[OK] Up to date` (green) - Local and deployed match
  - `! Local ahead` (yellow) - Uncommitted or unpushed changes
  - `! Deployed ahead` (yellow) - Need to pull updates
- **Current Branch:** Active git branch
- **Uncommitted Changes:** Warning if working directory is dirty
- **GitHub Link:** Direct link to commit on GitHub

## Terminal Hyperlink Support

The health check script automatically detects terminal capabilities:

### Supported Terminals (Clickable Links)

- iTerm2 (macOS)
- VS Code integrated terminal
- WezTerm
- Hyper
- Windows Terminal (recent versions)

### Fallback (URL Truncation)

For terminals without hyperlink support, URLs are intelligently truncated:

```
https://console.cloud.google.com/r...383416
```

## Monitoring Strategies

### Development Workflow

```shell
# Terminal 1: Watch health during development
npm run health:watch

# Terminal 2: Make code changes and deploy
git add .
git commit -m "Feature: Add new functionality"
git push origin main

# Observe automatic deployment in Terminal 1
```

### Production Monitoring

```shell
# Check production health every 5 minutes
watch -n 300 'npm run health'

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
    if jq -e '.health.status != "healthy"' health-report.json; then
      exit 1
    fi
```

## Warning Indicators

The dashboard displays warnings for:

### Application Warnings

- **Success rate < 95%:** `!! 94.2%` - Indicates increased error rate
- **No recent activity:** Gray metrics - Normal for low-traffic channels
- **Uncommitted changes:** `! Uncommitted changes` - Local differs from deployed

### Deployment Warnings

- **Pending approvals:** `[WAIT] PENDING_APPROVAL` - Production needs manual promotion
- **Failed deployments:** `[ERR] FAILED` - Check logs for errors
- **Render failures:** `RENDER_STATE: FAILED` - Skaffold or manifest issues

### Build Warnings

- **All manual builds:** No `[TRIGGER]` indicator - GitHub trigger not connected
- **Recent failures:** `[ERR]` in build list - Check build logs

## Troubleshooting

### Issue: "Service not found or not deployed"

**Cause:** Cloud Run service doesn't exist or wrong project/region

**Solution:**

```shell
# Verify project and region
echo $GCP_PROJECT_ID
echo $REGION

# List services
gcloud run services list --region=$REGION
```

### Issue: "Status: UNHEALTHY"

**Causes:**
1. Socket Mode connection failed
2. Missing environment variables
3. Invalid secrets

**Solution:**

```shell
# Check service logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=oncall-cat" --limit=20

# Verify secrets exist
gcloud secrets list | grep -E "slack|notion|channel"

# Check current revision
gcloud run revisions describe $(gcloud run services describe oncall-cat --region=$REGION --format='value(status.latestReadyRevisionName)') --region=$REGION
```

### Issue: "Success rate < 95%"

**Causes:**
1. Validation errors in Slack messages
2. Notion API errors
3. Network timeouts

**Solution:**

```shell
# Check recent errors
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=oncall-cat AND severity>=ERROR" --limit=10

# Review metrics endpoint
curl $(gcloud run services describe oncall-cat --region=$REGION --format='value(status.url)')/metrics | jq '.'
```

### Issue: "No channel names displayed"

**Cause:** Missing `SLACK_BOT_TOKEN` environment variable or invalid token

**Solution:**

```shell
# Verify token is set (in local environment for health check)
echo $SLACK_BOT_TOKEN

# Or set temporarily
export SLACK_BOT_TOKEN=$(gcloud secrets versions access latest --secret=slack-bot-token)
npm run health
```

### Issue: "All builds show [MANUAL]"

**Cause:** GitHub App trigger not connected

**Solution:**
1. Open Cloud Build Triggers console
2. Connect GitHub repository
3. Update trigger to use GitHub App connection
4. Test with a commit

See [GETTING_STARTED.md - Step 6](../GETTING_STARTED.md#-step-6-connect-github-repository) for details.

## Integration with Other Tools

### Slack Notifications

```shell
#!/bin/bash
# Post health status to Slack

HEALTH=$(npm run health:json --silent)
STATUS=$(echo $HEALTH | jq -r '.health.status')

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

const health = JSON.parse(execSync('npm run health:json --silent'));

console.log(`oncall_cat_status{status="${health.health.status}"} 1`);
console.log(`oncall_cat_messages_processed ${health.health.metrics.messagesProcessed}`);
console.log(`oncall_cat_success_rate ${parseFloat(health.health.metrics.successRate)}`);
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
| `GCP_PROJECT_ID` or `PROJECT_ID` | Yes | - | GCP project ID |
| `REGION` | No | `us-central1` | GCP region |
| `SLACK_BOT_TOKEN` | No | - | Fetch real channel names |
| `NOTION_TOKEN` | No | - | Fetch database titles |
| `TERM_PROGRAM` | Auto-detected | - | Terminal hyperlink support |

## Best Practices

### Regular Checks

- Run `npm run health` before making changes
- Use `npm run health:watch` during deployments
- Add health check to deployment scripts

### Automation

- Schedule periodic health checks
- Export JSON for monitoring systems
- Alert on status changes

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
- [infrastructure/README.md](../infrastructure/README.md) - Operations guide
- [GCP_DEPLOYMENT.md](GCP_DEPLOYMENT.md) - Detailed deployment procedures

---

<p align="center">
  <sub>📊 Health monitoring for On-Call Cat</sub><br>
  <sub>Last updated: November 14, 2025</sub>
</p>
