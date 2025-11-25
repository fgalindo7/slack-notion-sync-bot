#!/usr/bin/env node
/**
 * @fileoverview Unified health check dashboard for On-Call Cat
 * Supports both local and GCP environments with OO architecture
 * @author Francisco Galindo
 */

import { CliContext } from '../lib/cli.js';
import { logger } from '../lib/cli-logger.js';
import CONFIG from '../lib/health-check/config.mjs';

// Import checkers
import { GitCheck } from '../lib/health-check/checks/git-check.mjs';
import { AppHealthCheck } from '../lib/health-check/checks/app-health-check.mjs';
import { GcpCheck } from '../lib/health-check/checks/gcp-check.mjs';
import { DockerCheck } from '../lib/health-check/checks/docker-check.mjs';
import { NodeCheck } from '../lib/health-check/checks/node-check.mjs';
import { ServiceConfigurationCheck } from '../lib/health-check/checks/service-config-check.mjs';
import { PortCheck } from '../lib/health-check/checks/port-check.mjs';

// Import renderers
import { TerminalRenderer } from '../lib/health-check/renderers/terminal-renderer.mjs';
import { JsonRenderer } from '../lib/health-check/renderers/json-renderer.mjs';
import { WatchRenderer } from '../lib/health-check/renderers/watch-renderer.mjs';

// Parse CLI flags
const args = process.argv.slice(2);
function flag(name, def = '') {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : def;
}

const flags = {
  verbose: args.includes('--verbose') || args.includes('-v'),
  json: args.includes('--json'),
  watch: args.includes('--watch') || args.includes('-w'),
  section: flag('section', null),
  interval: parseInt(flag('interval', String(CONFIG.refreshInterval)), 10),
  target: flag('target', '').toLowerCase(),
  url: flag('url', ''),
  animInterval: parseInt(flag('anim-interval', '650'), 10),
  animMode: flag('anim-mode', 'gentle'),
};

// Global CLI context
let cli = null;
let projectId = null;
let region = null;

/**
 * Initialize all health checkers based on target
 */
function initializeCheckers(target) {
  const checkers = [];
  const config = {
    cli,
    flags,
    projectId,
    region,
    ...CONFIG,
  };

  // Always run these checks
  checkers.push(new GitCheck(config));
  checkers.push(new AppHealthCheck(config));

  // Target-specific checks
  if (target === 'local') {
    checkers.push(new DockerCheck(config));
    checkers.push(new PortCheck(config));
    checkers.push(new ServiceConfigurationCheck(config));
    checkers.push(new NodeCheck(config));
    // In dry-run mode, also include GCP checks for testing
    if (process.env.DRY_RUN === '1') {
      checkers.push(new GcpCheck(config));
    }
  } else {
    // GCP checks for non-local targets
    checkers.push(new GcpCheck(config));
  }

  return checkers;
}

/**
 * Run all applicable health checks
 */
async function runHealthChecks() {
  const target = flags.target || 'gcp';
  const checkers = initializeCheckers(target);

  const results = [];
  for (const checker of checkers) {
    if (!checker.isApplicable(target)) {
      continue;
    }

    try {
      const result = await checker.check();
      results.push({
        checker: checker.name,
        status: result.status,
        data: result.data,
        error: result.error,
        icon: checker.getIcon(),
      });
    } catch (error) {
      results.push({
        checker: checker.name,
        status: 'error',
        data: null,
        error: error.message,
        icon: checker.getIcon(),
      });
    }
  }

  return results;
}

/**
 * Create appropriate renderer based on flags
 */
function createRenderer() {
  const config = {
    projectId,
    region,
    ...CONFIG,
  };

  if (flags.json) {
    return new JsonRenderer(config, flags);
  } else if (flags.watch) {
    return new WatchRenderer(config, flags);
  } else {
    return new TerminalRenderer(config, flags);
  }
}

/**
 * Main execution
 */
async function main() {
  // Initialize CLI context only if not targeting local (or in dry-run mode for testing)
  if (flags.target !== 'local' || process.env.DRY_RUN === '1') {
    cli = await CliContext.bootstrap({ requireProject: true, requireRegion: true });
    projectId = cli.projectId;
    region = cli.region;

    if (!projectId && flags.target !== 'local') {
      logger.error('Error: GCP project not resolved');
      process.exit(1);
    }
  }

  const renderer = createRenderer();

  if (flags.watch) {
    // Watch mode: initial render + animation loop
    const initialResults = await runHealthChecks();
    renderer.clear();
    await renderer.render(initialResults);
    await renderer.startWatchMode(runHealthChecks);
  } else {
    // Single run mode
    const results = await runHealthChecks();
    await renderer.render(results);
  }
}

main().catch(error => {
  logger.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
