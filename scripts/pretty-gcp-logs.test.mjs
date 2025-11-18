#!/usr/bin/env node
/** Simple functional test for scripts/pretty-gcp-logs.mjs in batch mode */
import { spawn } from 'child_process';

function runBatchTest() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/pretty-gcp-logs.mjs', '--batch'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });

    const sample = [
      {
        timestamp: '2025-11-18T01:06:01.392556Z',
        severity: 'INFO',
        jsonPayload: {
          time: 1763427961390,
          level: 'info',
          severity: 'INFO',
          src: 'slack',
          event: 'message_replied',
          msg: 'Parsed @auto block',
          meta: { channel: '#incidents', requestId: 'r-xyz' }
        }
      },
      {
        timestamp: '2025-11-18T01:06:06.226535Z',
        severity: 'INFO',
        jsonPayload: {
          time: 1763427966225,
          level: 'info',
          severity: 'INFO',
          src: 'notion',
          event: 'upsert_page',
          msg: 'Notion page created',
          meta: { pageUrl: 'https://notion.so/test' }
        }
      }
    ];

    child.on('exit', (code) => {
      const ok = code === 0 && out.includes('INFO') && out.includes('Parsed @auto block') && out.includes('Notion page created');
      if (!ok) {
        reject(new Error('pretty-gcp-logs batch test failed. Output:\n' + out + '\nErrors:\n' + err));
      } else {
        resolve();
      }
    });

    child.stdin.end(JSON.stringify(sample));
  });
}

(async () => {
  let failed = 0;
  const pass = (name) => console.log(`✓ ${name}`);
  const fail = (name, e) => {
    failed++;
    console.error(`✗ ${name}`);
    if (e) {
      console.error(String(e.message || e));
    }
  };

  try {
    await runBatchTest();
    pass('pretty-gcp-logs batch mode formats JSON array');
  } catch (e) { fail('pretty-gcp-logs batch mode formats JSON array', e); }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  } else {
    console.log('\nAll pretty-gcp-logs tests passed.');
  }
})();
