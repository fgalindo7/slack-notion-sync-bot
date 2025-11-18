/**
 * Unit tests for NotionSchemaCache
 * Run with: node lib/schema-cache.test.js
 */
import { strict as assert } from 'assert';
import { NotionSchemaCache } from './schema-cache.js';

let total = 0, passed = 0, failed = 0;
const test = (name, fn) => { total++; try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}`); console.log(`    Error: ${e.message}`);} };
const suite = (name, fn) => { console.log(`\n${name}:`); fn(); };

suite('NotionSchemaCache', () => {
  test('fetches once when not expired', async () => {
    let calls = 0;
    const cache = new NotionSchemaCache({ ttl: 500 });
    const fetchFn = async () => { calls++; return { a: 1 }; };
    const s1 = await cache.get(fetchFn);
    const s2 = await cache.get(fetchFn);
    assert.equal(calls, 1, 'should call fetchFn only once');
    assert.deepEqual(s1, { a: 1 });
    assert.deepEqual(s2, { a: 1 });
  });

  test('refreshes after TTL expiry', async () => {
    let calls = 0;
    const cache = new NotionSchemaCache({ ttl: 20 });
    const fetchFn = async () => { calls++; return { v: calls }; };
    const s1 = await cache.get(fetchFn);
    await new Promise(r => setTimeout(r, 30));
    const s2 = await cache.get(fetchFn);
    assert.equal(calls, 2, 'should call fetchFn again after TTL');
    assert.notDeepEqual(s1, s2);
  });

  test('getCurrent and clear work as expected', async () => {
    const cache = new NotionSchemaCache({ ttl: 1000 });
    assert.equal(cache.getCurrent(), null);
    await cache.refresh(async () => ({ x: 1 }));
    assert.deepEqual(cache.getCurrent(), { x: 1 });
    cache.clear();
    assert.equal(cache.getCurrent(), null);
  });
});

console.log(`\n${'='.repeat(60)}`);
console.log('Test Summary:');
console.log(`  Total:  ${total}`);
console.log(`  Passed: ${passed} ${passed === total ? '✓' : ''}`);
console.log(`  Failed: ${failed} ${failed > 0 ? '✗' : ''}`);
console.log(`${'='.repeat(60)}\n`);
process.exit(failed ? 1 : 0);
