#!/usr/bin/env node
/**
 * Unified operations CLI for local and GCP workflows
 * Commands: health, logs, start, stop, build, deploy, status
 */
import { exec } from 'child_process';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import { colorizeLine } from '../lib/status-colors.js';
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
      console.log(colorizeLine(`[dry-run] ${cmd}`));
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
    console.log(colorizeLine('[OK] Healthy at http://localhost:1987/health'));
  } else {
    console.log(colorizeLine('[WARN] Health endpoint not responding yet. Try: npm run logs'));
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
  // Delegate to Cloud Deploy automation script
  await run('node infrastructure/deploy-automation.mjs deploy');
}

async function cmdStatus(flags) {
  await cmdHealth(flags); // delegates to dashboard/JSON depending on flags
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv);
  DRY_RUN = Boolean(flags['dry-run']);
  switch (cmd) {
    case 'preflight': {
      // IAM & pipeline sanity checks before deploy
      const projectId = process.env.GCP_PROJECT_ID || process.env.PROJECT_ID;
      const region = process.env.REGION || 'us-central1';
      if (!projectId) { console.error('Missing GCP_PROJECT_ID/PROJECT_ID'); process.exit(1); }
      const getProjectNumberCmd = `gcloud projects describe ${projectId} --format='value(projectNumber)'`;
      const { stdout: pnOut } = await run(getProjectNumberCmd, { stdio: 'pipe' });
      const projectNumber = pnOut.trim();
      if (!projectNumber) { console.error('Failed to obtain project number'); process.exit(1); }
      const cbSa = process.env.CLOUD_BUILD_SA_EMAIL || `${projectNumber}@cloudbuild.gserviceaccount.com`;
      const runtimeSa = `${projectNumber}-compute@developer.gserviceaccount.com`;
      const deploySa = `service-${projectNumber}@gcp-sa-clouddeploy.iam.gserviceaccount.com`;

      const requiredCbRoles = new Set([
        'roles/run.admin',
        'roles/iam.serviceAccountUser',
        'roles/clouddeploy.releaser',
        'roles/clouddeploy.viewer',
        'roles/artifactregistry.writer'
      ]);
      const requiredRuntimeRoles = new Set([
        'roles/secretmanager.secretAccessor',
        'roles/artifactregistry.reader'
      ]);

      const iamPolicyCmd = `gcloud projects get-iam-policy ${projectId} --format=json`;
      const { stdout: policyJson } = await run(iamPolicyCmd, { stdio: 'pipe' });
      let policy;
      try { policy = JSON.parse(policyJson); } catch { console.error('Failed to parse IAM policy JSON'); process.exit(1); }
      const bindings = policy.bindings || [];
      const rolesFor = (email) => bindings.filter(b => b.members && b.members.includes(`serviceAccount:${email}`)).map(b => b.role);
      const cbRoles = new Set(rolesFor(cbSa));
      const runtimeRoles = new Set(rolesFor(runtimeSa));

      const missingCb = [...requiredCbRoles].filter(r => !cbRoles.has(r));
      const missingRuntime = [...requiredRuntimeRoles].filter(r => !runtimeRoles.has(r));

      // ActAs check
      const actAsCmd = `gcloud iam service-accounts get-iam-policy ${runtimeSa} --format=json`;
      const { stdout: actAsJson } = await run(actAsCmd, { stdio: 'pipe' });
      let actAsPolicy; try { actAsPolicy = JSON.parse(actAsJson); } catch { actAsPolicy = {}; }
      const actBindings = actAsPolicy.bindings || [];
      const actRole = actBindings.find(b => b.role === 'roles/iam.serviceAccountUser');
      const hasDeployActAs = !!(actRole && actRole.members && actRole.members.includes(`serviceAccount:${deploySa}`));

      // Pipeline visibility
      const pipelineName = process.env.DELIVERY_PIPELINE || 'oncall-cat-pipeline';
      let pipelineOk = true;
      try {
        await run(`gcloud deploy delivery-pipelines describe ${pipelineName} --region=${region} --project=${projectId} --format='value(name)'`, { stdio: 'pipe' });
      } catch { pipelineOk = false; }

      const problems = [];
      if (missingCb.length) { problems.push(`Cloud Build SA missing roles: ${missingCb.join(', ')}`); }
      if (missingRuntime.length) { problems.push(`Runtime SA missing roles: ${missingRuntime.join(', ')}`); }
      if (!hasDeployActAs) { problems.push('Cloud Deploy service agent lacks ActAs on runtime SA'); }
      if (!pipelineOk) { problems.push(`Pipeline '${pipelineName}' not readable (check existence or permissions)`); }

      // Optional Slack preflight (--slack)
      if (flags.slack) {
        const slackProblems = [];
        const token = process.env.SLACK_BOT_TOKEN;
        if (!token) {
          slackProblems.push('Missing SLACK_BOT_TOKEN environment variable');
        } else {
          const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' };
          try {
            // auth.test
            const authRes = await globalThis.fetch('https://slack.com/api/auth.test', { headers });
            const authJson = await authRes.json();
            if (!authJson.ok) {
              slackProblems.push(`Slack auth.test failed: ${authJson.error || 'unknown_error'}`);
            }
          } catch (e) {
            slackProblems.push(`Slack auth.test error: ${e.message || e}`);
          }

          try {
            // conversations.list minimal call to detect channels:read
            const listRes = await globalThis.fetch('https://slack.com/api/conversations.list?limit=1&types=public_channel,private_channel', { headers });
            const listJson = await listRes.json();
            if (!listJson.ok && listJson.error === 'missing_scope') {
              slackProblems.push('Slack scope missing: channels:read (required to enumerate channels)');
            } else if (!listJson.ok) {
              slackProblems.push(`Slack conversations.list failed: ${listJson.error || 'unknown_error'}`);
            }
          } catch (e) {
            slackProblems.push(`Slack conversations.list error: ${e.message || e}`);
          }

          // Validate access to mapped channels via conversations.history (tests channels:history + membership)
          try {
            let mapping;
            if (process.env.CHANNEL_DB_MAPPINGS) {
              try { mapping = JSON.parse(process.env.CHANNEL_DB_MAPPINGS); } catch { /* ignore */ }
            }
            if (!mapping) {
              const __filename = fileURLToPath(import.meta.url);
              const __dirname = path.dirname(__filename);
              const mappingPath = path.resolve(__dirname, '../channel-mappings.json');
              const raw = await readFile(mappingPath);
              mapping = JSON.parse(raw.toString());
            }
            const channels = (mapping.databases || [])
              .flatMap(d => (d.channels || []).map(c => c.channelId))
              .filter(Boolean);
            const toCheck = [...new Set(channels)].slice(0, 15); // cap checks
            for (const ch of toCheck) {
              const histRes = await globalThis.fetch('https://slack.com/api/conversations.history', {
                method: 'POST',
                headers,
                body: new globalThis.URLSearchParams({ channel: ch, limit: '1' })
              });
              const histJson = await histRes.json();
              if (!histJson.ok) {
                const err = histJson.error || 'unknown_error';
                if (err === 'channel_not_found') {
                  slackProblems.push(`Slack channel not found or inaccessible: ${ch}`);
                } else if (err === 'not_in_channel') {
                  slackProblems.push(`Bot is not a member of channel: ${ch}`);
                } else if (err === 'missing_scope') {
                  slackProblems.push('Slack scope missing: channels:history (required to read channel history)');
                } else {
                  slackProblems.push(`conversations.history failed for ${ch}: ${err}`);
                }
              }
            }
          } catch (e) {
            slackProblems.push(`Slack channel access check error: ${e.message || e}`);
          }
        }
        if (slackProblems.length) {
          problems.push(...slackProblems.map(p => `[Slack] ${p}`));
        }
      }

      if (problems.length) {
        console.error(colorizeLine('[ERR] Preflight failed'));
        for (const p of problems) { console.error(colorizeLine(` - ${p}`)); }
        process.exit(1);
      } else {
        const okMsg = flags.slack ? '[OK] Preflight passed: IAM, pipeline, and Slack checks satisfied' : '[OK] Preflight passed: IAM & pipeline checks satisfied';
        console.log(colorizeLine(okMsg));
      }
      return;
    }
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
            console.error(colorizeLine(`[ERR] ${msg}`));
        } else {
            console.log(colorizeLine(`[OK] ${msg}`));
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
      expect(executedCommands.some(c => c.includes('node infrastructure/deploy-automation.mjs deploy')), 'deploy gcp delegates to deploy-automation.mjs');

      if (failed > 0) {
        console.error(colorizeLine(`\n[ERR] ${failed} test(s) failed.`));
        process.exit(1);
      } else {
        console.log(colorizeLine('\n[OK] All ops CLI tests passed.'));
        return;
      }
    }
    default:
      console.log(colorizeLine('Usage: node scripts/ops.mjs <command> [--target=local|gcp] [--json] [--follow] [--url=...] [--dry-run]'));
      console.log(colorizeLine('Commands: health, logs, start, stop, build, deploy, status, test'));
      process.exit(cmd ? 1 : 0);
  }
}

main().catch(err => {
  console.error(colorizeLine(`[ERR] ${err.message || String(err)}`));
  process.exit(1);
});
