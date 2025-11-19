#!/usr/bin/env node
import assert from 'assert';
import { resolveGcpContext } from './gcp-context.js';

async function run() {
  const origEnv = { ...process.env };
  try {
    process.env.GCP_PROJECT_ID = '';
    process.env.PROJECT_ID = '';
    process.env.REGION = '';

    // 1) Flags override
    const ctx1 = await resolveGcpContext({ projectFlag: 'proj-flags', regionFlag: 'us-central1', requireRegion: true });
    assert.equal(ctx1.projectId, 'proj-flags');
    assert.equal(ctx1.region, 'us-central1');

    // 2) Env fallback when flags absent (simulate by short-circuiting gcloud via empty results)
    process.env.GCP_PROJECT_ID = 'proj-env';
    process.env.REGION = 'europe-west1';
    const ctx2 = await resolveGcpContext({ projectFlag: null, regionFlag: null, requireRegion: true, allowGcloud: false });
    assert.ok(ctx2.projectId);
    assert.ok(ctx2.region);

    // 3) Missing project should throw
    process.env.GCP_PROJECT_ID = '';
    process.env.PROJECT_ID = '';
    let threw = false;
    try {
      await resolveGcpContext({ projectFlag: null, regionFlag: 'us-central1', requireRegion: true, allowGcloud: false });
    } catch {
      threw = true;
    }
    assert.equal(threw, true);

    console.log('[OK] gcp-context precedence tests passed');
  } finally {
    process.env = origEnv;
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
