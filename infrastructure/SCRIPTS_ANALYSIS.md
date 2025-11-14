# Shell Scripts Analysis - Redundancy Assessment

## Current Shell Scripts

### ❌ Redundant Scripts (Can be removed)

#### 1. `scripts/setup-gcp.sh` (104 lines)

**Purpose:** Enable GCP APIs and create Artifact Registry repository

**Replaced by:** `infrastructure/setup-infrastructure.mjs`

**Why redundant:**
- `npm run infra:setup` now handles:
  - Enabling GCP APIs programmatically via GCP SDK
  - Creating Artifact Registry repository
  - More robust error handling
  - Interactive prompts
  - Better logging

**Migration:**

```shell
# Old
./scripts/setup-gcp.sh

# New
npm run infra:setup
```

---

#### 2. `scripts/create-secrets.sh` (183 lines)

**Purpose:** Create and update secrets in Secret Manager

**Replaced by:** `infrastructure/setup-infrastructure.mjs` (secrets section)

**Why redundant:**
- `npm run infra:setup` includes interactive secret creation
- Uses Secret Manager SDK instead of gcloud CLI
- Validates secret formats
- Handles both required and optional secrets

**Migration:**

```shell
# Old
./scripts/create-secrets.sh

# New
npm run infra:setup  # Includes secret management
```

---

#### 3. `scripts/deploy-gcp.sh` (145 lines)

**Purpose:** Deploy service to Cloud Run

**Replaced by:** Automated CI/CD via Cloud Build + Cloud Deploy

**Why redundant:**
- Manual deployments replaced by `git push origin main`
- Cloud Deploy handles staging → production flow
- Better version tracking and rollback capabilities
- Service configuration now in `service.yaml` (declarative)

**Migration:**

```shell
# Old (manual deployment)
./scripts/deploy-gcp.sh

# New (automated)
git push origin main  # Automatic deployment

# Or manual release if needed
npm run deploy
```

---

#### 4. `scripts/setup-and-deploy.sh` (485 lines)

**Purpose:** 8-step interactive wizard for full setup and deployment

**Replaced by:** Combination of `npm run infra:setup` + `npm run deploy:init`

**Why redundant:**
- Infrastructure setup: `npm run infra:setup`
- Pipeline setup: `npm run deploy:init`
- Deployment: automatic via git push
- More maintainable (JavaScript vs 500 lines of bash)

**Migration:**

```shell
# Old (monolithic wizard)
./scripts/setup-and-deploy.sh

# New (modular)
npm run infra:setup    # One-time infrastructure
npm run deploy:init    # One-time pipeline setup
git push origin main   # Deploy
```

---

### ✅ Keep These Scripts (Still Useful)

#### 1. `scripts/check-health.sh`

**Purpose:** Health check and version verification

**Why keep:**
- Quick health status check without installing dependencies
- Already enhanced with version comparison
- Useful for debugging and monitoring
- Shell script is simpler for this use case
- Can be run from any environment

**Usage:**

```shell
./scripts/check-health.sh
```

**Status:** Keep and maintain ✅

---

#### 2. `scripts/view-logs.sh`

**Purpose:** View Cloud Run logs with streaming

**Why keep:**
- Quick log viewing without GCP console
- Useful for debugging
- Simple wrapper around gcloud logs
- No need to rewrite in JavaScript

**Usage:**

```shell
./scripts/view-logs.sh
```

**Status:** Keep and maintain ✅

---

## Recommended Actions

### Option 1: Remove Redundant Scripts (Recommended)

**Delete these files:**

```shell
rm scripts/setup-gcp.sh
rm scripts/create-secrets.sh
rm scripts/deploy-gcp.sh
rm scripts/setup-and-deploy.sh
```

**Keep these files:**

```shell
# Keep - still useful
scripts/check-health.sh
scripts/view-logs.sh
```

**Benefits:**
- ✅ Reduced maintenance burden (485 + 145 + 183 + 104 = 917 lines of bash removed)
- ✅ Single source of truth (infrastructure/ directory)
- ✅ More testable code (JavaScript vs bash)
- ✅ Better error handling and logging

**Risks:**
- ⚠️ Users who haven't migrated to new workflow may be disrupted
- ⚠️ Documentation must be updated

---

### Option 2: Deprecate Scripts (Conservative)

**Keep files but mark as deprecated:**
- Add deprecation warnings at the top of each script
- Update documentation to point to new workflow
- Remove in a future release (e.g., 2.0.0)

**Example deprecation notice:**

```bash
#!/bin/bash
echo "⚠️  WARNING: This script is deprecated!"
echo "⚠️  Please use: npm run infra:setup"
echo "⚠️  See: infrastructure/README.md"
echo ""
read -p "Continue anyway? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi
```

**Benefits:**
- ✅ Gradual migration for existing users
- ✅ Clear communication about deprecation

**Drawbacks:**
- ❌ More files to maintain (temporarily)
- ❌ Confusion about which method to use

