# Testing Builds and Deployments Locally

This guide shows how to test your build and deployment configuration before pushing to GitHub.

## Quick Summary

```bash
# Test the full build + deploy process locally
npm run deploy:cloud

# Or test just the build
npm run build:cloud
```

## Detailed Testing Workflows

### Option 1: Full End-to-End Test (Recommended)

This tests the complete workflow: build Docker image → push to registry → create Cloud Deploy release

```bash
# Run full build and deploy
npm run deploy:cloud
```

**What this does:**
1. Uses Cloud Build SDK to create a remote build in GCP
2. Builds Docker image with your current git commit SHA
3. Pushes to Artifact Registry
4. Creates Cloud Deploy release using gcloud CLI
5. Shows you the release name and Console URL

**When to use:** Before pushing to GitHub to verify everything works

### Option 2: Test Build Only

Test just the Docker image build without creating a release:

```bash
npm run build:cloud
```

**What this does:**
1. Builds Docker image remotely using Cloud Build
2. Pushes to Artifact Registry with SHA and `latest` tags
3. Stops before creating Cloud Deploy release

**When to use:** Testing Dockerfile changes or build configuration

### Option 3: Dry-Run Testing

Validate configuration without actually running builds:

```bash
# Check IAM permissions and pipeline configuration
npm run preflight

# Check Slack configuration only
npm run preflight:slack
```

### Option 4: Local Docker Build

Test Dockerfile changes locally without using Cloud Build:

```bash
# Build locally
npm run build

# This runs: docker compose up -d --build

# Check health
npm run health

# View logs
npm run logs
```

**When to use:** Quick iteration on Dockerfile or application code changes

## Testing cloudbuild.yaml Changes

To test changes to [cloudbuild.yaml](../cloudbuild.yaml) before pushing:

### Method 1: Manual Cloud Build Submit

```bash
# Submit build using your local cloudbuild.yaml
gcloud builds submit \
  --config=cloudbuild.yaml \
  --region=us-central1 \
  --project=staging-383416
```

**Note:** This requires the Cloud Build service account to have `storage.objects.create` permission on the build bucket.

### Method 2: Validate YAML Syntax

```bash
# Check YAML syntax
npm install -g js-yaml
cat cloudbuild.yaml | js-yaml

# Or use yq
brew install yq
yq eval cloudbuild.yaml
```

### Method 3: Use Cloud Build Local Builder (Limited)

```bash
# Install cloud-build-local
gcloud components install cloud-build-local

# Run locally (limited support, doesn't work with all builders)
cloud-build-local --config=cloudbuild.yaml --dryrun=true .
```

## Verifying Permissions Before Deploy

Check all required permissions are configured:

```bash
npm run preflight
```

This verifies:
- ✅ Cloud Build service account has `clouddeploy.releaser` role
- ✅ Cloud Build service account has `run.admin` role
- ✅ Cloud Deploy pipeline exists
- ✅ Slack tokens are valid (optional with `--slack`)

## Common Test Scenarios

### Scenario 1: Testing New Dockerfile Changes

```bash
# 1. Build and test locally first
npm run build
npm run health

# 2. If local works, test remote build
npm run build:cloud

# 3. If remote build works, test full deploy
npm run deploy:cloud

# 4. If everything works, push to GitHub
git push origin main
```

### Scenario 2: Testing cloudbuild.yaml Changes

```bash
# 1. Validate YAML syntax
cat cloudbuild.yaml | js-yaml

# 2. Submit test build
gcloud builds submit --config=cloudbuild.yaml --region=us-central1

# 3. Check build logs
gcloud builds log $(gcloud builds list --limit=1 --format='value(id)')

# 4. If successful, push to GitHub
git push origin main
```

### Scenario 3: Testing Cloud Deploy Configuration

```bash
# 1. Check pipeline exists
npm run deploy:list

# 2. Test creating a release manually
npm run deploy:cloud

# 3. Monitor in Console
# https://console.cloud.google.com/deploy/delivery-pipelines/us-central1/oncall-cat-pipeline?project=staging-383416

# 4. If successful, push to GitHub for automated deploy
git push origin main
```

