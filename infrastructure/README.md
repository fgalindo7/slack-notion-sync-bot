# Infrastructure SDK

Purpose: Concise reference for provisioning and deploying infrastructure via Node.js GCP SDK code. Operational run-books, monitoring dashboards, rollbacks, security best practices, cost analysis, and advanced delivery patterns are intentionally excluded here (see `../GCP_DEPLOYMENT.md` and `../docs/HEALTH_CHECKS.md`).

## Components

| File | Purpose |
|------|---------|
| `setup-infrastructure.mjs` | Enable APIs, create Artifact Registry, manage secrets, apply IAM (least-privilege), optional prune of runtime SA excess roles. |
| `deploy-automation.mjs` | Initialize Cloud Deploy pipeline, create releases, promote targets. |
| `../clouddeploy.yaml` | Pipeline & targets (staging, production). |
| `../skaffold.yaml` | Build + deploy definitions. |
| `../service.yaml` | Cloud Run service spec (resources, env, secrets, health). |

## Prerequisites

```shell
gcloud auth login
gcloud config set project <PROJECT_ID>
```

Context resolution precedence used by all infra/ops scripts:

- Flags > gcloud config > environment

Examples:

```shell
# Explicit flags (recommended for CI or multiple projects)
node infrastructure/setup-infrastructure.mjs --project <PROJECT_ID> --region us-central1

# Or rely on gcloud config (no flags needed)
gcloud config set project <PROJECT_ID>
node infrastructure/setup-infrastructure.mjs --region us-central1

# Env vars are last resort and optional
export GCP_PROJECT_ID=<PROJECT_ID>
export REGION=us-central1
node infrastructure/setup-infrastructure.mjs
```

Optional custom Cloud Build service account:

```shell
export CLOUD_BUILD_SA_EMAIL=cloud-build-slack-notion-sync@${GCP_PROJECT_ID}.iam.gserviceaccount.com
```

## One-Time Setup

```shell
# Interactive (recommended locally; will prompt for secrets)
node infrastructure/setup-infrastructure.mjs --project <PROJECT_ID> --region us-central1

# Non-interactive / automation
echo 'y' | node infrastructure/setup-infrastructure.mjs --project <PROJECT_ID> --region us-central1

# Dry run (preview actions; no changes made)
DRY_RUN=1 node infrastructure/setup-infrastructure.mjs --project <PROJECT_ID> --region us-central1
```

What this does (minimal set):
- Enables required APIs: Run, Artifact Registry, Secret Manager, Cloud Build, Cloud Deploy, IAM (Vertex AI only if used)
- Creates Artifact Registry repo (Docker)
- Ensures required secrets exist (`slack-bot-token`, `slack-app-token`, `notion-token`, optional `channel-mappings`)
- Applies IAM:
  - Cloud Build SA: `run.admin`, `iam.serviceAccountUser`, `clouddeploy.releaser`, `clouddeploy.viewer`, `artifactregistry.writer`
  - Runtime SA: `secretmanager.secretAccessor`, `artifactregistry.reader` (+ `aiplatform.user` if needed)
  - Cloud Deploy service agent ActAs on runtime SA (`iam.serviceAccountUser`)
- (Optional) Prunes excess runtime roles (see below)

## Least-Privilege Runtime Pruning

To remove previously granted elevated roles from the runtime service account (safe list approach):

```shell
export PRUNE_RUNTIME_ROLES=1   # removes run.admin, artifactregistry.writer, secretmanager.admin, clouddeploy.releaser, storage.admin if present
echo 'y' | node infrastructure/setup-infrastructure.mjs
```

The script only removes the known unnecessary elevated roles; it does not touch unrelated bindings (e.g., monitoring, logging). Set `PRUNE_RUNTIME_ROLES=1` consciously—avoid on shared projects where other services may rely on those roles.

## Deployment Pipeline Initialization

```shell
npm run deploy:init   # Applies clouddeploy.yaml targets & pipeline
```

