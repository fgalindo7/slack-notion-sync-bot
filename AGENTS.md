# AI Agent Guidelines

**Purpose:** Technical standards, patterns, and gotchas for AI assistants working in this repository.

**Note:** If you discover patterns or mistakes that would help future AI assistants, update the "Common Mistakes" section.

---

## Quick Reference

### Critical Project Context

- **Language:** JavaScript ES Modules (`.js`, `.mjs`) - Node.js 20+
- **Architecture:** Modular functional/OO hybrid
  - Pure functions in `lib/parser.js`, `lib/validation.js`
  - Classes for state: `BotMetrics`, `NotionSchemaCache`
  - Configuration centralized in `lib/config.js`
  - Constants in `lib/constants.js`

### Testing Standards (ENFORCED)

```shell
npm test                      # Must pass (95 tests)
npm run test:coverage:check   # Must meet thresholds:
                             # - 75% line coverage
                             # - 60% function coverage  
                             # - 60% branch coverage
npm run lint                  # Must pass (all .js/.mjs files)
```

**Rule:** Always run tests after code changes. Coverage is enforced.

### Code Fence Standards

- **Shell commands:** Use ````shell` (not ````bash`)
- **JavaScript:** Use ````javascript` or ````js`
- **JSON:** Use ````json`
- **Markdown:** Use ` ```markdown` or ` ```md`

### Port Configuration (CRITICAL)

- **All services use port 1987** (main app + health check)
- **Never use port 3000** - that was the old default
- When updating ports, check: `lib/config.js`, `docker-compose.yml`, `README.md`, `docs/GCP_QUICK_REFERENCE.md`

### Commit Standards

```shell
# Good - Atomic, descriptive
git commit -m "Add ASAP date parsing to parseNeededByString"
git commit -m "Create 17 tests for parseAutoBlock function"

# Bad - Vague, bundled
git commit -m "Fixed stuff and updated docs"
```

### File Structure Rules

```
lib/
├── parser.js          # Core parsing logic - CRITICAL, well-tested
├── parser.test.js     # 53 tests (normalizeEmail, stripRichTextFormatting, parseNeededByString, parseAutoBlock)
├── validation.js      # Field validation
├── validation.test.js # 27 tests (missingFields, typeIssues)
├── ai-suggestions.js  # AI similarity detection (Vertex AI)
├── ai-suggestions.test.js # 15 tests (NotionKnowledgeBase, AISuggestionEngine)
├── constants.js       # All magic values, regexes, defaults
├── config.js          # Configuration loading, channel mappings
├── metrics.js         # BotMetrics class
└── schema-cache.js    # NotionSchemaCache class

app.js                 # Main entry point - Socket Mode, Notion integration
```

### Deployment Automation

```shell
# Interactive wizard (8 steps)
./scripts/setup-and-deploy.sh

# Selective deployment
./scripts/setup-and-deploy.sh --required-secrets
./scripts/setup-and-deploy.sh --build-image --deploy

# Health checks
./scripts/check-health.sh
./scripts/view-logs.sh
```

---

## Test Coverage

**Tool:** c8 (Native V8 code coverage)

**Commands:**

```shell
# Run tests with coverage
npm run test:coverage

# Enforce coverage thresholds (75% lines, 60% functions, 60% branches)
npm run test:coverage:check
```

**Test Organization:**

```
lib/
├── parser.test.js (53 tests)
│   ├── normalizeEmail (12 tests)
│   ├── stripRichTextFormatting (7 tests)
│   ├── parseNeededByString (17 tests)
│   └── parseAutoBlock (17 tests) ← Critical business logic
│
├── validation.test.js (27 tests)
│   ├── missingFields (15 tests)
│   └── typeIssues (12 tests)
│
└── ai-suggestions.test.js (15 tests)
    ├── NotionKnowledgeBase (5 tests)
    ├── AISuggestionEngine (6 tests)
    ├── Integration scenarios (3 tests)
    └── Error handling (1 test)
