# 🤖 AI Agents & Automation

**Purpose:** This document helps AI assistants (like GitHub Copilot Chat) understand how to work effectively in this repository - what tools exist, what workflows to follow, and what standards to maintain.

---

## Quick Reference for AI Assistants

### Critical Project Context

- **Language:** JavaScript ES Modules (`.js`, `.mjs`) - Node.js 20+
- **Architecture:** Modular functional/OO hybrid
  - Pure functions in `lib/parser.js`, `lib/validation.js`
  - Classes for state: `BotMetrics`, `NotionSchemaCache`
  - Configuration centralized in `lib/config.js`
  - Constants in `lib/constants.js`

### Testing Standards (ENFORCED)

```shell
npm test                      # Must pass (80 tests)
npm run test:coverage:check   # Must meet thresholds:
                             # - 75% line coverage
                             # - 60% function coverage  
                             # - 60% branch coverage
npm run lint                  # Must pass (all .js/.mjs files)
```

**Rule:** Always run tests after code changes. Coverage is enforced.

### Code Fence Standards

- **Shell commands:** Use ````shell` (not````bash`)
- **JavaScript:** Use ````javascript` or````js`
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

## Overview

On-Call Cat leverages multiple AI agents and automation systems across its development lifecycle:

1. **GitHub Copilot** - Code completion and inline suggestions
2. **GitHub Copilot Chat** - Conversational coding assistant
3. **GitHub Copilot Coding Agent** - Autonomous PR-based development
4. **Deployment Automation Scripts** - Infrastructure and deployment wizards
5. **Test Coverage Enforcement** - Automated quality gates

---

## 1. GitHub Copilot (Code Completion)

**Primary Use:** Real-time code suggestions during development

### Key Features

- **Inline completions** for JavaScript/Node.js code
- **Function generation** from comments and signatures
- **Test case suggestions** based on existing patterns
- **Documentation generation** for JSDoc comments

### Example Usage

```javascript
// Agent generates complete function from comment
/**
 * Parses a "needed by" date/time string supporting multiple formats
 * @param {string} input - The date string to parse
 * @returns {Date|null} Parsed Date object or null if parsing fails
 */
export function parseNeededByString(input) {
  // Copilot generates: ISO parsing, regex matching, ASAP handling, etc.
}
```

### Copilot Configuration

- **Model:** GPT-4 based
- **Context:** Workspace files, open tabs, git history
- **Trigger:** Automatic on typing, manual with `Alt+\`

---

## 2. GitHub Copilot Chat

**Primary Use:** Conversational development assistance, refactoring, and problem-solving

### Capabilities

#### Code Analysis & Review

- Analyze test coverage and identify gaps
- Review code architecture and suggest improvements
- Perform security audits and identify vulnerabilities
- Generate code quality reports

#### Refactoring & Improvements

- Modernize code to use current best practices
- Improve test infrastructure and coverage
- Standardize configuration across environments
- Optimize performance bottlenecks

#### Documentation

- Update README and technical documentation
- Generate JSDoc comments for functions
- Create deployment and setup guides
- Document API endpoints and data flows

#### Debugging

- Investigate test failures and errors
- Identify configuration issues
- Troubleshoot API integration problems
- Diagnose performance issues

### Conversation Context

- **Memory:** Maintains context across conversation
- **File awareness:** Reads and edits workspace files
- **Git integration:** Commits, pushes, and tracks changes
- **Multi-step workflows:** Plans and executes complex tasks

### Example Workflow

**Implementing Test Coverage:**

1. **Analysis:** Run coverage reports to identify untested code
2. **Planning:** Determine which functions need test coverage
3. **Tool Setup:** Install and configure coverage tools (e.g., c8)
4. **Test Creation:** Generate comprehensive test cases
5. **Configuration:** Set coverage thresholds and quality gates
6. **Validation:** Verify all tests pass and meet coverage targets
7. **Documentation:** Update README with testing instructions
8. **Commit:** Push changes with descriptive commit messages

### Common Use Cases

Agent-assisted development is particularly effective for:

- **Port Standardization:** Updating configuration values across multiple files
- **Test Infrastructure:** Adding test commands, expanding linting, documenting QA workflows
- **Coverage Enforcement:** Implementing test coverage with automated quality gates
- **Documentation Updates:** Keeping README and technical docs synchronized with code
- **Configuration Management:** Ensuring consistency across environments

---

## 3. GitHub Copilot Coding Agent (Autonomous Development)

**Primary Use:** Long-running, multi-file development tasks executed asynchronously

### How It Works

1. **User initiates:** `#github-pull-request_copilot-coding-agent implement feature X`
2. **Agent plans:** Analyzes requirements, identifies files, creates task breakdown
3. **Agent executes:**
   - Creates new branch
   - Implements changes across multiple files
   - Writes tests
   - Commits incrementally with descriptive messages
