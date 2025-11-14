# Infrastructure Automation

This directory contains infrastructure-as-code for GCP deployment automation using the Google Cloud SDK for JavaScript/Node.js.

> **First time deploying?** Start with [GETTING_STARTED.md](../GETTING_STARTED.md) for a step-by-step checklist.

## Overview

This infrastructure automation replaces manual `gcloud` commands with programmatic infrastructure management using official GCP client libraries.

### Architecture

```
┌─────────────────────────────────────────────────┐
│              Cloud Deploy Pipeline              |
│                                                 |
│  GitHub Push → Cloud Build → Artifact Registry  |
│                        ↓                        |
│              Cloud Deploy Release               |
│                        ↓                        |
│            ┌──────────────────────┐             |
│            │  Staging Environment │             |
│            └──────────────────────┘             |
│                        ↓                        |
│                 Manual Approval                 |
│                        ↓                        |
│            ┌────────────────────────┐           |
│            │ Production Environment │           |
│            └────────────────────────┘           |
└─────────────────────────────────────────────────┘
```

## Files

### Infrastructure Management

- **`setup-infrastructure.mjs`** - Main infrastructure provisioning script
  - Enables required GCP APIs
  - Creates Artifact Registry repository
  - Sets up Secret Manager secrets
  - Configures Cloud Build triggers
  - Prepares Cloud Deploy pipeline

- **`deploy-automation.mjs`** - Deployment automation script
  - Initializes Cloud Deploy pipeline
  - Creates releases
  - Promotes to production
  - Monitors deployment status

### Configuration Files

- **`../clouddeploy.yaml`** - Cloud Deploy pipeline definition
  - Defines staging and production targets
  - Requires approval for production deployments

- **`../skaffold.yaml`** - Build and deployment configuration
  - Docker build settings
  - Cloud Run deployment profiles

- **`../service.yaml`** - Cloud Run service specification
  - Container configuration
  - Environment variables
  - Secret references
  - Health checks and resource limits

## Quick Start

**First deployment?** Follow [GETTING_STARTED.md](../GETTING_STARTED.md) for complete setup instructions.

