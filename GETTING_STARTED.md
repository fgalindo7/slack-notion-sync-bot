# Getting Started with On-Call Cat

This checklist will guide you through your first deployment of On-Call Cat to Google Cloud Platform.

> **Need detailed explanations?** See [infrastructure/README.md](infrastructure/README.md) for comprehensive documentation.

## Prerequisites

Ensure you have:
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed
- GCP project with billing enabled
- Node.js 20+ installed
- Slack workspace with admin access
- Notion workspace with integration created

## ✓ Step 1: Install Dependencies

```shell
npm install
```

## ✓ Step 2: Test Your Setup (Optional)

```shell
npm run lint && npm test
```

## ✓ Step 3: Authenticate with GCP

```shell
gcloud auth login
gcloud auth application-default login

export GCP_PROJECT_ID="your-project-id"
export REGION="us-central1"
gcloud config set project $GCP_PROJECT_ID
```

## ✓ Step 4: Run Infrastructure Setup

```shell
npm run infra:setup
```

**Prepare your tokens:**
- Slack Bot Token (xoxb-...)
- Slack App Token (xapp-...)
- Notion Integration Token (secret_...)

The script will enable APIs, create repositories, and prompt for secrets.

## ✓ Step 5: Grant IAM Permissions

Copy and run the IAM commands displayed by the setup script. They grant Cloud Build permission to deploy and Cloud Run permission to access secrets.

> **See the full commands in:** [infrastructure/README.md - Step 4](infrastructure/README.md#step-4-grant-iam-permissions)

## ✓ Step 6: Connect GitHub Repository

**Must use Console** (requires OAuth authorization):

1. Visit [Cloud Build Triggers Console](https://console.cloud.google.com/cloud-build/triggers)
2. Click **"Create Trigger"** → **"Connect new repository"**
3. Choose **"GitHub (Cloud Build GitHub App)"** and authorize
4. Select your forked repository
5. Configure trigger:
   - Name: `oncall-cat-deploy`
   - Event: Push to branch `^main$`
   - Configuration: `cloudbuild.yaml`
6. Click **"Create"**

## ✓ Step 7: Initialize Cloud Deploy Pipeline

```shell
npm run deploy:init
```

This creates the staging → production deployment pipeline.

## ✓ Step 8: Test Automated Deployment

```shell
# Make a test change and push
echo "# Test deployment" >> README.md
git add README.md
git commit -m "Test automated deployment"
git push origin main

# Watch deployment
npm run deploy:list
```

Monitor in [Cloud Build Console](https://console.cloud.google.com/cloud-build/builds) and [Cloud Deploy Console](https://console.cloud.google.com/deploy/delivery-pipelines).

## ✓ Step 9: Promote to Production (Optional)

```shell
npm run deploy:list  # Find release name
gcloud deploy releases promote \
  --delivery-pipeline=oncall-cat-pipeline \
  --region=$REGION \
  --release=<RELEASE_NAME>
```

## ✓ Step 10: Verify Deployment

```shell
SERVICE_URL=$(gcloud run services describe oncall-cat --region=$REGION --format='value(status.url)')
curl $SERVICE_URL/health
```

Expected: `{"status":"healthy","version":"1.0.0",...}`

---

## Setup Complete

### Daily Workflow

```shell
git add .
git commit -m "Your changes"
git push origin main  # Auto-deploys to staging
```

Promote to production via the [Cloud Deploy Console](https://console.cloud.google.com/deploy/delivery-pipelines).

### Next Steps

- **Operations Guide:** [infrastructure/README.md](infrastructure/README.md)
- **Command Reference:** [infrastructure/QUICKSTART.md](infrastructure/QUICKSTART.md)
- **Monitoring:** Use `./scripts/check-health.sh` and `./scripts/view-logs.sh`

## Common Issues

| Problem | Solution |
|---------|----------|
| "Cannot find package '@google-cloud/...'" | Run `npm install` |
| "Permission denied" errors | Grant IAM permissions (Step 5) |
| "API not enabled" error | Run `npm run infra:setup` again |
| Build fails with "repository not found" | Run `npm run infra:setup` to create registry |
| Cloud Deploy pipeline not found | Run `npm run deploy:init` |
| GitHub trigger creation fails | Must use Console (Step 6) - requires OAuth |
| Bot not responding | Check logs, verify secrets, confirm bot invited to channel |

**For detailed troubleshooting:** See [infrastructure/README.md - Troubleshooting](infrastructure/README.md#troubleshooting)

## Need Help?

- **Detailed docs:** [infrastructure/README.md](infrastructure/README.md)
- **Quick commands:** [infrastructure/QUICKSTART.md](infrastructure/QUICKSTART.md)
- **Issues:** [GitHub Issues](https://github.com/fgalindo7/slack-notion-sync-bot/issues)

---

**Last Updated:** November 13, 2025