4. **Agent delivers:** Opens PR with detailed description and session logs
5. **User reviews:** Reviews PR, requests changes, or approves

### Ideal Use Cases

- **New feature implementation:** Multi-file features with tests
- **Refactoring:** Large-scale code restructuring
- **API integrations:** New external service integrations
- **Schema migrations:** Database or API schema changes

### Example Task

```
User: "#github-pull-request_copilot-coding-agent Add support for priority escalation 
where P2 tickets older than 24 hours auto-escalate to P1"

Agent creates PR:
- lib/priorities.js: New escalation logic
- lib/parser.js: Age tracking for tickets
- lib/parser.test.js: 8 new escalation tests
- app.js: Scheduled escalation check every 15 minutes
- README.md: Documentation for escalation feature
```

### Session Logs

PRs created by the coding agent include detailed session logs showing:
- **Planning phase:** Task breakdown and file identification
- **Implementation decisions:** Why certain approaches were chosen
- **Testing strategy:** Coverage goals and test case selection
- **Challenges encountered:** Issues resolved during development

---

## 4. Deployment Automation Scripts

**Primary Use:** Infrastructure provisioning, secret management, and deployment orchestration

### Interactive Deployment Wizard

**Location:** `scripts/setup-and-deploy.sh`

#### Wizard Capabilities

- **8-step deployment flow:** From GCP setup to health checks
- **Selective execution:** Run specific steps with flags
- **Secret management:** Interactive prompts for sensitive data
- **Channel configuration:** Multi-channel or single-channel setup
- **Validation:** Checks for required tools and configurations
- **Error handling:** Graceful failures with rollback guidance

#### Usage Examples

```shell
# Full deployment (all 8 steps)
./scripts/setup-and-deploy.sh

# Update secrets only
./scripts/setup-and-deploy.sh --required-secrets

# Rebuild and redeploy after code changes
./scripts/setup-and-deploy.sh --build-image --deploy

# Update channel mappings
./scripts/setup-and-deploy.sh --channels-and-dbs --deploy
```

#### Deployment Flow

```
Step 1: Environment Setup
  ├─ Checks: gcloud CLI installed
  ├─ Sets: PROJECT_ID, REGION
  └─ Validates: GCP authentication

Step 2: GCP Initialization
  ├─ Enables: Required APIs (Cloud Run, Artifact Registry, Secret Manager)
  └─ Creates: Artifact Registry repository

Step 3: Required Secrets
  ├─ Creates: slack-bot-token (xoxb-...)
  ├─ Creates: slack-app-token (xapp-...)
  └─ Creates: notion-token (secret_...)

Step 4: Channel & Database Configuration
  ├─ Choice: Single-channel or multi-channel mode
  ├─ Single: WATCH_CHANNEL_ID + NOTION_DATABASE_ID
  └─ Multi: channel-mappings.json → Secret Manager

Step 5: Docker Image Build
  ├─ Builds: Container image from Dockerfile
  └─ Pushes: To Artifact Registry

Step 6: Cloud Run Deployment
  ├─ Deploys: Service with secrets and env vars
  ├─ Configures: min-instances=1 (Socket Mode requirement)
  └─ Sets: Memory, CPU, port, timeout

Step 7: Service Verification
  ├─ Retrieves: Service URL
  ├─ Checks: /health endpoint
  └─ Validates: Metrics and uptime

Step 8: Logs & Monitoring
  ├─ Tails: Cloud Run logs
  └─ Shows: Startup and message processing
```

