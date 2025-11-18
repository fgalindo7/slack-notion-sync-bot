/**
 * Unit tests for BotMetrics
 * Run with: node lib/metrics.test.js
 */
import { strict as assert } from 'assert';
import { BotMetrics } from './metrics.js';

let total = 0, passed = 0, failed = 0;
const test = (name, fn) => {
  total++; 
  try { fn(); passed++; console.log(`  ✓ ${name}`); } 
  catch (e) { failed++; console.log(`  ✗ ${name}`); console.log(`    Error: ${e.message}`); }
};
const suite = (name, fn) => { console.log(`\n${name}:`); fn(); };

suite('BotMetrics', () => {
  test('initial state has 0% success rate and uptime increases', async () => {
    const m = new BotMetrics();
    const j1 = m.toJSON();
    assert.equal(j1.successRate, '0%');
    const up1 = j1.uptimeSeconds;
    await new Promise(r => setTimeout(r, 15));
    const up2 = m.toJSON().uptimeSeconds;
    assert(up2 >= up1, 'uptime should be non-decreasing');
  });

  test('increments and success rate calculation', () => {
    const m = new BotMetrics();
    // Process 10 messages, 2 fail
    for (let i = 0; i < 10; i++) { m.increment('messagesProcessed'); }
    for (let i = 0; i < 2; i++) { m.increment('messagesFailed'); }
    const rate = parseFloat(m.getSuccessRate());
    assert(rate >= 79.99 && rate <= 80.01, 'success rate should be ~80%');
    const j = m.toJSON();
    assert(j.successRate.endsWith('%'));
  });

  test('safe increment on unknown metric does not throw', () => {
    const m = new BotMetrics();
    m.increment('notARealMetric');
  });
});

console.log(`\n${'='.repeat(60)}`);
console.log('Test Summary:');
console.log(`  Total:  ${total}`);
console.log(`  Passed: ${passed} ${passed === total ? '✓' : ''}`);
console.log(`  Failed: ${failed} ${failed > 0 ? '✗' : ''}`);
console.log(`${'='.repeat(60)}\n`);
process.exit(failed ? 1 : 0);
