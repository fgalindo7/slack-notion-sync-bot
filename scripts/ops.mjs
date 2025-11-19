#!/usr/bin/env node
/**
 * Unified operations CLI (refactored) using CliContext.
 * Commands: health, logs, start, stop, build, deploy, status, preflight, test
 */
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import { CliContext } from '../lib/cli.js';
import { logger } from '../lib/cli-logger.js';
import { parseFlags } from '../lib/cli-flags.js';

async function waitForHealth(cli, url, tries = 20, delayMs = 1500) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await cli.run(`curl -sSf "${url}/health"`);
      if (res.exitCode === 0) {
        return true;
      }
      return true;
    } catch {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return false;
}

async function cmdHealth(cli) {
  const flags = cli.flags;
  const parts = ['node scripts/check-health.mjs'];
  if (flags.json) { parts.push('--json'); }
  if (flags.url) { parts.push(`--url=${flags.url}`); }
  parts.push(`--target=${flags.target}`);
  await cli.run(parts.join(' '));
}

async function cmdLogs(cli) {
  const flags = cli.flags;
  if (flags.target === 'local') {
    const follow = flags.follow ? '-f' : '';
    const cmd = `docker compose logs ${follow} oncall-auto | npx pino-pretty --singleLine --translateTime "SYS:yyyy-mm-dd HH:MM:ss.l" --ignore "pid,hostname" --colorize`;
    if (flags.follow) {
      await cli.runStreaming(cmd);
    } else {
      await cli.run(cmd);
    }
    return;
  }
  const includeRequests = Boolean(flags['include-requests']);
  let query = `resource.type=cloud_run_revision AND resource.labels.service_name=oncall-cat`;
  if (!includeRequests) { query += ` AND logName:\"run.googleapis.com%2Fstdout\"`; }
  const project = cli.projectId;
  if (flags.follow) {
    process.stdout.write('Following Cloud Run logs (Ctrl+C to stop)\n');
    // Use beta track for tail, which is widely available
    const cmd = `gcloud beta logging tail "${query}" --project=${project} --format=json | node scripts/pretty-gcp-logs.mjs`;
    await cli.runStreaming(cmd);
  } else {
    await cli.run(`gcloud logging read "${query}" --project=${project} --limit=50 --format=json --freshness=1h | node scripts/pretty-gcp-logs.mjs --batch`);
  }
}

async function cmdStart(cli) {
  const flags = cli.flags;
  if (flags.target !== 'local') {
    logger.error('start is only supported for --target=local');
    process.exit(1);
  }
  await cli.run('docker compose up -d --build');
  const ok = await waitForHealth(cli, 'http://localhost:1987');
  if (ok) {
    logger.success('[OK] Healthy at http://localhost:1987/health');
  } else {
    logger.warn('[WARN] Health endpoint not responding yet. Try: npm run logs');
  }
}

async function cmdStop(cli) {
  const flags = cli.flags;
  if (flags.target !== 'local') {
    logger.error('stop is only supported for --target=local');
    process.exit(1);
  }
  await cli.run('docker compose down');
}

async function cmdBuild(cli) {
  const flags = cli.flags;
  if (flags.target === 'local') {
    await cli.run('docker compose build');
  } else {
    logger.info('Tip: deploy builds the remote image; try: npm run deploy');
  }
}

async function cmdDeploy(cli) {
  const flags = cli.flags;
  if (flags.target !== 'gcp') {
    logger.error('deploy is only supported for --target=gcp');
    process.exit(1);
  }
  await cli.run('node infrastructure/deploy-automation.mjs deploy');
}

async function cmdStatus(cli) {
  await cmdHealth(cli);
}

async function loadChannelMapping() {
  try {
    if (process.env.CHANNEL_DB_MAPPINGS) { return JSON.parse(process.env.CHANNEL_DB_MAPPINGS); }
  } catch {
    // ignore
  }
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const mappingPath = path.resolve(__dirname, '../channel-mappings.json');
    const raw = await readFile(mappingPath);
    return JSON.parse(raw.toString());
  } catch {
    return {};
  }
}

