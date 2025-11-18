# 🤖 AI Agents Quick Guide

Purpose: Minimal, actionable reference for AI assistants working in this repo. Keep changes safe, focused, and validated.

---

## Quick Reference

- Language: JavaScript ES Modules (`.js`, `.mjs`) — Node.js 20+
- Architecture: Pure functions in `lib/parser.js`, `lib/validation.js`; classes for state in `lib/metrics.js` (BotMetrics) and `lib/schema-cache.js` (NotionSchemaCache); config in `lib/config.js`; constants in `lib/constants.js`.
- Entry point: `app.js`

## Testing Standards (ENFORCED)

```shell
npm test                      # Must pass (all test files)
npm run test:coverage:check   # Gates: ≥75% lines, ≥60% funcs, ≥60% branches
npm run lint                  # Must pass for all .js/.mjs
```

Rule: Always run tests + coverage + lint after code changes.

## Code Fence Standards

- Shell commands: use fenced code blocks with language `shell`
- JavaScript: use fenced code blocks with `javascript` or `js`
- JSON: use fenced code blocks with `json`
- Markdown: use fenced code blocks with `markdown` or `md`

## Port Configuration (CRITICAL)

- All services use port `1987` (main app + health check)
- Never use `3000`
- If ports change, update: `lib/config.js`, `docker-compose.yml`, `README.md`, `docs/GCP_QUICK_REFERENCE.md`

## File Structure Rules

```
lib/
├── parser.js          # Core parsing logic
├── parser.test.js     # 53+ tests for parser functions
├── validation.js      # Field validation
├── validation.test.js # 27 tests for validation
├── constants.js       # Regexes, defaults, enums
├── config.js          # Configuration loading & validation
├── metrics.js         # BotMetrics class
└── schema-cache.js    # NotionSchemaCache class

app.js                 # Main entry point
```

## Deployment & Ops (npm)

```shell
# Local lifecycle
npm run start      # build + start local container
npm run stop       # stop local container
npm run build      # build local image

# Health & logs
npm run health     # TARGET=gcp (default) or TARGET=local
npm run logs       # TARGET=gcp (default) or TARGET=local
npm run logs -- --follow

# Deploy to GCP via automation
npm run infra:setup   # provision/validate APIs, secrets, Artifact Registry
npm run deploy:init   # one-time Cloud Deploy initialization
npm run deploy        # create release and deploy (staging → promote)

# Extras
DRY_RUN=1 npm run deploy
npm run test:cli      # self-test the ops CLI
```

## Quality Control

- Tests: Run `npm test` then `npm run test:coverage:check`.
- Lint: Run `npm run lint`; prefer `npm run lint:fix` only for safe auto-fixes.
- Commits: Keep atomic and descriptive (e.g., “parser: add ASAP handling tests”).
- Docs: If you change ports, scripts, or deploy flow, update related docs.

## Coverage & Linting

Coverage (c8):

```json
{
  "scripts": {
    "test:coverage": "c8 --reporter=text --reporter=html --reporter=lcov npm test",
    "test:coverage:check": "c8 --check-coverage --lines 75 --functions 60 --branches 60 npm test"
  }
}
```

ESLint:

```shell
npm run lint        # Check all files
npm run lint:fix    # Attempt safe autofixes
npx eslint lib/parser.js
```

## Common Mistakes (Avoid)

- Wrong port: Never bind to `3000`; always `1987`.
- Misplaced tests: Co-locate in `lib/*.test.js`.
- Skipping validation: Don’t commit without tests + coverage + lint.
- Adding coverage artifacts to git: `coverage/`, `.nyc_output/`, `.c8/` are ignored.
- Wrong fences: use `shell`, not `bash`.

## Support & Resources

- Main README: `README.md`
- GCP Deployment Guide: `docs/GCP_DEPLOYMENT.md`
- Quick Reference: `docs/GCP_QUICK_REFERENCE.md`
- Ops CLI: `scripts/ops.mjs`
- Infra Automation: `infrastructure/setup-infrastructure.mjs`, `infrastructure/deploy-automation.mjs`
