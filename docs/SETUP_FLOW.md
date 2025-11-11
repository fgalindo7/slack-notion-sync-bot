# Setup and Deploy Script Flow

Complete workflow for `./scripts/setup-and-deploy.sh` with multi-channel support.

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Configure GCP Project                             │
│  - Set PROJECT_ID and REGION                               │
│  - Confirm project selection                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Choose Deployment Mode                            │
│  1) Single-channel mode                                     │
│  2) Multi-channel mode ← User selects                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 3: Initial GCP Setup                                 │
│  - Enable APIs (Run, Artifact Registry, Secrets, Build)    │
│  - Create Artifact Registry repository                      │
│  - Configure Docker authentication                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 4: Configure Secrets                                 │
│                                                             │
│  IF secrets already exist:                                 │
│    → Ask: "Do you want to review/update secrets? (y/n)"   │
│    → If yes: Run create-secrets.sh (allows individual     │
│                updates)                                     │
│    → If no: Skip to next step                             │
│                                                             │
│  IF secrets don't exist:                                   │
│    → Run create-secrets.sh (creates all secrets)          │
│                                                             │
│  create-secrets.sh prompts for:                            │
│    ✓ Slack Bot Token (xoxb-...)                          │
│    ✓ Slack App-Level Token (xapp-...)                    │
│    ✓ Notion Token (secret_ or ntn_...)                   │
│    ✓ [Optional] Slack Signing Secret                     │
│    ✓ [Optional] channel-mappings.json (if file exists)   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 5: Configure Channels and Databases                  │
│                                                             │
│  IF Multi-Channel Mode Selected:                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │ 1. Check if channel-mappings.json exists          │   │
│  │                                                     │   │
│  │ IF EXISTS:                                         │   │
│  │   → Show preview of current file                   │   │
│  │   → Ask: "Do you want to edit this file? (y/n)"   │   │
│  │   → If yes: User edits, press Enter to continue   │   │
│  │                                                     │   │
│  │ IF NOT EXISTS:                                     │   │
│  │   → Copy from channel-mappings.json.example       │   │
│  │   → Prompt user to edit with their IDs            │   │
│  │   → Wait for user (press Enter when ready)        │   │
│  │                                                     │   │
│  │ 2. Upload to Secret Manager:                      │   │
│  │   → Check if 'channel-mappings' secret exists     │   │
│  │   → If exists: Ask to update                      │   │
│  │   → If new: Create secret                         │   │
│  │   → Validate upload succeeded                     │   │
│  └────────────────────────────────────────────────────┘   │
│                                                             │
│  IF Single-Channel Mode Selected:                          │
│  ┌────────────────────────────────────────────────────┐   │
│  │ → Prompt: Enter Slack Channel ID                  │   │
│  │ → Prompt: Enter Notion Database ID                │   │
│  │ → Save as environment variables                   │   │
│  └────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 6: Build Docker Image                                │
│  - Submit build to Cloud Build                             │
│  - Push to Artifact Registry                               │
│  - Tag as :latest and :COMMIT_SHA                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 7: Deploy to Cloud Run                               │
│                                                             │
│  IF Multi-Channel:                                         │
│    → Set CHANNEL_DB_MAPPINGS=true                         │
│    → Mount /secrets/channel-mappings from Secret Manager  │
│    → Min instances: 1 (for Socket Mode)                   │
│                                                             │
│  IF Single-Channel:                                        │
│    → Set CHANNEL_DB_MAPPINGS=false                        │
│    → Set WATCH_CHANNEL_ID and NOTION_DATABASE_ID          │
│    → Min instances: 1 (for Socket Mode)                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 8: Verification                                      │
│  - Wait 5 seconds for service to start                    │
│  - Check health endpoint                                   │
│  - Display service URL and logs commands                   │
│  - Show next steps                                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
                     ✅ DEPLOYMENT COMPLETE!
```

## Multi-Channel Specific Behavior

### Channel Mappings Handling

**File Management:**
```bash
# If channel-mappings.json exists
→ Show preview (first 20 lines)
→ Ask if user wants to edit
→ Wait for confirmation

