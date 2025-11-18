/**
 * Unit tests for config loader
 * Run with: node lib/config.test.js
 */
import { strict as assert } from 'assert';
import { loadConfig } from './config.js';

let total = 0, passed = 0, failed = 0;
const test = (name, fn) => { total++; try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}`); console.log(`    Error: ${e.message}`);} };
const suite = (name, fn) => { console.log(`\n${name}:`); fn(); };

function withEnv(newEnv, fn) {
  const orig = { ...process.env };
  Object.assign(process.env, newEnv);
  try { return fn(); } finally { process.env = orig; }
}

suite('config.loadConfig', () => {
  test('loads minimal single-channel config and clamps defaults', () => {
    withEnv({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_APP_LEVEL_TOKEN: 'xapp-test',
      NOTION_TOKEN: 'secret_test',
      WATCH_CHANNEL_ID: 'C123',
      NOTION_DATABASE_ID: 'db123',
      DEFAULT_NEEDED_BY_DAYS: '999',
      DEFAULT_NEEDED_BY_HOUR: '99'
    }, () => {
      const cfg = loadConfig();
      assert.equal(cfg.notion.multiChannelMode, false);
      assert.equal(cfg.notion.databaseId, 'db123');
      // Clamps applied
      assert.equal(cfg.defaults.neededByDays, 30);
      assert.equal(cfg.defaults.neededByHour, 17);
      assert.equal(cfg.server.port, 1987);
      assert.equal(cfg.server.healthPort, 1987);
    });
  });

  test('invalid CHANNEL_MAPPINGS_JSON throws', () => {
    withEnv({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_APP_LEVEL_TOKEN: 'xapp-test',
      NOTION_TOKEN: 'secret_test',
      CHANNEL_DB_MAPPINGS: 'true',
      CHANNEL_MAPPINGS_JSON: '{bad json]'
    }, () => {
      let threw = false;
      try { loadConfig(); } catch { threw = true; }
      assert.equal(threw, true);
    });
  });

  test('valid CHANNEL_MAPPINGS_JSON loads channel mappings', () => {
    const mappings = {
      databases: [ { databaseId: 'db1', channels: [ { channelId: 'C1' }, { channelId: 'C2' } ] } ]
    };
    withEnv({
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_APP_LEVEL_TOKEN: 'xapp-test',
      NOTION_TOKEN: 'secret_test',
      CHANNEL_DB_MAPPINGS: 'true',
      CHANNEL_MAPPINGS_JSON: JSON.stringify(mappings)
    }, () => {
      const cfg = loadConfig();
      assert.equal(cfg.notion.multiChannelMode, true);
      assert.equal(cfg.notion.channelMappings.length, 2);
      assert.equal(cfg.notion.dbToChannels['db1'].length, 2);
    });
  });
});

console.log(`\n${'='.repeat(60)}`);
console.log('Test Summary:');
console.log(`  Total:  ${total}`);
console.log(`  Passed: ${passed} ${passed === total ? '✓' : ''}`);
console.log(`  Failed: ${failed} ${failed > 0 ? '✗' : ''}`);
console.log(`${'='.repeat(60)}\n`);
process.exit(failed ? 1 : 0);
