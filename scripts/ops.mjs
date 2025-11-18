#!/usr/bin/env node
/**
 * Unified operations CLI for local and GCP workflows
 * Commands: health, logs, start, stop, build, deploy, status
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function parseArgs(argv) {
  const [,, cmdRaw, ...rest] = argv;
  const cmd = (cmdRaw || '').toLowerCase();
  const flags = {};
  for (const arg of rest) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.replace(/^--/, '').split('=');
      flags[k] = v === undefined ? true : v;
    }
  }
  flags.target = (flags.target || process.env.TARGET || 'gcp').toLowerCase();
  // Support both --dry-run and env DRY_RUN=1
  flags['dry-run'] = flags['dry-run'] || flags.dryRun || process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  return { cmd, flags };
}

let DRY_RUN = false;
let executedCommands = [];

async function run(cmd, opts = {}) {
  const { stdio = 'inherit' } = opts;
  if (DRY_RUN) {
    executedCommands.push(cmd);
    if (stdio === 'inherit') {
      console.log(`[dry-run] ${cmd}`);
    }
    return { stdout: '', stderr: '' };
  }
  const { stdout, stderr } = await execAsync(cmd, { env: process.env });
  if (stdio === 'inherit') {
    if (stdout) { process.stdout.write(stdout); }
    if (stderr) { process.stderr.write(stderr); }
  }
  return { stdout, stderr };
}

async function waitForHealth(url, tries = 20, delayMs = 1500) {
  for (let i = 0; i < tries; i++) {
    try {
      if (DRY_RUN) {
        await run(`curl -sSf "${url}/health"`);
        return true;
      }
      await run(`curl -sSf "${url}/health"`);
      return true;
    } catch {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return false;
}

async function cmdHealth(flags) {
  const parts = ['node scripts/check-health.mjs'];
  if (flags.json) { parts.push('--json'); }
  if (flags.url) { parts.push(`--url=${flags.url}`); }
  parts.push(`--target=${flags.target}`);
  await run(parts.join(' '));
}

async function cmdLogs(flags) {
  if (flags.target === 'local') {
    const follow = flags.follow ? '-f' : '';
    // Pipe through pino-pretty to match local formatting with app logger
    await run(`docker compose logs ${follow} oncall-auto | npx pino-pretty --singleLine --translateTime "SYS:yyyy-mm-dd HH:MM:ss.l" --ignore "pid,hostname" --colorize`);
    return;
  }
  // GCP logs via Cloud Logging
  const includeRequests = Boolean(flags['include-requests']);
  let query = `resource.type=cloud_run_revision AND resource.labels.service_name=oncall-cat`;
  if (!includeRequests) {
    // Default to stdout only (exclude request logs) for clearer app logs
    query += ` AND logName:\"run.googleapis.com%2Fstdout\"`;
  }
  if (flags.follow) {
    process.stdout.write('Following Cloud Run logs (Ctrl+C to stop)\n');
    if (DRY_RUN) {
      await run(`gcloud logging tail "${query}" --format=json 2>/dev/null | node scripts/pretty-gcp-logs.mjs || true`);
      return;
    }
    // Stream with tail in follow mode and pretty-print
    await run(`gcloud logging tail "${query}" --format=json 2>/dev/null | node scripts/pretty-gcp-logs.mjs`);
  } else {
    await run(`gcloud logging read "${query}" --limit=50 --format=json --freshness=1h | node scripts/pretty-gcp-logs.mjs --batch`);
  }
}

async function cmdStart(flags) {
  if (flags.target !== 'local') {
    console.error('start is only supported for --target=local');
    process.exit(1);
  }
  await run('docker compose up -d --build');
  const ok = await waitForHealth('http://localhost:1987');
  if (ok) {
    console.log('✅ Healthy at http://localhost:1987/health');
  } else {
    console.log('⚠ Health endpoint not responding yet. Try: npm run logs');
  }
}

async function cmdStop(flags) {
  if (flags.target !== 'local') {
    console.error('stop is only supported for --target=local');
    process.exit(1);
  }
  await run('docker compose down');
}

async function cmdBuild(flags) {
  if (flags.target === 'local') {
    await run('docker compose build');
  } else {
    console.log('Tip: deploy builds the remote image; try: npm run deploy');
  }
}

async function cmdDeploy(flags) {
  if (flags.target !== 'gcp') {
    console.error('deploy is only supported for --target=gcp');
    process.exit(1);
  }
  // Use existing proven script for now
  await run('./scripts/setup-and-deploy.sh --build-image --deploy');
}

async function cmdStatus(flags) {
  await cmdHealth(flags); // delegates to dashboard/JSON depending on flags
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv);
  DRY_RUN = Boolean(flags['dry-run']);
  switch (cmd) {
    case 'health': return cmdHealth(flags);
    case 'logs': return cmdLogs(flags);
    case 'start': return cmdStart(flags);
    case 'stop': return cmdStop(flags);
    case 'build': return cmdBuild(flags);
    case 'deploy': return cmdDeploy(flags);
    case 'status': return cmdStatus(flags);
    case 'test': {
      // Simple self-test suite for ops CLI
      let failed = 0;
      const expect = (cond, msg) => {
        if (!cond) {
          failed++;
          console.error(`✗ ${msg}`);
        } else {
          console.log(`✓ ${msg}`);
        }
      };

      const reset = () => { executedCommands = []; };
      DRY_RUN = true;

      // Test 1: Local logs follow
      reset();
      await cmdLogs({ target: 'local', follow: true });
      expect(executedCommands.some(c => c.includes('docker compose logs -f oncall-auto') && c.includes('pino-pretty')), 'logs local follow pipes through pino-pretty');

      // Test 2: GCP logs (non-follow)
      reset();
      await cmdLogs({ target: 'gcp', follow: false });
      expect(executedCommands.some(c => c.includes('gcloud logging read') && c.includes('service_name=oncall-cat') && c.includes('--format=json')), 'logs gcp reads JSON');
      expect(executedCommands.some(c => c.includes('run.googleapis.com%2Fstdout')), 'logs gcp defaults to stdout-only');
      expect(executedCommands.some(c => c.includes('scripts/pretty-gcp-logs.mjs --batch')), 'logs gcp uses batch mode for array output');

      // Test 2b: GCP logs include request logs
      reset();
      await cmdLogs({ target: 'gcp', follow: false, 'include-requests': true });
      expect(executedCommands.some(c => c.includes('gcloud logging read') && !c.includes('run.googleapis.com%2Fstdout')), 'logs gcp include-requests removes stdout filter');

      // Test 2c: GCP logs follow uses tail and stream mode
      reset();
      await cmdLogs({ target: 'gcp', follow: true });
      expect(executedCommands.some(c => c.startsWith('gcloud logging tail') && c.includes('--format=json')), 'logs gcp follow uses tail');
      expect(executedCommands.some(c => c.includes('scripts/pretty-gcp-logs.mjs') && !c.includes('--batch')), 'logs gcp follow does not use batch');

      // Test 3: Health local JSON with URL
      reset();
      await cmdHealth({ json: true, url: 'http://localhost:1987', target: 'local' });
      const h = executedCommands.join(' ');
      expect(h.includes('node scripts/check-health.mjs'), 'health invokes check-health script');
      expect(h.includes('--json'), 'health passes --json');
      expect(h.includes('--url=http://localhost:1987'), 'health passes --url');
      expect(h.includes('--target=local'), 'health passes --target=local');

      // Test 4: Start local triggers compose and health curl
      reset();
      await cmdStart({ target: 'local' });
      expect(executedCommands.some(c => c.includes('docker compose up -d --build')), 'start local triggers compose up');
      expect(executedCommands.some(c => c.includes('curl -sSf') && c.includes('http://localhost:1987/health')), 'start local checks health');

      // Test 4b: Local logs non-follow pipes to pino-pretty
      reset();
      await cmdLogs({ target: 'local', follow: false });
      expect(executedCommands.some(c => c.includes('docker compose logs  oncall-auto') && c.includes('pino-pretty')), 'logs local non-follow pipes through pino-pretty');

      // Test 5: Deploy GCP
      reset();
      await cmdDeploy({ target: 'gcp' });
      expect(executedCommands.some(c => c.includes('./scripts/setup-and-deploy.sh') && c.includes('--build-image') && c.includes('--deploy')), 'deploy gcp runs setup-and-deploy');

      if (failed > 0) {
        console.error(`\n${failed} test(s) failed.`);
        process.exit(1);
      } else {
        console.log('\nAll ops CLI tests passed.');
        return;
      }
    }
    default:
      console.log('Usage: node scripts/ops.mjs <command> [--target=local|gcp] [--json] [--follow] [--url=...] [--dry-run]');
      console.log('Commands: health, logs, start, stop, build, deploy, status, test');
      process.exit(cmd ? 1 : 0);
  }
}

main().catch(err => {
  console.error(err.message || String(err));
  process.exit(1);
});
