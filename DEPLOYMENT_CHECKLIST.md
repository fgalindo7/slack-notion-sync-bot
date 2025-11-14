# Automated Deployment - Implementation Checklist

## Step 1: Install Dependencies

```shell
npm install
```

This will install the new GCP SDK packages:
- @google-cloud/artifact-registry
- @google-cloud/cloudbuild
- @google-cloud/deploy
- @google-cloud/secret-manager
- @google-cloud/service-management

**Estimated time:** 2-3 minutes

## Step 2: Review Changes

```shell
# View all changes
git status

# Review specific files
git diff README.md
git diff package.json
git diff cloudbuild.yaml

# View new infrastructure directory
ls -la infrastructure/
```

**Estimated time:** 5-10 minutes

## Step 3: Test Scripts (Optional)

```shell
# Test import (after npm install)
node -e "import('./infrastructure/setup-infrastructure.mjs').then(() => console.log('✓ Scripts OK')).catch(console.error)"

# Run linter
npm run lint

# Run tests
npm test
```

**Estimated time:** 1-2 minutes

## Step 4: Commit Changes

```shell
git add .
git commit -m "Add automated GCP deployment infrastructure

Infrastructure as Code Implementation:
- Cloud Deploy pipeline (staging → production)  
- GCP JS SDK for infrastructure provisioning
- Automated CI/CD on push to main
- Version tracking and easy rollbacks

New Files:
- infrastructure/setup-infrastructure.mjs (13.7 KB)
- infrastructure/deploy-automation.mjs (8.1 KB)
- clouddeploy.yaml
- skaffold.yaml
- service.yaml
- infrastructure/README.md (15.4 KB)
- infrastructure/QUICKSTART.md
- infrastructure/IMPLEMENTATION_SUMMARY.md

Updated Files:
- package.json (added GCP SDK dependencies)
- cloudbuild.yaml (Cloud Deploy integration)
- README.md (automated deployment docs)

Scripts:
- npm run infra:setup (infrastructure provisioning)
- npm run deploy:init (pipeline initialization)
- npm run deploy (create release)
- npm run deploy:list (list releases)
- npm run deploy:status (check status)

Benefits:
- Push to deploy (no manual steps)
- Staging environment with approval gates
- Infrastructure as code
- Easy rollbacks
- Version tracking"
```

**Estimated time:** 1 minute

## Step 5: Push to GitHub

```shell
git push origin main
```

**Note:** This will NOT trigger automated deployment yet - Cloud Deploy pipeline must be initialized first (Step 7).

**Estimated time:** 1 minute

## Step 6: Run Infrastructure Setup

```shell
export GCP_PROJECT_ID="staging-383416"
export REGION="us-central1"

npm run infra:setup
```

This interactive wizard will:
1. Enable required GCP APIs
2. Create Artifact Registry repository  
3. Set up Secret Manager secrets (will prompt for values)
4. Display Cloud Build setup instructions
5. Display IAM permission commands

**Estimated time:** 10-15 minutes (includes entering secret values)

## Step 7: Grant IAM Permissions

Copy and run the commands displayed by the setup script:

```shell
PROJECT_NUMBER=$(gcloud projects describe $GCP_PROJECT_ID --format='value(projectNumber)')

gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Estimated time:** 2-3 minutes

## Step 8: Connect GitHub Repository

Visit [Cloud Build Triggers Console](https://console.cloud.google.com/cloud-build/triggers)

1. Click "Connect Repository"
2. Select "GitHub" and authorize
3. Choose: fgalindo7/slack-notion-sync-bot
4. Create trigger with these settings:
   - Name: `oncall-cat-deploy`
   - Event: Push to branch
   - Branch: `^main$`
   - Configuration: Cloud Build configuration file
   - Location: `cloudbuild.yaml`

Or use gcloud:

```shell
gcloud beta builds triggers create github \
  --name="oncall-cat-deploy" \
  --repo-name=slack-notion-sync-bot \
  --repo-owner=fgalindo7 \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml \
  --region=us-central1
```

**Estimated time:** 5 minutes

## Step 9: Initialize Cloud Deploy Pipeline

```shell
npm run deploy:init
```

This will:
1. Replace placeholders in config files (PROJECT_ID, PROJECT_NUMBER)
2. Apply Cloud Deploy pipeline to GCP
3. Create staging and production targets

**Estimated time:** 2-3 minutes

## Step 10: Test Automated Deployment

```shell
# Make a small change
echo "# Test deployment" >> infrastructure/QUICKSTART.md

# Commit and push
git add infrastructure/QUICKSTART.md
git commit -m "Test automated deployment"
git push origin main

# Monitor deployment
npm run deploy:list
npm run deploy:status
```

Watch the deployment in:
- Cloud Build: https://console.cloud.google.com/cloud-build/builds
- Cloud Deploy: https://console.cloud.google.com/deploy/delivery-pipelines

**Estimated time:** 5-10 minutes (includes build time)

## Success Criteria

After completing all steps, you should see:

### Infrastructure Setup

- GCP APIs enabled
- Artifact Registry repository created
- Secret Manager secrets configured
- IAM permissions granted

### Pipeline Configuration

- Cloud Build trigger connected to GitHub
- Cloud Deploy pipeline initialized
- Staging and production targets created

### Automated Deployment Working

- Push to main triggers Cloud Build
- Docker image builds and pushes to Artifact Registry
- Cloud Deploy release created automatically
- Service deploys to staging
- Manual approval gate for production

### Monitoring & Validation

- `npm run deploy:list` shows releases
- `npm run deploy:status` shows deployment info
- Health check endpoint returns version and buildTime
- Service running in Cloud Run

## Estimated Total Time

- **Initial setup:** 30-40 minutes (one-time)
- **Future deployments:** 30 seconds (just `git push`)

## 🆘 Troubleshooting

### "Cannot find package '@google-cloud/...' "

**Solution:** Run `npm install`

### "Permission denied" errors

**Solution:** Ensure IAM permissions are granted (Step 7)

### "API not enabled"

**Solution:** Run `npm run infra:setup` again to enable APIs

### Build fails with "repository not found"

**Solution:** Verify Artifact Registry repository exists:

```shell
gcloud artifacts repositories list --location=us-central1
```

### Cloud Deploy pipeline not found

**Solution:** Run `npm run deploy:init`

## Documentation Quick Links

- **Full Guide:** [infrastructure/README.md](infrastructure/README.md)
- **Quick Start:** [infrastructure/QUICKSTART.md](infrastructure/QUICKSTART.md)  
- **Main README:** [README.md](README.md)
- **Script Flags:** [docs/SCRIPT_FLAGS.md](docs/SCRIPT_FLAGS.md)

## Completion

Once all steps are complete, enjoy automated deployments!

```shell
# Make code changes
git add .
git commit -m "Add feature"
git push origin main

# Deployment happens automatically
```

---

**Created:** November 13, 2025  
**Status:** Ready for implementation  
**Estimated Setup Time:** 30-40 minutes (one-time)
