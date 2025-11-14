# GCP Infrastructure Automation - Quick Start

## One-Time Setup

```shell
# 1. Install dependencies
npm install

# 2. Set project ID
export GCP_PROJECT_ID="staging-383416"

# 3. Run infrastructure setup (interactive)
npm run infra:setup

# 4. Grant IAM permissions (commands shown by setup script)
PROJECT_NUMBER=$(gcloud projects describe $GCP_PROJECT_ID --format='value(projectNumber)')
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"

# 5. Connect GitHub repository in Cloud Build Console
# Visit: https://console.cloud.google.com/cloud-build/triggers

# 6. Initialize Cloud Deploy pipeline
npm run deploy:init
```

## ⚡ Daily Workflow

```shell
# Make code changes
git add .
git commit -m "Add new feature"

# Push to main → automatic deployment to staging
git push origin main

# Monitor deployment
npm run deploy:list
npm run deploy:status

# Promote to production (after testing)
gcloud deploy releases promote \
  --delivery-pipeline=oncall-cat-pipeline \
  --region=us-central1 \
  --release=release-<TIMESTAMP>
```

## What Gets Created

- Cloud Run service (`oncall-cat`)
- Artifact Registry repository
- Secret Manager secrets
- Cloud Build trigger (on push to main)
- Cloud Deploy pipeline (staging → production)

## Useful Commands

```shell
# View deployments
npm run deploy:list

# Check status
npm run deploy:status

# Manual deploy
npm run deploy

# View logs
gcloud run services logs read oncall-cat --region=us-central1

# Health check
./scripts/check-health.sh
```

## 📚 Full Documentation

See [infrastructure/README.md](./README.md) for complete documentation.

---

**Created:** November 13, 2025
# Testing Cloud Build trigger - Thu Nov 13 18:33:18 PST 2025
