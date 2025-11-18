# Setup Script Flags Reference

The `setup-and-deploy.sh` script supports selective execution of specific steps using command-line flags.

## Overview

By default, running `./scripts/setup-and-deploy.sh` executes the full wizard (all 8 steps). Use flags to run only specific steps.

> **Heads-up:** This legacy Bash wrapper is in the process of being replaced by a new JavaScript-based deployment utility. Keep using these flags for now, but note that we need to circle back and refresh this document once the JS script fully takes over.

## Available Flags

| Flag | Step | Description |
|------|------|-------------|
| `--gcp-project` | 1 | Configure GCP Project ID and region |
| `--deployment-mode` | 2 | Choose single-channel or multi-channel mode |
| `--gcp-setup` | 3 | Enable GCP APIs, create Artifact Registry |
| `--required-secrets` | 4 | Configure Slack and Notion tokens |
| `--optional-secrets` | 4 | Configure optional secrets (if any) |
| `--channels-and-dbs` | 5 | Configure channel IDs and database IDs |
| `--build-image` | 6 | Build and push Docker image |
| `--deploy` | 7 | Deploy to Cloud Run |
| `--verify` | 8 | Check service health |
| `--help` | - | Show help message |

## Common Use Cases

### Full Deployment (First Time)

```shell
./scripts/setup-and-deploy.sh
```

Runs all 8 steps interactively.

### Update Secrets Only

```shell
./scripts/setup-and-deploy.sh --required-secrets
```

Perfect for rotating credentials without redeploying.

### Update Channel Mappings and Redeploy

```shell
./scripts/setup-and-deploy.sh --channels-and-dbs --deploy
```

Use after modifying `channel-mappings.json`.

### Rebuild and Redeploy

```shell
./scripts/setup-and-deploy.sh --build-image --deploy
```

Rebuilds Docker image after code changes and deploys.

### Quick Health Check

```shell
./scripts/setup-and-deploy.sh --verify
```

Runs health check only.

### Multiple Steps

```shell
./scripts/setup-and-deploy.sh --build-image --deploy --verify
```

Combine multiple flags to run specific sequences.

## Important Notes

### Environment Variables

When running partial steps, the script loads configuration from:
- GCP project from: `gcloud config get-value project`
- Region defaults to: `us-central1`

If no project is configured, you'll need to run:

```shell
./scripts/setup-and-deploy.sh --gcp-project
```

### Step Dependencies

Some steps depend on previous setup:

- **--deploy** requires:
  - Docker image built (Step 6)
  - Secrets configured (Step 4)
  - GCP setup completed (Step 3)

- **--build-image** requires:
  - Artifact Registry created (Step 3)

- **--channels-and-dbs** requires:
  - Deployment mode chosen (Step 2)

### Re-running Steps

All steps are designed to be re-run safely:

- **Secrets**: Asks if you want to update existing secrets
- **Channel mappings**: Shows preview, asks to update Secret Manager
- **Build**: Rebuilds and creates new image version
- **Deploy**: Updates Cloud Run service with new configuration

## Troubleshooting

### "No GCP project configured"

```shell
./scripts/setup-and-deploy.sh --gcp-project
```

### "Secret already exists"

The script detects existing secrets and asks if you want to update them. Choose:
- `y` = Update with new value
- `n` = Skip this secret
- `s` = Skip all remaining secrets

### "channel-mappings.json not found"

Multi-channel mode requires this file. The script will create it from the example template.

## Examples by Scenario

### Scenario: New Deployment

```shell
# Run full wizard
./scripts/setup-and-deploy.sh
```

### Scenario: Code Changed

```shell
# Rebuild and redeploy
./scripts/setup-and-deploy.sh --build-image --deploy
```

### Scenario: Token Expired

```shell
# Update secrets only
./scripts/setup-and-deploy.sh --required-secrets
```

### Scenario: Added New Channel

```shell
# Update mappings and redeploy
./scripts/setup-and-deploy.sh --channels-and-dbs --deploy
```

### Scenario: Service Down

```shell
# Check health
./scripts/setup-and-deploy.sh --verify

# Or use direct script
npm run health
```

### Scenario: Changed Configuration

```shell
# Deploy with new env vars
./scripts/setup-and-deploy.sh --deploy
```

## Advanced Usage

### Combining with Other Scripts

You can also use individual scripts directly:

```shell
# View logs
npm run logs -- --follow

# Check health
./scripts/check-health.sh

# Deploy only
./scripts/deploy-gcp.sh
```

### Environment Variable Override

```shell
# Override region
REGION=us-west1 ./scripts/setup-and-deploy.sh --deploy

# Override project
PROJECT_ID=my-project ./scripts/setup-and-deploy.sh --build-image
```

## See Also

- [GCP Deployment Guide](./GCP_DEPLOYMENT.md) - Complete deployment documentation
- [Setup Flow Diagram](./SETUP_FLOW.md) - Visual wizard flow
- [Quick Reference](./GCP_QUICK_REFERENCE.md) - Command cheat sheet
