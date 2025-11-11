# GCP Deployment Quick Reference

Quick command reference for deploying and managing On-Call Cat on Google Cloud Platform.

## Initial Setup (One-Time)

```shell
# Set environment variables
export PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"

# Run complete setup wizard (recommended)
./scripts/setup-and-deploy.sh
```

## Manual Setup Steps

```shell
# 1. Initial GCP setup
./scripts/setup-gcp.sh

# 2. Create secrets
./scripts/create-secrets.sh

# 3. Build Docker image
gcloud builds submit --config cloudbuild.yaml

# 4. Deploy (single-channel)
export WATCH_CHANNEL_ID="C1234567890"
export NOTION_DATABASE_ID="abc123def456"
./scripts/deploy-gcp.sh

# 4. Deploy (multi-channel)
export MULTI_CHANNEL=true
./scripts/deploy-gcp.sh
```

## Monitoring Commands

```shell
# Check service health
./scripts/check-health.sh

# View recent logs
./scripts/view-logs.sh

# Follow logs in real-time
./scripts/view-logs.sh --follow

# View service details
gcloud run services describe oncall-cat --region=$REGION

# Get service URL
gcloud run services describe oncall-cat \
  --region=$REGION \
  --format='value(status.url)'
```

## Update Commands

```shell
# Update environment variables
gcloud run services update oncall-cat \
  --region=$REGION \
  --set-env-vars="LOG_LEVEL=debug"

# Update a secret
echo -n "new-token" | \
  gcloud secrets versions add slack-bot-token --data-file=-

# Rebuild and redeploy
gcloud builds submit --config cloudbuild.yaml && \
./scripts/deploy-gcp.sh

# Force restart service
gcloud run services update oncall-cat \
  --region=$REGION \
  --update-labels="updated=$(date +%s)"
```

## Troubleshooting Commands

```shell
# Check for errors in logs
gcloud run services logs read oncall-cat \
  --region=$REGION \
  --log-filter="severity>=ERROR"

# List all secrets
gcloud secrets list

# View secret value
gcloud secrets versions access latest --secret=slack-bot-token

# List service revisions
gcloud run revisions list \
  --service=oncall-cat \
  --region=$REGION

# Rollback to previous revision
gcloud run services update-traffic oncall-cat \
  --region=$REGION \
  --to-revisions=REVISION_NAME=100

# Delete and redeploy
gcloud run services delete oncall-cat --region=$REGION
./scripts/deploy-gcp.sh
```

## Secret Management

```shell
# Create new secret
echo -n "secret-value" | \
  gcloud secrets create SECRET_NAME --data-file=-

# Update existing secret
echo -n "new-value" | \
  gcloud secrets versions add SECRET_NAME --data-file=-

# Update channel mappings
gcloud secrets versions add channel-mappings \
  --data-file=channel-mappings.json

# List secret versions
gcloud secrets versions list SECRET_NAME

# Disable old version
gcloud secrets versions disable VERSION_ID --secret=SECRET_NAME
```

## Cost Management

```shell
# View current usage
gcloud run services describe oncall-cat \
  --region=$REGION \
  --format='yaml(status.conditions)'

# Check instance count
gcloud run services describe oncall-cat \
  --region=$REGION \
  --format='value(spec.template.spec.containerConcurrency)'

# View billing
gcloud alpha billing accounts list
gcloud alpha billing projects describe $PROJECT_ID
```

## CI/CD Setup

```shell
# Connect GitHub repository
gcloud beta builds triggers create github \
  --repo-name=slack-notion-sync-bot \
  --repo-owner=fgalindo7 \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml

# List triggers
gcloud builds triggers list

# Run trigger manually
gcloud builds triggers run TRIGGER_ID

# View build history
gcloud builds list --limit=10
```

## Cleanup Commands

```shell
# Delete Cloud Run service
gcloud run services delete oncall-cat --region=$REGION

# Delete Artifact Registry repository
gcloud artifacts repositories delete oncall-cat --location=$REGION

# Delete all secrets
gcloud secrets delete slack-bot-token
gcloud secrets delete slack-app-token
gcloud secrets delete notion-token
gcloud secrets delete channel-mappings

# Delete build triggers
gcloud builds triggers delete TRIGGER_ID
```

## Useful Filters

```shell
# Filter logs by message type
gcloud run services logs read oncall-cat \
  --region=$REGION \
  --log-filter='jsonPayload.trigger="auto"'

# Filter by user
gcloud run services logs read oncall-cat \
  --region=$REGION \
  --log-filter='jsonPayload.user="U1234567890"'

# Filter by time range
gcloud run services logs read oncall-cat \
  --region=$REGION \
  --log-filter='timestamp>="2025-11-10T00:00:00Z"'
```

## Environment Variables Reference

### Required (Single-Channel)
- `SLACK_BOT_TOKEN` (secret)
- `SLACK_APP_LEVEL_TOKEN` (secret)
- `NOTION_TOKEN` (secret)
- `WATCH_CHANNEL_ID`
- `NOTION_DATABASE_ID`
- `CHANNEL_DB_MAPPINGS=false`

### Required (Multi-Channel)
- `SLACK_BOT_TOKEN` (secret)
- `SLACK_APP_LEVEL_TOKEN` (secret)
- `NOTION_TOKEN` (secret)
- `CHANNEL_DB_MAPPINGS=true`
- `/secrets/channel-mappings` (secret file)

### Optional
- `ALLOW_THREADS=false`
- `API_TIMEOUT=10000`
- `SCHEMA_CACHE_TTL=3600000`
- `HEALTH_PORT=3000`
- `PORT=1987`
- `LOG_LEVEL=info`

## Cloud Run Configuration

### Recommended Settings
```shell
--min-instances=1          # Keep Socket Mode connection alive
--max-instances=3          # Prevent runaway costs
--memory=512Mi             # Sufficient for most workloads
--cpu=1                    # Adequate performance
--timeout=300              # 5-minute timeout
--port=1987                # Application port
```

### Performance Settings
```shell
--memory=1Gi               # For high-volume channels
--cpu=2                    # For faster processing
--concurrency=80           # Default, adjust if needed
```

## Support Resources

- **Full Documentation**: `docs/GCP_DEPLOYMENT.md`
- **Main README**: `README.md`
- **GCP Console**: https://console.cloud.google.com
- **Cloud Run Docs**: https://cloud.google.com/run/docs