# If channel-mappings.json doesn't exist
→ Create from channel-mappings.json.example
→ Inform user to edit with actual IDs
→ Wait for confirmation
```

**Secret Manager Upload:**
```bash
# Always uploads to Secret Manager after file is ready
→ Check if 'channel-mappings' secret exists

If exists:
  → "Secret 'channel-mappings' already exists"
  → "Do you want to update it with the current file? (y/n)"
  → Update if yes, skip if no

If new:
  → Create new secret with file contents
  → Validate JSON is valid
  → Exit on failure
```

**Deployment Configuration:**
```bash
# Cloud Run receives:
CHANNEL_DB_MAPPINGS=true
CHANNEL_DB_MAPPINGS_FILE=/secrets/channel-mappings
--set-secrets="/secrets/channel-mappings=channel-mappings:latest"

# Bot reads at startup:
1. Checks CHANNEL_DB_MAPPINGS=true
2. Reads /secrets/channel-mappings
3. Parses JSON structure:
   {
     "databases": [
       {
         "databaseId": "...",
         "channels": [{"channelId": "..."}, ...]
       }
     ]
   }
4. Loads all database schemas
5. Routes messages based on channel ID
```

## Error Handling

### Channel Mappings Errors

**File not ready:**
```bash
# User hasn't edited the file
→ Script waits for user to press Enter
→ Allows time to edit externally
```

**Secret upload fails:**
```bash
# Invalid JSON or permission error
→ Show error message
→ Exit with status 1
→ User must fix and re-run
```

**Secret already exists:**
```bash
# Previous deployment exists
→ Ask user if they want to update
→ Allows keeping existing config
→ Continues with existing if no update
```

## Re-running the Script

### Second Run Behavior

**Secrets already exist:**
```bash
Step 4: Configure Secrets
✓ Required secrets already exist

Do you want to review/update secrets? (y/n)
→ n: Skip to next step (uses existing)
→ y: Opens create-secrets.sh for individual updates
```

**Channel mappings exist:**
```bash
Step 5: Configure Channels and Databases
✓ channel-mappings.json found

Current mappings preview:
------------------------
{
  "databases": [...]
}

Do you want to edit this file? (y/n)
→ n: Use existing file
→ y: Edit, then press Enter

Secret 'channel-mappings' already exists
Do you want to update it with the current file? (y/n)
→ n: Keep existing secret (uses old config!)
→ y: Update with current file
```

## Common Scenarios

### Scenario 1: Fresh Deployment (Multi-Channel)

```bash
./scripts/setup-and-deploy.sh

→ Choose mode: 2 (multi-channel)
→ Enter secrets (all new)
→ Edit channel-mappings.json
→ Upload to Secret Manager
→ Build and deploy
✅ Done
```

### Scenario 2: Update Channel Mappings

```bash
# Edit your local file
vim channel-mappings.json

# Re-run wizard
./scripts/setup-and-deploy.sh

→ Choose mode: 2 (multi-channel)
→ Secrets exist: n (skip)
→ Mappings exist: n (use current file)
→ Update secret: y (upload new version)
→ Skip build: Ctrl+C (or continue if needed)
```

### Scenario 3: Update One Secret

```bash
# Run create-secrets.sh directly
./scripts/create-secrets.sh

→ slack-bot-token exists: y (update)
→ [enter new token]
→ slack-app-token exists: n (skip)
→ notion-token exists: n (skip)
→ channel-mappings exists: s (skip all)
✅ Done
```

## Tips

- **First time**: Let the wizard guide you through everything
- **Updating secrets**: Use `./scripts/create-secrets.sh` directly
- **Updating mappings**: Edit file, then re-run wizard (skip to Step 5)
- **Testing changes**: Deploy updates, then check logs: `./scripts/view-logs.sh --follow`

## Files Involved

- `scripts/setup-and-deploy.sh` - Main wizard
- `scripts/create-secrets.sh` - Secret management (standalone)
- `channel-mappings.json` - Your configuration (gitignored)
- `channel-mappings.json.example` - Template