async function cmdPreflight(cli) {
  const flags = cli.flags;
  const isLocal = flags.target === 'local';
  const problems = [];
  const projectId = cli.projectId;
  const region = cli.region || 'us-central1';

  if (!isLocal) {
    if (cli.dryRun) {
      const pid = projectId || 'dummy-project';
      await cli.run(`gcloud projects describe ${pid} --format='value(projectNumber)'`, { capture: true });
      await cli.run(`gcloud projects get-iam-policy ${pid} --format=json`, { capture: true });
      await cli.run(`gcloud iam service-accounts get-iam-policy 1234567890-compute@developer.gserviceaccount.com --format=json`, { capture: true });
      const pipelineName = process.env.DELIVERY_PIPELINE || 'oncall-cat-pipeline';
      await cli.run(`gcloud deploy delivery-pipelines describe ${pipelineName} --region=${region} --project=${pid} --format='value(name)'`, { capture: true });
    } else {
      if (!projectId) { logger.error('Missing project'); process.exit(1); }
      const { stdout: pnOut } = await cli.run(`gcloud projects describe ${projectId} --format='value(projectNumber)'`, { capture: true });
      const projectNumber = pnOut.trim();
      if (!projectNumber) { logger.error('Failed to obtain project number'); process.exit(1); }
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
      const { stdout: policyJson } = await cli.run(`gcloud projects get-iam-policy ${projectId} --format=json`, { capture: true });
      let policy;
      try { policy = JSON.parse(policyJson); } catch { logger.error('Failed to parse IAM policy JSON'); process.exit(1); }
      const bindings = policy.bindings || [];
      const rolesFor = (email) => bindings.filter(b => b.members && b.members.includes(`serviceAccount:${email}`)).map(b => b.role);
      const cbRoles = new Set(rolesFor(cbSa));
      const runtimeRoles = new Set(rolesFor(runtimeSa));
      const missingCb = [...requiredCbRoles].filter(r => !cbRoles.has(r));
      const missingRuntime = [...requiredRuntimeRoles].filter(r => !runtimeRoles.has(r));
      const { stdout: actAsJson } = await cli.run(`gcloud iam service-accounts get-iam-policy ${runtimeSa} --format=json`, { capture: true });
      let actAsPolicy; try { actAsPolicy = JSON.parse(actAsJson); } catch { actAsPolicy = {}; }
      const actBindings = actAsPolicy.bindings || [];
      const actRole = actBindings.find(b => b.role === 'roles/iam.serviceAccountUser');
      const hasDeployActAs = !!(actRole && actRole.members && actRole.members.includes(`serviceAccount:${deploySa}`));
      const pipelineName = process.env.DELIVERY_PIPELINE || 'oncall-cat-pipeline';
      let pipelineOk = true;
      try { await cli.run(`gcloud deploy delivery-pipelines describe ${pipelineName} --region=${region} --project=${projectId} --format='value(name)'`, { capture: true }); } catch { pipelineOk = false; }
      if (missingCb.length) {
        problems.push(`Cloud Build SA missing roles: ${missingCb.join(', ')}`);
      }
      if (missingRuntime.length) {
        problems.push(`Runtime SA missing roles: ${missingRuntime.join(', ')}`);
      }
      if (!hasDeployActAs) {
        problems.push('Cloud Deploy service agent lacks ActAs on runtime SA');
      }
      if (!pipelineOk) {
        problems.push(`Pipeline '${pipelineName}' not readable (check existence or permissions)`);
      }
    }
  }

  if (flags.slack) {
    const slackProblems = [];
    const token = process.env.SLACK_BOT_TOKEN;
    if (cli.dryRun) {
      await cli.run('echo slack-preflight-check auth.test');
      await cli.run('echo slack-preflight-check conversations.list');
      try {
        const mapping = await loadChannelMapping();
        const channels = (mapping.databases || [])
          .flatMap(d => (d.channels || []).map(c => c.channelId))
          .filter(Boolean);
        for (const ch of [...new Set(channels)].slice(0, 3)) { await cli.run(`echo slack-preflight-check conversations.history ${ch}`); }
      } catch {
        // ignore
      }
    } else {
      if (!token) { slackProblems.push('Missing SLACK_BOT_TOKEN environment variable'); }
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' };
      try {
        const authRes = await globalThis.fetch('https://slack.com/api/auth.test', { headers });
        const authJson = await authRes.json();
        if (!authJson.ok) { slackProblems.push(`Slack auth.test failed: ${authJson.error || 'unknown_error'}`); }
      } catch (e) {
        slackProblems.push(`Slack auth.test error: ${e.message || e}`);
      }
      try {
        const listRes = await globalThis.fetch('https://slack.com/api/conversations.list?limit=1&types=public_channel,private_channel', { headers });
        const listJson = await listRes.json();
        if (!listJson.ok && listJson.error === 'missing_scope') { slackProblems.push('Slack scope missing: channels:read (required to enumerate channels)'); }
        else if (!listJson.ok) { slackProblems.push(`Slack conversations.list failed: ${listJson.error || 'unknown_error'}`); }
      } catch (e) {
        slackProblems.push(`Slack conversations.list error: ${e.message || e}`);
      }
      try {
        const mapping = await loadChannelMapping();
        const channels = (mapping.databases || [])
          .flatMap(d => (d.channels || []).map(c => c.channelId))
          .filter(Boolean);
        const toCheck = [...new Set(channels)].slice(0, 15);
        for (const ch of toCheck) {
          const histRes = await globalThis.fetch('https://slack.com/api/conversations.history', {
            method: 'POST',
            headers,
            body: new globalThis.URLSearchParams({ channel: ch, limit: '1' })
          });
            const histJson = await histRes.json();
            if (!histJson.ok) {
              const err = histJson.error || 'unknown_error';
              if (err === 'channel_not_found') { slackProblems.push(`Slack channel not found or inaccessible: ${ch}`); }
              else if (err === 'not_in_channel') { slackProblems.push(`Bot is not a member of channel: ${ch}`); }
              else if (err === 'missing_scope') { slackProblems.push('Slack scope missing: channels:history (required to read channel history)'); }
              else { slackProblems.push(`conversations.history failed for ${ch}: ${err}`); }
            }
        }
      } catch (e) {
        slackProblems.push(`Slack channel access check error: ${e.message || e}`);
      }
    }
    if (slackProblems.length) { problems.push(...slackProblems.map(p => `[Slack] ${p}`)); }
  }

  if (problems.length) {
    logger.error('[ERR] Preflight failed');
    for (const p of problems) {
      logger.error(` - ${p}`);
    }
    process.exit(1);
  } else {
    const okMsg = isLocal
      ? (flags.slack ? '[OK] Preflight passed: Slack checks satisfied' : '[OK] Preflight passed')
      : (flags.slack ? '[OK] Preflight passed: IAM, pipeline, and Slack checks satisfied' : '[OK] Preflight passed: IAM & pipeline checks satisfied');
    logger.success(okMsg);
  }
}