## Monitoring Test Builds

### Check Build Status

```bash
# List recent builds
gcloud builds list --limit=5

# View specific build logs
gcloud builds log <BUILD_ID>

# Stream logs from ongoing build
gcloud builds log <BUILD_ID> --stream
```

### Check Deploy Status

```bash
# List releases
npm run deploy:list

# Check deployment status
npm run deploy:status

# View in Console
open "https://console.cloud.google.com/deploy/delivery-pipelines/us-central1/oncall-cat-pipeline?project=staging-383416"
```

### Check Deployed Service

```bash
# Get service URL
SERVICE_URL=$(gcloud run services describe oncall-cat --region=us-central1 --format='value(status.url)')

# Test health endpoint
curl $SERVICE_URL/health

# Or use npm script
npm run health
```

## Troubleshooting Test Builds

### Build Fails Locally But Works in Cloud Build

**Cause:** Different environments, missing dependencies, or platform differences

**Solution:**
```bash
# Use multi-platform build
docker buildx build --platform linux/amd64 -t test .

# Or test in Cloud Build directly
npm run build:cloud
```

### Cloud Build Succeeds But Release Creation Fails

**Possible causes:**
1. Missing Cloud Deploy permissions
2. Invalid skaffold.yaml
3. Missing storage bucket permissions

**Debug:**
```bash
# Check permissions
npm run preflight

# Check pipeline exists
gcloud deploy delivery-pipelines describe oncall-cat-pipeline \
  --region=us-central1

# Check bucket permissions
gsutil iam get gs://us-central1.deploy-artifacts.staging-383416.appspot.com/
```

### Release Created But Rollout Fails

**Check Cloud Deploy logs:**
```bash
# List rollouts
gcloud deploy rollouts list \
  --delivery-pipeline=oncall-cat-pipeline \
  --region=us-central1 \
  --release=<RELEASE_NAME>

# Describe specific rollout
gcloud deploy rollouts describe <ROLLOUT_NAME> \
  --delivery-pipeline=oncall-cat-pipeline \
  --region=us-central1 \
  --release=<RELEASE_NAME>
```

## Best Practices

### 1. Always Test Locally First

```bash
npm run build && npm run health
```

### 2. Use Preflight Checks

```bash
npm run preflight
```

### 3. Test in Isolation

- Test Dockerfile changes with local Docker first
- Test Cloud Build with `npm run build:cloud`
- Test full deploy with `npm run deploy:cloud`
- Only push to GitHub when all tests pass

### 4. Use Semantic Commits

```bash
# Test locally
npm run deploy:cloud

# If successful, commit with clear message
git add .
git commit -m "feat(deploy): improve build performance by 30%"
git push origin main
```

### 5. Monitor After Push

```bash
# After pushing, watch the build
gcloud builds list --limit=1 --ongoing

# Stream logs
BUILD_ID=$(gcloud builds list --limit=1 --format='value(id)')
gcloud builds log $BUILD_ID --stream
```

## CI/CD Testing Checklist

Before pushing to GitHub, verify:

- [ ] Local build succeeds: `npm run build`
- [ ] Local tests pass: `npm test`
- [ ] Linting passes: `npm run lint`
- [ ] Cloud build succeeds: `npm run build:cloud`
- [ ] Preflight checks pass: `npm run preflight`
- [ ] Full deploy succeeds: `npm run deploy:cloud`
- [ ] Health check passes: `npm run health`
- [ ] cloudbuild.yaml syntax is valid

## Quick Reference

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `npm run build` | Local Docker build | Quick iteration on code changes |
| `npm run build:cloud` | Remote build only | Test Dockerfile or build config |
| `npm run deploy:cloud` | Full build + deploy | Test complete workflow before push |
| `npm run preflight` | Check permissions | Before any deployment |
| `npm run health` | Check service health | After deployment |
| `npm run logs` | View service logs | Debugging deployed service |
| `gcloud builds submit` | Manual Cloud Build | Test cloudbuild.yaml changes |

---

**Last Updated:** November 21, 2025