## Creating a Release

```shell
npm run deploy        # Builds image → creates release → deploys to staging
```

Promote to production (if not auto-approved):

```shell
gcloud deploy releases promote \
  --delivery-pipeline=oncall-cat-pipeline \
  --region=${REGION} \
  --release=<RELEASE_NAME>
```

## Preflight IAM & Pipeline Check

Use the ops CLI preflight before deploying (ensures required roles & pipeline access):

```shell
npm run preflight
```

Validates:
- Cloud Build SA has required roles
- Runtime SA restricted to minimal roles
- Cloud Deploy service agent ActAs binding present
- Pipeline readable

Exits non-zero if any check fails.

## Required Secrets

| Secret | Description |
|--------|-------------|
| `slack-bot-token` | Slack bot OAuth token (xoxb-) |
| `slack-app-token` | Slack app-level token (xapp-) |
| `notion-token` | Notion integration token |
| `channel-mappings` (opt) | Multi-channel config JSON |

Add/update secret value:

```shell
echo -n "value" | gcloud secrets versions add slack-bot-token --data-file=-
```

## Environment Variables (Cloud Run)

| Variable | Purpose |
|----------|---------|
| `PORT` | Must remain `1987` per project standard |
| `LOG_LEVEL` | Logging verbosity (info or debug) |
| `CHANNEL_DB_MAPPINGS` | `true` enables multi-channel mode |
| `CHANNEL_DB_MAPPINGS_FILE` | Override path for mappings JSON |
| `CHANNEL_MAPPINGS_JSON` | Inline JSON for mappings (alternative) |
| `ALLOW_THREADS` | Allow processing thread replies |

## Updating Channel Mappings

```shell
gcloud secrets versions add channel-mappings --data-file=channel-mappings.json
gcloud run services update oncall-cat --region=${REGION} --update-labels=refresh=$(date +%s)
```

## Minimal IAM Expectations

Cloud Build SA (deploy actions only):

```
run.admin
iam.serviceAccountUser
clouddeploy.releaser
clouddeploy.viewer
artifactregistry.writer
```

Runtime SA (execution only):

```
secretmanager.secretAccessor
artifactregistry.reader
aiplatform.user (only if ML features used)
```

Cloud Deploy service agent ActAs: `iam.serviceAccountUser` on runtime SA.

## Verification Commands

```shell
PROJECT_NUMBER=$(gcloud projects describe $GCP_PROJECT_ID --format='value(projectNumber)')
CB_SA=${CLOUD_BUILD_SA_EMAIL:-${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com}
RUNTIME_SA=${PROJECT_NUMBER}-compute@developer.gserviceaccount.com

# Cloud Build roles
gcloud projects get-iam-policy $GCP_PROJECT_ID --format=json | \
  jq --arg sa "serviceAccount:${CB_SA}" '.bindings[] | select(.members[]?==$sa) | .role'

# Runtime minimal roles
gcloud projects get-iam-policy $GCP_PROJECT_ID --format=json | \
  jq --arg sa "serviceAccount:${RUNTIME_SA}" '.bindings[] | select(.members[]?==$sa) | .role'

# ActAs binding
gcloud iam service-accounts get-iam-policy ${RUNTIME_SA} --format=json | \
  jq '.bindings[] | select(.role=="roles/iam.serviceAccountUser")'
```

## Safe Re-run

It is safe to re-run `setup-infrastructure.mjs`; idempotent operations (enable APIs, existing secrets, existing repo) are skipped; IAM bindings are merged; pruning only runs when explicitly requested.

## Related Docs

- Deployment & ops: `../GCP_DEPLOYMENT.md`
- Health & monitoring: `../docs/HEALTH_CHECKS.md`
- Getting started: `../GETTING_STARTED.md`

---

<p align="center"><sub>Infrastructure SDK Reference • Updated: 2025-11-18</sub></p>