### Individual Automation Scripts

#### `scripts/setup-gcp.sh`

- Enables GCP APIs
- Creates Artifact Registry repository
- Validates project configuration

#### `scripts/create-secrets.sh`

- Interactive secret creation wizard
- Validates secret format (token prefixes)
- Supports channel-mappings.json upload

#### `scripts/deploy-gcp.sh`

- Deploys to Cloud Run with full configuration
- Handles single-channel and multi-channel modes
- Configures secrets, env vars, scaling

#### `scripts/view-logs.sh`

- Tails Cloud Run logs with streaming
- Filters for errors and important events
- Formats with colors and timestamps

#### `scripts/check-health.sh`

- Queries /health and /metrics endpoints
- Validates uptime and success rates
- Alerts on anomalies

---

## 5. Test Coverage Enforcement

**Primary Use:** Automated quality gates preventing coverage regressions

### Coverage Tooling

**Tool:** c8 (Native V8 code coverage)

**Configuration:**

```json
{
  "scripts": {
    "test:coverage": "c8 --reporter=text --reporter=html --reporter=lcov npm test",
    "test:coverage:check": "c8 --check-coverage --lines 75 --functions 60 --branches 60 npm test"
  }
}
```

### Current Coverage Status

| Metric | Threshold | Current | Status |
|--------|-----------|---------|--------|
| **Line Coverage** | 75% | 88.44% | ✅ +13.44% |
| **Function Coverage** | 60% | 61.53% | ✅ +1.53% |
| **Branch Coverage** | 60% | 75% | ✅ +15% |

### Coverage by Module

| Module | Lines | Branches | Functions | Tests |
|--------|-------|----------|-----------|-------|
| `parser.js` | 91.75% | 79.06% | 100% | 53 tests |
| `validation.js` | 79.12% | 58.33% | 40% | 27 tests |
| `constants.js` | 90.8% | 100% | 0% | N/A (constants) |

### Test Organization

```
lib/
├── parser.test.js (53 tests)
│   ├── normalizeEmail (12 tests)
│   ├── stripRichTextFormatting (7 tests)
│   ├── parseNeededByString (17 tests)
│   └── parseAutoBlock (17 tests) ← Critical business logic
│
└── validation.test.js (27 tests)
    ├── missingFields (15 tests)
    └── typeIssues (12 tests)
```

### Coverage Reports

**HTML Report:** `coverage/index.html` (gitignored)
- **Visual coverage maps** with line-by-line highlighting
- **Uncovered lines** clearly marked in red
- **Branch coverage** shows untested conditional paths

**LCOV Report:** `coverage/lcov.info` (gitignored)
- **CI/CD integration** format for GitHub Actions, Jenkins, etc.
- **Badge generation** for README shields

**Text Report:** Terminal output
- **Quick overview** during development
- **Per-file breakdown** with percentages
- **Uncovered line numbers** for immediate action

### Quality Gates

#### Pre-commit Enforcement (Recommended)

```shell
# Add to .git/hooks/pre-commit
npm run test:coverage:check || exit 1
```

#### CI/CD Integration (Future)

```yaml
# .github/workflows/test.yml
- name: Run tests with coverage
  run: npm run test:coverage:check
  
- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
```

---

## 6. Static Analysis & Linting

**Primary Use:** Code quality enforcement and consistency

### ESLint Configuration

**Scope:** All JavaScript and ES Module files (`**/*.{js,mjs}`)