```

---

## Linting

**Scope:** All JavaScript and ES Module files (`**/*.{js,mjs}`)

```shell
npm run lint       # Check all files
npm run lint:fix   # Auto-fix issues
```

---

## AI-Powered Similar Case Suggestions

### Implementation Architecture

```
User reports issue → Bot creates Notion page
    ↓
[AI Feature - Non-blocking]
    ↓
NotionKnowledgeBase queries historical cases (90 days, cached 5min)
    ↓
AISuggestionEngine calls Vertex AI (Gemini Pro)
    ↓
Similarity analysis with structured JSON output
    ↓
Top 2-3 matches (≥70% similar) posted to Slack thread
```

### Key Design Principles

**1. Non-Blocking Architecture**
- AI suggestions run asynchronously after Notion page creation
- Failures never affect core bot functionality
- Fire-and-forget pattern with comprehensive error logging

**2. Graceful Degradation**
- Feature flag: `AI_SUGGESTIONS_ENABLED=true/false`
- Lazy initialization - engines created only when needed
- Silent failure - users unaffected by AI errors

**3. Smart Resource Management**
- Caching: 5-minute TTL reduces redundant queries
- Query filtering: Only resolved cases from last 90 days
- Similarity threshold: Default 0.7 (configurable)
- Match limiting: Top 3 results only

### Module Structure

```javascript
// lib/ai-suggestions.js (438 lines)
export class NotionKnowledgeBase {
  // Queries and formats historical cases
  // Smart caching with TTL
}

export class AISuggestionEngine {
  // Vertex AI integration
  // Prompt engineering
  // JSON response parsing
}

// app.js integration functions
async function handleAISuggestions()     // Orchestration
async function replyWithSuggestions()    // Slack formatting
function getAIEngine()                   // Lazy initialization
```

### Environment Variables

```shell
# Required
AI_SUGGESTIONS_ENABLED=true
GCP_PROJECT_ID=your-project-id

# Optional (with sensible defaults)
VERTEX_AI_LOCATION=us-central1
VERTEX_AI_MODEL=gemini-pro
AI_MAX_HISTORICAL_CASES=20
AI_SIMILARITY_THRESHOLD=0.7
AI_QUERY_DAYS_BACK=90
AI_CACHE_TTL=300000  # 5 minutes
```

### GCP Setup

```shell
# Enable Vertex AI API
gcloud services enable aiplatform.googleapis.com

# Grant IAM permissions (Cloud Run)
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/aiplatform.user"

# Local development
gcloud auth application-default login
```

### Metrics Tracking

```javascript
// Added to BotMetrics class
aiSuggestionsRequested: 0,   // Total requests
aiSuggestionsReturned: 0,    // Successful matches
aiSuggestionsEmpty: 0,       // No matches found
aiSuggestionsFailed: 0,      // Processing errors
```

Available in `/metrics` endpoint for monitoring.

### Testing

```shell
npm run test:ai  # 15 tests for AI module
```

### Key Files

- `lib/ai-suggestions.js` - Core AI logic (438 lines)
- `lib/ai-suggestions.test.js` - Test suite (524 lines)
- `lib/config.js` - Configuration with vertexAI section
- `lib/metrics.js` - AI metrics tracking
- `app.js` - Integration and helper functions

### Important Patterns

- Always use feature flag checks before AI operations
- Never throw errors that would stop core functionality
- Log all AI operations for observability
- Use lazy initialization for AI engines
- Enrich responses with Notion URLs before sending to Slack

### Common Tasks

- Updating similarity threshold: Change `AI_SIMILARITY_THRESHOLD`
- Changing query window: Modify `AI_QUERY_DAYS_BACK`
- Adjusting cache: Update `AI_CACHE_TTL`
- Switching models: Set `VERTEX_AI_MODEL` (e.g., "gemini-1.5-pro")

---

## Common Mistakes to Avoid

### ❌ Don't Do This

**Using wrong ports:**

```javascript
// WRONG - Port 3000 is old default
const server = http.createServer(app).listen(3000);
```

```javascript
// CORRECT - Always use 1987
const server = http.createServer(app).listen(1987);
```

**Creating files in wrong locations:**

```shell
# WRONG - Tests go in lib/ next to source
./tests/parser.test.js

# CORRECT - Co-locate tests with source
./lib/parser.test.js
```

**Skipping test validation:**

```shell
# WRONG - Committing without testing
git commit -m "Add new feature"

# CORRECT - Always test first
npm test && npm run test:coverage:check && git commit -m "Add feature"
```

**Vague commits:**

```shell
# WRONG
git commit -m "Updates"
git commit -m "Fixed bugs"

# CORRECT
git commit -m "Fix email normalization for addresses with + symbols"
git commit -m "Add 12 tests for stripRichTextFormatting function"
```

**Adding coverage files to git:**

```shell
# WRONG - These are gitignored
git add coverage/

# CORRECT - Already in .gitignore
# coverage/, .nyc_output/, .c8/ are excluded
```

**Using ```bash instead of ```shell:**

```markdown
```bash
# WRONG - Don't use bash
npm test
```

# CORRECT - Always use shell
```shell
npm test
```
```

### ✅ Do This

**Check project structure first:**

```shell
# Before making changes, understand layout
ls -la lib/
cat package.json
```

**Run tests after ANY code change:**

```shell
npm test                     # Run all tests
npm run test:coverage:check  # Verify coverage thresholds
npm run lint                 # Check code style
```

**Update related documentation:**
- If you change port → Update README.md, docker-compose.yml, config.js, GCP docs
- If you add test command → Update README Development section
- If you modify deployment → Update docs/GCP_DEPLOYMENT.md

**Use existing patterns:**
- Parser functions are pure functions (no side effects)
- Classes use private fields (#field) for encapsulation
- All exports use ES modules (export/import, not require)
- Constants go in `lib/constants.js`, not inline magic values

---

<p align="center">
  <sub>Last updated: November 11, 2025</sub>
</p>
