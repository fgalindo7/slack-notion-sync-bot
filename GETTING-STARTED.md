# Getting Started with On-Call Cat

This checklist will guide you through your first deployment of On-Call Cat to Google Cloud Platform.

> **Need detailed explanations?** See [docs/CLOUD-BUILD-SDK.md](docs/CLOUD-BUILD-SDK.md) for comprehensive documentation.

## Prerequisites

Ensure you have:
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed
- GCP project with billing enabled
- Node.js 20+ installed
- Slack workspace with admin access
- Notion workspace with integration created

## Step 1: Install Dependencies

```shell
npm install
```

## Step 2: Test Your Setup (Optional)

```shell
npm run lint && npm test
```

## Step 3: Authenticate with GCP

```shell
gcloud auth login
gcloud auth application-default login

export GCP_PROJECT_ID="your-project-id"
export REGION="us-central1"
gcloud config set project $GCP_PROJECT_ID
```

## Step 4: Run Infrastructure Setup

```shell
npm run infra:setup
```

**Prepare your tokens:**
- Slack Bot Token (xoxb-...)
- Slack App Token (xapp-...)
- Notion Integration Token (secret_...)

The script will enable APIs, create repositories, and prompt for secrets.

## Step 5: Grant IAM Permissions

Copy and run the IAM commands displayed by the setup script. They grant Cloud Build permission to deploy, Cloud Run permission to access secrets, and Cloud Deploy permissions for automated deployments.

```shell
# Get your project number
PROJECT_NUMBER=$(gcloud projects describe $GCP_PROJECT_ID --format='value(projectNumber)')

# Cloud Build service account (deploy actions)
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/clouddeploy.releaser"

gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/clouddeploy.viewer"

gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

# Cloud Run compute service account (runtime only)
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"

# Optional: Only if using ML/AI features
# gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
#   --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
#   --role="roles/aiplatform.user"

# Cloud Deploy service agent ActAs permission
gcloud iam service-accounts add-iam-policy-binding \
  ${PROJECT_NUMBER}-compute@developer.gserviceaccount.com \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-clouddeploy.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

> **See detailed explanations in:** [docs/CLOUD-BUILD-SDK.md - IAM & Security](docs/CLOUD-BUILD-SDK.md#iam--security)

## Step 6: Connect GitHub Repository

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

## Step 7: Initialize Cloud Deploy Pipeline

```shell
npm run deploy:init
```

This creates the staging → production deployment pipeline.

## Step 8: Test Automated Deployment

The automated deployment uses SDK-based Cloud Build automation (`cloud-build-automation.mjs`) that:
- Builds Docker image with unique tags
- Creates releases as `rel-<SHA>-<timestamp>`
- Deploys to Cloud Run via Cloud Deploy

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

## Step 9: Promote to Production (Optional)

```shell
npm run deploy:list  # Find release name
gcloud deploy releases promote \
  --delivery-pipeline=oncall-cat-pipeline \
  --region=$REGION \
  --release=<RELEASE_NAME>
```

## Step 10: Verify Deployment

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

- **Operations Guide:** [docs/CLOUD-BUILD-SDK.md](docs/CLOUD-BUILD-SDK.md)
- **NPM Scripts Reference:** [docs/CLOUD-BUILD-SDK.md#npm-scripts-reference](docs/CLOUD-BUILD-SDK.md#npm-scripts-reference)
- **Monitoring:** Use `npm run health` and `npm run logs` (set `TARGET=local` for local container)

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

**For detailed troubleshooting:** See [docs/CLOUD-BUILD-SDK.md - Troubleshooting](docs/CLOUD-BUILD-SDK.md#troubleshooting)

## Need Help?

- **Detailed docs:** [docs/CLOUD-BUILD-SDK.md](docs/CLOUD-BUILD-SDK.md)
- **Issues:** [GitHub Issues](https://github.com/fgalindo7/slack-notion-sync-bot/issues)

---

**Last Updated:** November 20, 2025
