#!/usr/bin/env node
import assert from 'assert';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function run() {
  const env = { ...process.env, DRY_RUN: '1' };
  const cmd = 'node scripts/check-health.mjs --json --target=local --url=http://localhost:1987';
  const { stdout } = await execAsync(cmd, { env });
  const data = JSON.parse(stdout);

  assert.ok(data.health, 'health present');
  assert.ok(data.cloudRun, 'cloudRun present');
  assert.ok(data.cloudDeploy, 'cloudDeploy present');
  assert.ok(data.cloudBuild, 'cloudBuild present');
  assert.ok(data.git, 'git present');
  assert.ok(data.mappings, 'mappings present');

  // basic health shape
  assert.ok(['healthy','unhealthy'].includes(data.health.json?.status || data.health.status || 'healthy'));
  console.log('[OK] check-health smoke test passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