**Rules Enforced:**
- **ES6+ syntax:** Modern JavaScript best practices
- **Async/await patterns:** Proper promise handling
- **Import/export conventions:** ES Module standards
- **Code style:** Consistent formatting

### Usage

```shell
# Check all files
npm run lint

# Auto-fix issues
npm run lint:fix

# Check specific file
npx eslint lib/parser.js
```

### Integration Points

- **VS Code:** Real-time linting with ESLint extension
- **Pre-commit hooks:** Optional enforcement with husky
- **CI/CD:** Automated checks on pull requests

---

## 7. Continuous Deployment with Cloud Build

**Primary Use:** Automated builds and deployments triggered by git pushes

### Cloud Build Trigger

**Location:** `cloudbuild.yaml`

**Trigger:** Push to `main` branch

**Build Steps:**
1. **Build Docker image** from Dockerfile
2. **Push to Artifact Registry** with `latest` and commit SHA tags
3. **Deploy to Cloud Run** with updated image
4. **Verify deployment** via health check

### Cloud Build Configuration

```yaml
# cloudbuild.yaml
steps:
  # Build
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', '$_IMAGE_URL:$SHORT_SHA', '.']
  
  # Push
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '$_IMAGE_URL:$SHORT_SHA']
  
  # Deploy
  - name: 'gcr.io/cloud-builders/gcloud'
    args: ['run', 'deploy', 'oncall-cat', '--image', '$_IMAGE_URL:$SHORT_SHA']
```

### Setup

```shell
# Connect GitHub repository
gcloud beta builds triggers create github \
  --repo-name=slack-notion-sync-bot \
  --repo-owner=fgalindo7 \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml
```

---

## 8. AI-Assisted Workflows

### Typical Development Cycle

#### Phase 1: Feature Planning (Copilot Chat)

```
User: "I want to add support for recurring incidents"

Agent:
1. Analyzes current architecture
2. Proposes database schema changes
3. Outlines implementation steps
4. Estimates complexity and risks
```

#### Phase 2: Implementation (Copilot + Coding Agent)

```
Option A: Local Development (Copilot)
- Real-time code suggestions
- Incremental commits
- Human-guided decisions

Option B: Autonomous Development (Coding Agent)
- #github-pull-request_copilot-coding-agent implement feature
- Hands-off PR creation
- Review and iterate
```

#### Phase 3: Testing (Copilot Chat + Coverage Tools)

```
User: "Create comprehensive tests for the new feature"

Agent:
1. Identifies test cases
2. Generates test code
3. Runs coverage check
4. Achieves >75% line coverage
```

#### Phase 4: Documentation (Copilot Chat)

```
User: "Update README with recurring incident examples"

Agent:
1. Reads existing README structure
2. Generates example messages
3. Updates configuration section
4. Adds troubleshooting entries
```

#### Phase 5: Deployment (Automation Scripts)

```shell
# Option 1: Full wizard
./scripts/setup-and-deploy.sh

# Option 2: Rebuild and deploy
./scripts/setup-and-deploy.sh --build-image --deploy
```

#### Phase 6: Monitoring (Scripts + Chat)

```shell
# Check deployment health
./scripts/check-health.sh

# View logs
./scripts/view-logs.sh
```

```
User: "Check if the bot is processing messages correctly"

Agent:
1. Runs: ./scripts/check-health.sh
2. Analyzes: Metrics and success rate
3. Identifies: Any errors or anomalies
4. Suggests: Fixes or optimizations
```

---

## 9. Best Practices for AI-Assisted Development

### When to Use Each Agent

| Task | Agent | Reason |
|------|-------|--------|
| **Quick fixes** | Copilot Chat | Fast, interactive, good for single-file changes |
| **New features** | Coding Agent | Autonomous, comprehensive, includes tests |
| **Refactoring** | Copilot Chat | Human oversight for architectural changes |
| **Debugging** | Copilot Chat | Interactive problem-solving |
| **Documentation** | Copilot Chat | Context-aware writing |
| **Deployment** | Scripts | Reproducible, battle-tested |
| **Testing** | Copilot Chat | Quick test generation with coverage validation |

