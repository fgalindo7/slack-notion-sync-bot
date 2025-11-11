# Google Cloud Platform Deployment Guide

Complete guide for deploying On-Call Cat to Google Cloud Run.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Deployment Steps](#deployment-steps)
4. [Verification](#verification)
5. [Configuration Updates](#configuration-updates)
6. [Monitoring](#monitoring)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools

- **gcloud SDK**: [Install here](https://cloud.google.com/sdk/docs/install)
- **jq** (for health check script): `brew install jq`
- **Docker** (for local testing): [Install here](https://docs.docker.com/get-docker/)

### Required Credentials

Before starting, have these ready:

- **Slack Bot Token** (starts with `xoxb-`)
- **Slack App-Level Token** (starts with `xapp-`)
- **Notion Integration Token** (starts with `secret_` or `ntn_`)
- **Channel ID(s)** and **Database ID(s)** from your setup

### GCP Account Setup

1. Create or select a GCP project
2. Enable billing for the project
3. Note your **Project ID**

---

## Initial Setup

### 1. Authenticate with GCP

```shell
# Login to GCP
gcloud auth login

# Set your project ID (replace with your actual project ID)
export PROJECT_ID="your-gcp-project-id"
gcloud config set project $PROJECT_ID

# Set your preferred region
export REGION="us-central1"  # or us-east1, europe-west1, etc.
```

### 2. Run Setup Script

This will enable required APIs and create the Artifact Registry repository:

```shell
./scripts/setup-gcp.sh
```

**What this does:**
- Enables Cloud Run, Artifact Registry, Secret Manager, Cloud Build APIs
- Creates `oncall-cat` Docker repository in Artifact Registry
- Configures Docker authentication

### 3. Create Secrets

Store your credentials securely in Secret Manager:

```shell
./scripts/create-secrets.sh
```

**You'll be prompted for:**
- Slack Bot Token
- Slack App-Level Token
- Notion Integration Token
- (Optional) Slack Signing Secret
- (Optional) channel-mappings.json for multi-channel mode

**Verify secrets were created:**

```shell
gcloud secrets list
```

---

## Deployment Steps

### Option A: Quick Deployment (Recommended)

**For Single-Channel Mode:**

```shell
# Set your channel and database IDs
export WATCH_CHANNEL_ID="C1234567890"
export NOTION_DATABASE_ID="abc123def456ghi789"

# Build and deploy in one command
gcloud builds submit --config cloudbuild.yaml && \
./scripts/deploy-gcp.sh
```

**For Multi-Channel Mode:**

```shell
# Create your channel-mappings.json first (see example)
cp channel-mappings.json.example channel-mappings.json
# Edit channel-mappings.json with your actual channel/database IDs

# Upload to Secret Manager (if not done in setup)
gcloud secrets create channel-mappings --data-file=channel-mappings.json

# Build and deploy
export MULTI_CHANNEL=true
gcloud builds submit --config cloudbuild.yaml && \
./scripts/deploy-gcp.sh
```

### Option B: Step-by-Step Deployment

**Step 1: Build Docker Image**

```shell
gcloud builds submit --config cloudbuild.yaml
```

This builds your Docker image and pushes it to Artifact Registry.

**Step 2: Deploy to Cloud Run**

```shell
# Single-channel
export WATCH_CHANNEL_ID="C1234567890"
export NOTION_DATABASE_ID="abc123def456ghi789"
./scripts/deploy-gcp.sh

# OR Multi-channel
export MULTI_CHANNEL=true
./scripts/deploy-gcp.sh
```

---

## Verification

### 1. Check Deployment Status

```shell
# View service details
gcloud run services describe oncall-cat --region=$REGION

# Get service URL
SERVICE_URL=$(gcloud run services describe oncall-cat --region=$REGION --format='value(status.url)')
echo "Service URL: $SERVICE_URL"
```

### 2. Test Health Endpoint

```shell
./scripts/check-health.sh
```

**Expected output:**

```json
{
  "status": "healthy",
  "uptime": 123.45,
  "metrics": {
    "messagesProcessed": 0,
    "messagesCreated": 0,
    ...
  }
}
```

### 3. View Logs

```shell
# View recent logs
./scripts/view-logs.sh

# Follow logs in real-time
./scripts/view-logs.sh --follow
```

**Look for:**

```
⚡️ On-Call Cat running (Socket Mode)
```

### 4. Test with Slack

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

```shell
# Example: Change log level to debug
gcloud run services update oncall-cat \
  --region=$REGION \
  --set-env-vars="LOG_LEVEL=debug"
```

### Update Secrets

```shell
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

```shell
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

```shell
# Build new image
gcloud builds submit --config cloudbuild.yaml

# Deployment will automatically use latest image
./scripts/deploy-gcp.sh
```

---

## Monitoring

### Cloud Console

View in GCP Console:
- **Cloud Run**: https://console.cloud.google.com/run
- **Logs**: https://console.cloud.google.com/logs
- **Metrics**: https://console.cloud.google.com/monitoring

### Command Line Monitoring

```shell
# View recent logs
./scripts/view-logs.sh

# Follow logs in real-time
./scripts/view-logs.sh --follow

# Filter logs by severity (using gcloud logging)
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=oncall-cat AND severity>=ERROR" \
  --limit=50 \
  --project=$PROJECT_ID

# Check service metrics
./scripts/check-health.sh
```

### Set Up Alerts

```shell
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

## Troubleshooting

### Service Not Starting

**Check logs for errors:**

```shell
./scripts/view-logs.sh
```

**Common issues:**
- Missing secrets → Run `./scripts/create-secrets.sh`
- Wrong secret names → Verify with `gcloud secrets list`
- Insufficient permissions → Check IAM roles

### Socket Mode Connection Issues

**Symptoms:** Service starts but doesn't respond to Slack messages

**Fix:**
1. Verify `SLACK_APP_LEVEL_TOKEN` is correct (starts with `xapp-`)
2. Check Socket Mode is enabled in Slack app settings
3. Ensure `--min-instances=1` (connection requires persistent instance)
4. Check logs for connection errors

### Permission Errors

**Grant Cloud Run service account access to secrets:**

```shell
# Get service account email
SA_EMAIL=$(gcloud run services describe oncall-cat \
  --region=$REGION \
  --format='value(spec.template.spec.serviceAccountName)')

# Grant Secret Manager access
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

### High Costs

**Check instance count:**

```shell
gcloud run services describe oncall-cat \
  --region=$REGION \
  --format='value(spec.template.spec.containerConcurrency)'
```

**Optimize:**
- Ensure `--max-instances=3` (or appropriate limit)
- Keep `--min-instances=1` for Socket Mode
- Review logs for excessive errors causing restarts

### Rollback to Previous Version

```shell
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

```shell
# Delete service
gcloud run services delete oncall-cat --region=$REGION

# Redeploy
./scripts/deploy-gcp.sh
```

---

## Cost Estimates

**Typical monthly costs for 24/7 operation:**

- **Cloud Run**: $15-25/month
  - 1 instance always running (min-instances=1)
  - 512Mi RAM, 1 CPU
  - Minimal request volume
  
- **Secret Manager**: ~$0.60/month
  - 6 active secrets
  - Minimal access requests

- **Artifact Registry**: ~$0.10/month
  - <1GB storage for Docker images

- **Cloud Build**: ~$0.50/month
  - Assuming 10 builds/month (first 120 min free)

**Total: ~$16-27/month** (significantly cheaper than a VM!)

---

## Additional Resources

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Secret Manager Documentation](https://cloud.google.com/secret-manager/docs)
- [Artifact Registry Documentation](https://cloud.google.com/artifact-registry/docs)
- [Cloud Build Documentation](https://cloud.google.com/build/docs)

---

## Support

For issues or questions:
1. Check the [main README.md](../README.md)
2. Review [Troubleshooting section](#troubleshooting)
3. Check Cloud Run logs: `./scripts/view-logs.sh`