---

### Option 3: Keep Both (Not Recommended)

**Rationale:** Some users may prefer shell scripts

**Issues:**
- ❌ Duplicate functionality = double maintenance
- ❌ Inconsistent behavior between two methods
- ❌ Confusion for new users
- ❌ Documentation overhead

---

## Migration Path for Users

### Current Workflow (Shell Scripts)

```shell
# Step 1-3: Infrastructure setup
./scripts/setup-and-deploy.sh --gcp-setup

# Step 4: Secrets
./scripts/setup-and-deploy.sh --required-secrets

# Step 5: Channel mappings
./scripts/setup-and-deploy.sh --channels-and-dbs

# Step 6-7: Build and deploy
./scripts/setup-and-deploy.sh --build-image --deploy
```

### New Workflow (Infrastructure as Code)

```shell
# One-time setup (replaces steps 1-5)
npm install
npm run infra:setup       # Interactive prompts for secrets
npm run deploy:init       # Initialize pipeline

# Continuous deployment (replaces steps 6-7)
git push origin main      # Automatic!
```

---

## Updated Scripts Directory Structure

### After Cleanup

```
scripts/
├── check-health.sh       # ✅ Keep - health monitoring
└── view-logs.sh          # ✅ Keep - log viewing

infrastructure/
├── setup-infrastructure.mjs  # ✅ NEW - infrastructure setup
├── deploy-automation.mjs     # ✅ NEW - deployment management
├── README.md                 # ✅ NEW - comprehensive guide
├── QUICKSTART.md             # ✅ NEW - quick reference
└── IMPLEMENTATION_SUMMARY.md # ✅ NEW - technical details
```

**Total lines removed:** 917 lines of bash  
**Total lines added:** ~500 lines of JavaScript + YAML configs + docs

**Net benefit:** More maintainable, testable, and automated

---

## Documentation Updates Needed

If we remove the redundant scripts, update these files:

### 1. `README.md`

- [x] Already updated with automated deployment section
- [x] Links to infrastructure/README.md

### 2. `docs/GCP_DEPLOYMENT.md`

- [ ] Update to reference new workflow
- [ ] Remove references to old scripts
- [ ] Add migration guide

### 3. `docs/GCP_QUICK_REFERENCE.md`

- [ ] Update command reference
- [ ] Remove old script commands
- [ ] Add npm script commands

### 4. `docs/SCRIPT_FLAGS.md`

- [ ] Remove or deprecate
- [ ] Or update to document npm scripts instead

### 5. `AGENTS.md`

- [ ] Update deployment automation section
- [ ] Reference new infrastructure/ directory

---

## Recommendation

**I recommend Option 1: Remove Redundant Scripts**

**Reasoning:**
1. **Cleaner codebase** - 917 lines of bash removed
2. **Single source of truth** - No confusion about which method to use
3. **Better maintainability** - JavaScript is more testable than bash
4. **Modern approach** - Infrastructure as Code is industry standard
5. **Already documented** - Migration path is clear in new docs

**Implementation:**

```shell
# 1. Remove redundant scripts
git rm scripts/setup-gcp.sh
git rm scripts/create-secrets.sh
git rm scripts/deploy-gcp.sh
git rm scripts/setup-and-deploy.sh

# 2. Keep useful scripts
# (no action needed - already keeping check-health.sh and view-logs.sh)

# 3. Commit
git commit -m "Remove redundant shell scripts, replaced by infrastructure automation

Removed scripts (917 lines):
- setup-gcp.sh → replaced by npm run infra:setup
- create-secrets.sh → replaced by npm run infra:setup (secrets section)
- deploy-gcp.sh → replaced by automated Cloud Deploy pipeline
- setup-and-deploy.sh → replaced by infra:setup + deploy:init

Kept scripts:
- check-health.sh (still useful for quick health checks)
- view-logs.sh (still useful for log viewing)

New automation:
- infrastructure/setup-infrastructure.mjs (infrastructure provisioning)
- infrastructure/deploy-automation.mjs (deployment management)
- Automated CI/CD via Cloud Build + Cloud Deploy

Migration guide: infrastructure/README.md"
```

**Should I proceed with removing the redundant scripts?**

---

## Summary

| Script | Lines | Status | Reason |
|--------|-------|--------|--------|
| `setup-gcp.sh` | 104 | ❌ Remove | Replaced by `npm run infra:setup` |
| `create-secrets.sh` | 183 | ❌ Remove | Replaced by `npm run infra:setup` |
| `deploy-gcp.sh` | 145 | ❌ Remove | Replaced by automated CI/CD |
| `setup-and-deploy.sh` | 485 | ❌ Remove | Replaced by modular npm scripts |
| `check-health.sh` | ~50 | ✅ Keep | Still useful for monitoring |
| `view-logs.sh` | ~30 | ✅ Keep | Still useful for debugging |

**Total removed:** 917 lines of bash  
**Result:** Cleaner, more maintainable codebase with automated infrastructure
