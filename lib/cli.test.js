#!/usr/bin/env node
import assert from 'assert';
import { CliContext } from './cli.js';

async function run() {
  const cli = await CliContext.bootstrap({ requireProject: false, requireRegion: false });
  cli.dryRun = true;

  const res = await cli.run('echo hello');
  assert.equal(res.exitCode, 0);
  assert.ok(cli.executed.length >= 1);
  assert.ok(cli.executed[0].includes('echo hello'));

  const answer = await cli.prompt('Should skip?', { defaultValue: 'n' });
  assert.equal(answer, 'n');

  console.log('[OK] CliContext dry-run tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