async function main() {
  const prelim = parseFlags(process.argv);
  const cmd = (prelim._raw[0] || '').toLowerCase();
  const target = prelim.target;
  const cli = await CliContext.bootstrap({ argv: process.argv, requireProject: target === 'gcp', requireRegion: target === 'gcp' });
  // Preserve original raw command word removal from flags list
  switch (cmd) {
    case 'preflight': return cmdPreflight(cli);
    case 'health': return cmdHealth(cli);
    case 'logs': return cmdLogs(cli);
    case 'start': return cmdStart(cli);
    case 'stop': return cmdStop(cli);
    case 'build': return cmdBuild(cli);
    case 'deploy': return cmdDeploy(cli);
    case 'status': return cmdStatus(cli);
    case 'test': {
      let failed = 0;
      const expect = (cond, msg) => { if (!cond) { failed++; logger.error(`[ERR] ${msg}`); } else { logger.success(`[OK] ${msg}`); } };
      const reset = () => { cli.executed = []; };
      cli.dryRun = true;

      reset();
      cli.flags = { target: 'local', follow: true };
      await cmdLogs(cli);
      expect(cli.executed.some(c => c.includes('docker compose logs -f oncall-auto') && c.includes('pino-pretty')), 'logs local follow pipes through pino-pretty');

      reset();
      cli.flags = { target: 'gcp', follow: false };
      await cmdLogs(cli);
      expect(cli.executed.some(c => c.includes('gcloud logging read') && c.includes('service_name=oncall-cat') && c.includes('--format=json')), 'logs gcp reads JSON');
      expect(cli.executed.some(c => c.includes('run.googleapis.com%2Fstdout')), 'logs gcp defaults to stdout-only');
      expect(cli.executed.some(c => c.includes('scripts/pretty-gcp-logs.mjs --batch')), 'logs gcp uses batch mode for array output');

      reset();
      cli.flags = { target: 'gcp', follow: false, 'include-requests': true };
      await cmdLogs(cli);
      expect(cli.executed.some(c => c.includes('gcloud logging read') && !c.includes('run.googleapis.com%2Fstdout')), 'logs gcp include-requests removes stdout filter');

      reset();
      cli.flags = { target: 'gcp', follow: true };
      await cmdLogs(cli);
      expect(cli.executed.some(c => c.includes('logging tail') && c.includes('--format=json')), 'logs gcp follow uses tail');
      expect(cli.executed.some(c => c.includes('scripts/pretty-gcp-logs.mjs') && !c.includes('--batch')), 'logs gcp follow does not use batch');

      reset();
      cli.flags = { json: true, url: 'http://localhost:1987', target: 'local' };
      await cmdHealth(cli);
      const h = cli.executed.join(' ');
      expect(h.includes('node scripts/check-health.mjs'), 'health invokes check-health script');
      expect(h.includes('--json'), 'health passes --json');
      expect(h.includes('--url=http://localhost:1987'), 'health passes --url');
      expect(h.includes('--target=local'), 'health passes --target=local');

      reset();
      cli.flags = { target: 'local' };
      await cmdStart(cli);
      expect(cli.executed.some(c => c.includes('docker compose up -d --build')), 'start local triggers compose up');
      expect(cli.executed.some(c => c.includes('curl -sSf') && c.includes('http://localhost:1987/health')), 'start local checks health');

      reset();
      cli.flags = { target: 'local', follow: false };
      await cmdLogs(cli);
      expect(cli.executed.some(c => c.includes('docker compose logs  oncall-auto') && c.includes('pino-pretty')), 'logs local non-follow pipes through pino-pretty');

      reset();
      cli.flags = { target: 'gcp' };
      await cmdDeploy(cli);
      expect(cli.executed.some(c => c.includes('node infrastructure/deploy-automation.mjs deploy')), 'deploy gcp delegates to deploy-automation.mjs');

      reset();
      cli.flags = { target: 'local', slack: true };
      await cmdPreflight(cli);
      expect(cli.executed.some(c => c.includes('slack-preflight-check auth.test')), 'preflight local emits slack auth dry-run');
      expect(cli.executed.some(c => c.includes('slack-preflight-check conversations.list')), 'preflight local emits slack list dry-run');

      reset();
      cli.flags = { target: 'gcp', slack: false };
      await cmdPreflight(cli);
      expect(cli.executed.some(c => c.includes('gcloud projects describe') && c.includes('--format=')), 'preflight gcp checks project number');
      expect(cli.executed.some(c => c.includes('gcloud deploy delivery-pipelines describe')), 'preflight gcp checks pipeline');

      reset();
      cli.flags = { target: 'gcp', slack: true };
      await cmdPreflight(cli);
      expect(cli.executed.some(c => c.includes('slack-preflight-check auth.test')), 'preflight gcp emits slack auth dry-run');

      if (failed > 0) {
        logger.error(`\n[ERR] ${failed} test(s) failed.`);
        process.exit(1);
      } else {
        logger.success('\n[OK] All ops CLI tests passed.');
        return;
      }
    }
    default: {
      logger.info('Usage: node scripts/ops.mjs <command> [--target=local|gcp] [--json] [--follow] [--url=...] [--project=...] [--region=...] [--dry-run]');
      logger.info('Commands: health, logs, start, stop, build, deploy, status, preflight, test');
      process.exit(cmd ? 1 : 0);
    }
  }
}

main().catch(err => {
  logger.error(`[ERR] ${err.message || String(err)}`);
  process.exit(1);
});