### Quality Control

#### 1. Always Review Generated Code

- **Understand logic:** Don't blindly accept suggestions
- **Check edge cases:** AI may miss boundary conditions
- **Validate security:** Review auth, input validation, secrets handling

#### 2. Test Before Committing

```shell
# Run tests
npm test

# Check coverage
npm run test:coverage:check

# Lint code
npm run lint
```

#### 3. Incremental Commits

```shell
# Bad: One massive commit
git commit -m "Added feature, fixed bugs, updated docs"

# Good: Atomic commits
git commit -m "Add recurring incident schema to parser"
git commit -m "Create tests for recurring incident parsing"
git commit -m "Update README with recurring incident examples"
```

#### 4. Peer Review

- **Human review:** Even AI-generated PRs need human eyes
- **Test in staging:** Deploy to non-production first
- **Monitor metrics:** Watch success rates and error logs

---

## 10. Future Automation Opportunities

### Planned Enhancements

#### 1. GitHub Actions CI/CD

```yaml
# Automated testing and deployment
on: [push, pull_request]
jobs:
  test:
    - run: npm test
    - run: npm run test:coverage:check
  deploy:
    - run: ./scripts/deploy-gcp.sh
```

#### 2. Automated Dependency Updates

- **Dependabot:** Weekly PR for npm package updates
- **Security scanning:** Snyk or GitHub security alerts

#### 3. Performance Monitoring

- **APM integration:** Datadog, New Relic, or Cloud Trace
- **Alerting:** PagerDuty or Opsgenie for critical failures

#### 4. Chaos Engineering

- **Automated fault injection:** Test resilience
- **Load testing:** Validate scaling under pressure

#### 5. AI-Powered Code Reviews

- **Automated PR reviews:** Code quality, security, performance
- **Suggestion generation:** Refactoring opportunities

---

## 11. Agent Metrics & Impact

### Development Velocity

| Metric | Before Agents | With Agents | Improvement |
|--------|---------------|-------------|-------------|
| **Test coverage setup** | 4-6 hours | 30 minutes | 8-12x faster |
| **Documentation updates** | 2-3 hours | 15 minutes | 8-12x faster |
| **Port standardization** | 1-2 hours | 10 minutes | 6-12x faster |
| **Deployment automation** | 8-12 hours | 2 hours | 4-6x faster |

### Code Quality Improvements

- **Test coverage:** 0% → 88.44% (with AI-generated tests)
- **Linting coverage:** 2 files → All files
- **Documentation completeness:** ~60% → ~95%
- **Deployment reproducibility:** Manual → Fully automated

### Agent Contribution Breakdown

| Component | Human | Copilot Chat | Coding Agent | Scripts |
|-----------|-------|--------------|--------------|---------|
| **Core logic** | 80% | 20% | 0% | 0% |
| **Tests** | 30% | 70% | 0% | 0% |
| **Documentation** | 40% | 60% | 0% | 0% |
| **Infrastructure** | 50% | 30% | 0% | 20% |
| **Deployment** | 20% | 20% | 0% | 60% |

**Overall:** ~55% human, ~35% AI-assisted, ~10% fully automated

---

## 12. Lessons Learned

### What Works Well

✅ **Iterative development with Copilot Chat**
- Fast feedback loop
- Context-aware suggestions
- Easy to course-correct

✅ **Test generation with AI**
- High coverage achieved quickly
- Identifies edge cases
- Good starting point for refinement

✅ **Documentation assistance**
- Consistent style
- Comprehensive coverage
- Up-to-date with code changes

✅ **Deployment automation scripts**
- Reproducible deployments
- Reduced human error
- Self-documenting

### What Requires Human Oversight