**Already deployed?** Jump to [Deployment Workflows](#deployment-workflows) for daily operations.

## Deployment Workflows

### Automatic Deployment (Recommended)

**Trigger:** Push to `main` branch

**Flow:**
1. Developer pushes code to GitHub `main` branch
2. Cloud Build trigger fires automatically
3. Docker image builds with timestamp tag
4. Cloud Deploy creates release
5. Automatically deploys to **staging**
6. **Manual approval required** for production
7. Promote to production via console or CLI

**Monitor deployments:**

```shell
# View recent releases
npm run deploy:list

# Check deployment status
npm run deploy:status

# Watch Cloud Build logs
gcloud builds list --limit=5
gcloud builds log <BUILD_ID> --stream
```

### Manual Deployment

```shell
npm run deploy
```

This will:
1. List recent releases
2. Create a new release with timestamp
3. Deploy to staging
4. Prompt for production promotion approval

**Promote to production later:**

```shell
gcloud deploy releases promote \
  --delivery-pipeline=oncall-cat-pipeline \
  --region=us-central1 \
  --release=release-<TIMESTAMP>
```

## Configuration Management

### Updating Secrets

```shell
# Update a secret interactively
echo -n "new-token-value" | gcloud secrets versions add slack-bot-token --data-file=-

# Update channel mappings
cat channel-mappings.json | gcloud secrets versions add channel-mappings --data-file=-
```

### Modifying Service Configuration

Edit `service.yaml` for:
- Environment variables
- Resource limits (CPU, memory)
- Scaling (min/max instances)
- Health checks

Deploy changes:

```shell
npm run deploy
```

## Monitoring & Debugging

### View Deployment Status

```shell
# List all releases
npm run deploy:list

# Check current deployment status
npm run deploy:status

# View Cloud Deploy pipeline
gcloud deploy delivery-pipelines describe oncall-cat-pipeline \
  --region=us-central1
```

### View Logs

```shell
# Cloud Run logs
gcloud run services logs read oncall-cat \
  --region=us-central1 \
  --limit=50

# Cloud Build logs
gcloud builds list --limit=10
gcloud builds log <BUILD_ID>

# Cloud Deploy logs
gcloud deploy rollouts list \
  --delivery-pipeline=oncall-cat-pipeline \
  --region=us-central1
```

### Health Checks

```shell
# Using existing health check script
export PROJECT_ID=$GCP_PROJECT_ID
./scripts/check-health.sh

# Or query directly
SERVICE_URL=$(gcloud run services describe oncall-cat \
  --region=us-central1 \
  --format='value(status.url)')

curl $SERVICE_URL/health
curl $SERVICE_URL/metrics
```

## Rollback Procedures

### Rollback to Previous Release

```shell
# List recent releases
npm run deploy:list

# Rollback to specific release
gcloud deploy rollouts create \
  --delivery-pipeline=oncall-cat-pipeline \
  --region=us-central1 \
  --release=release-<PREVIOUS_TIMESTAMP> \
  --to-target=production
```

### Emergency Rollback via Cloud Run

```shell
# List recent revisions
gcloud run revisions list \
  --service=oncall-cat \
  --region=us-central1

# Route traffic to previous revision
gcloud run services update-traffic oncall-cat \
  --region=us-central1 \
  --to-revisions=oncall-cat-00010-abc=100
```

## Troubleshooting

### Common Issues

**Issue: "Permission denied" errors**
- **Solution**: Ensure IAM permissions are granted (Step 4)
- **Check**: `gcloud projects get-iam-policy $GCP_PROJECT_ID`

**Issue: "API not enabled"**
- **Solution**: Run `npm run infra:setup` again
- **Manual**: `gcloud services enable <API_NAME>`

**Issue: Build fails with "image not found"**
- **Solution**: Ensure Artifact Registry repository exists
- **Verify**: `gcloud artifacts repositories list --location=us-central1`

**Issue: Secrets not found**
- **Solution**: Verify secrets exist and have versions
- **Check**: `gcloud secrets list`
- **Fix**: Run `npm run infra:setup` and re-enter secret values

**Issue: Cloud Deploy pipeline not found**
- **Solution**: Run `npm run deploy:init`
- **Verify**: `gcloud deploy delivery-pipelines list --region=us-central1`

### Debug Mode

Enable debug logging for infrastructure scripts:

```shell
export DEBUG=true
npm run infra:setup
```

View detailed Cloud Build logs:

```shell
gcloud builds list --filter="status=FAILURE" --limit=5
gcloud builds log <BUILD_ID> --stream
```

## Cost Optimization

### Estimated Monthly Costs

- **Cloud Run**: ~$5-20/month (depends on traffic)
  - 1 min instance always running (Socket Mode requirement)
  - CPU: 2 vCPU, Memory: 1 GiB
- **Cloud Build**: ~$0-5/month (free tier covers most usage)
- **Artifact Registry**: ~$0-2/month (storage only)
- **Secret Manager**: ~$0.06/month (6 active secrets)
- **Cloud Deploy**: Free

**Total: ~$5-27/month**

### Reduce Costs

1. **Right-size resources** - Adjust CPU/memory in `service.yaml` if overprovisioned
2. **Optimize build cache** - Use Docker layer caching in `cloudbuild.yaml`
3. **Clean old images** - Set up Artifact Registry retention policies:

   ```shell
   gcloud artifacts repositories set-cleanup-policies oncall-cat \
     --location=us-central1 \
     --policy=policy.json
   ```

## Benefits of Infrastructure as Code

**Automated**: Push to deploy - no manual steps
**Reproducible**: Infrastructure defined as code
**Auditable**: All changes tracked in git
**Safe**: Staging → approval → production flow
**Fast**: Parallel builds, cached layers
**Maintainable**: JavaScript SDK with type safety

## Advanced Usage

### Custom Deployment Targets

Add additional environments (e.g., `development`, `staging-2`):

1. Edit `clouddeploy.yaml` to add target:

   ```yaml
   ---
   apiVersion: deploy.cloud.google.com/v1
   kind: Target
   metadata:
     name: development
   description: Development environment
   run:
     location: projects/_PROJECT_ID_/locations/us-central1
   ```

2. Update pipeline stages:

   ```yaml
   serialPipeline:
     stages:
       - targetId: development
       - targetId: staging
       - targetId: production
         requireApproval: true
   ```

3. Re-apply configuration:

   ```shell
   npm run deploy:init
   ```

### Parallel Deployments

Deploy to multiple regions:

1. Create Cloud Deploy targets for each region
2. Use `multiTarget` delivery strategy
3. Update `clouddeploy.yaml`:

   ```yaml
   serialPipeline:
     stages:
       - targetId: staging-us-central1
       - targetId: staging-europe-west1
         profiles: [europe]
   ```

### Canary Deployments

Gradually roll out changes:

1. Update `clouddeploy.yaml` with canary strategy:

   ```yaml
   strategy:
     canary:
       runtimeConfig:
         cloudRun:
           automaticTrafficControl: true
       canaryDeployment:
         percentages: [25, 50, 75]
         verify: false
   ```

2. Deploy as normal - traffic gradually shifts

## Security Best Practices

### Secret Management

✅ **DO**:
- Store sensitive data in Secret Manager
- Rotate secrets regularly
- Use secret versions for rollbacks
- Grant least-privilege access

❌ **DON'T**:
- Commit secrets to git
- Share secrets via chat/email
- Use same secrets across environments
- Grant broad secret access

### IAM Permissions

✅ **DO**:
- Use service accounts with minimal permissions
- Enable Cloud Audit Logs
- Review IAM policies quarterly
- Use Workload Identity for GKE (if applicable)

❌ **DON'T**:
- Use user accounts for automation
- Grant `roles/owner` to service accounts
- Disable audit logs
- Share service account keys

### Network Security

- Enable VPC Service Controls (for enterprise)
- Use Cloud Armor for DDoS protection
- Restrict ingress to authenticated users only
- Enable Container Threat Detection

## Support & Documentation

### Official Documentation

- [Cloud Deploy](https://cloud.google.com/deploy/docs)
- [Cloud Build](https://cloud.google.com/build/docs)
- [Cloud Run](https://cloud.google.com/run/docs)
- [Artifact Registry](https://cloud.google.com/artifact-registry/docs)
- [Secret Manager](https://cloud.google.com/secret-manager/docs)

### Project Documentation

- [GETTING_STARTED.md](../GETTING_STARTED.md) - Step-by-step deployment checklist
- [Main README](../README.md) - Project overview
- [AGENTS.md](../AGENTS.md) - AI-assisted development guide

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/fgalindo7/slack-notion-sync-bot/issues)
- **Discussions**: [GitHub Discussions](https://github.com/fgalindo7/slack-notion-sync-bot/discussions)

---

<p align="center">
  <sub>🚀 Infrastructure as Code for On-Call Cat</sub><br>
  <sub>Last updated: November 13, 2025</sub>
</p>