⚠️ **Architectural decisions**
- AI suggests solutions, human chooses approach
- Long-term maintainability considerations
- Performance vs. complexity trade-offs

⚠️ **Security-sensitive code**
- Auth logic requires careful review
- Secret management needs validation
- API permissions must be minimal

⚠️ **Business logic edge cases**
- AI may not understand domain-specific rules
- Unusual customer requirements
- Regulatory compliance

⚠️ **Complex refactoring**
- Multi-file changes need human coordination
- Breaking changes require migration planning
- Legacy code may confuse AI context

### Continuous Improvement

🔄 **Regular audits**
- Review AI-generated code quarterly
- Update patterns and conventions
- Refine prompting techniques

🔄 **Feedback loops**
- Report AI mistakes to improve future suggestions
- Document edge cases for training data
- Share successful patterns with team

---

## 13. Common Mistakes to Avoid (For AI Assistants)

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

**Using ```bash instead of```shell:**

```markdown
# WRONG - Don't use bash
```bash
npm test
```​

# CORRECT - Always use shell
```shell
npm test
```​
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

## 14. Getting Started with AI Agents

### For New Contributors

#### Step 1: Enable GitHub Copilot

1. Install VS Code extension: GitHub Copilot + Copilot Chat
2. Authenticate with GitHub account
3. Verify Copilot is active (check status bar)

#### Step 2: Learn the Commands

```
# In VS Code
Cmd+I (Mac) / Ctrl+I (Windows) - Open Copilot Chat
Cmd+Shift+I - Inline chat for quick edits
Alt+\ - Trigger code completion
```

#### Step 3: Try Simple Tasks

- Add JSDoc comments to functions
- Refactor code to use async/await patterns
- Generate test cases for specific functions
- Fix linting errors and formatting issues

#### Step 4: Practice with Context

- Use `@workspace` to query codebase understanding
- Request updates across multiple files
- Create tests for specific functionality
- Ask for explanations of existing code

#### Step 5: Use Coding Agent for Larger Tasks

- Use `#github-pull-request_copilot-coding-agent` for multi-file features
- Delegate complex refactoring tasks
- Implement new features with tests
- Add support for new configuration options

### Tips for Effective Prompting

✅ **Be specific:** "Add tests for parseAutoBlock focusing on date parsing edge cases"
❌ **Too vague:** "Add tests"

✅ **Provide context:** "Update README section on deployment to include multi-channel mode"
❌ **No context:** "Update README"

✅ **Break down tasks:** "First analyze coverage, then identify gaps, then generate tests"
❌ **Too broad:** "Fix all the things"

---

## 15. Support & Resources

### Project Documentation

- **README.md** - Project overview and setup
- **AGENTS.md** - This document (AI agents and automation)
- **docs/GCP_DEPLOYMENT.md** - Comprehensive deployment guide
- **docs/GCP_QUICK_REFERENCE.md** - Quick command reference
- **docs/SCRIPT_FLAGS.md** - Script usage and flags

### Community

- **GitHub Issues** - Bug reports and feature requests
- **GitHub Discussions** - Questions and community help
- **Pull Requests** - Code contributions and reviews

### AI Tools

- **GitHub Copilot** - https://copilot.github.com
- **GitHub Copilot Chat** - Built into VS Code
- **GitHub Copilot Coding Agent** - Available in GitHub interface

---

## 16. License & Attribution

**Project License:** MIT © 2025 Francisco

**AI Assistance:**
- GitHub Copilot (GPT-4) - Code generation and suggestions
- GitHub Copilot Chat - Development assistance and documentation
- Human oversight and architectural decisions by Francisco

**Automation Scripts:**
- Created with AI assistance
- Maintained by human contributors
- Open for community improvements

---

<p align="center">
  <sub>🤖 This document was created collaboratively by humans and AI agents.</sub><br>
  <sub>Last updated: November 10, 2025</sub>
</p>
