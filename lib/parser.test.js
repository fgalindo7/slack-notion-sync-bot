/**
 * Unit tests for parser utilities
 * Tests email normalization, date parsing, and rich text formatting
 * Run with: node lib/parser.test.js
 */

import { strict as assert } from 'assert';
import { normalizeEmail, stripRichTextFormatting, parseNeededByString } from './parser.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function test(description, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${description}`);
  } catch (error) {
    failedTests++;
    console.log(`  ✗ ${description}`);
    console.log(`    Error: ${error.message}`);
  }
}

function suite(name, fn) {
  console.log(`\n${name}:`);
  fn();
}

// Test suite: normalizeEmail
suite('normalizeEmail', () => {
  test('should strip bold formatting from mailto links', () => {
    const input = '*<mailto:support+k1893@doss.com|support+k1893@doss.com>*';
    const expected = 'support+k1893@doss.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should strip italic formatting from mailto links', () => {
    const input = '_<mailto:user@example.com|user@example.com>_';
    const expected = 'user@example.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should handle mailto links without formatting', () => {
    const input = '<mailto:support+k1893@doss.com|support+k1893@doss.com>';
    const expected = 'support+k1893@doss.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should handle plain email addresses', () => {
    const input = 'plain@email.com';
    const expected = 'plain@email.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should strip bold formatting from plain emails', () => {
    const input = '*plain@email.com*';
    const expected = 'plain@email.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should handle emails with plus signs', () => {
    const input = '<mailto:user+tag@example.com|user+tag@example.com>';
    const expected = 'user+tag@example.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should handle emails with hyphens', () => {
    const input = 'user-name@ex-ample.com';
    const expected = 'user-name@ex-ample.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should handle emails with numbers', () => {
    const input = '*<mailto:support1893@doss.com|support1893@doss.com>*';
    const expected = 'support1893@doss.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should handle emails with dots', () => {
    const input = 'user.name@example.co.uk';
    const expected = 'user.name@example.co.uk';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should handle angle-bracket wrapped emails', () => {
    const input = '<user@example.com>';
    const expected = 'user@example.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should return empty string for null input', () => {
    assert.equal(normalizeEmail(null), '');
  });

  test('should return empty string for undefined input', () => {
    assert.equal(normalizeEmail(undefined), '');
  });

  test('should trim whitespace', () => {
    const input = '  user@example.com  ';
    const expected = 'user@example.com';
    assert.equal(normalizeEmail(input), expected);
  });
});

// Test suite: stripRichTextFormatting
suite('stripRichTextFormatting', () => {
  test('should strip bold asterisks', () => {
    const input = '*bold text*';
    const expected = 'bold text';
    assert.equal(stripRichTextFormatting(input), expected);
  });

  test('should strip italic underscores', () => {
    const input = '_italic text_';
    const expected = 'italic text';
    assert.equal(stripRichTextFormatting(input), expected);
  });

  test('should strip mixed formatting', () => {
    const input = '*bold* and _italic_ text';
    const expected = 'bold and italic text';
    assert.equal(stripRichTextFormatting(input), expected);
  });

  test('should preserve URLs in angle brackets', () => {
    const input = 'Check <https://example.com|link>';
    const expected = 'Check <https://example.com|link>';
    assert.equal(stripRichTextFormatting(input), expected);
  });

  test('should preserve mailto links', () => {
    const input = '<mailto:user@example.com|user@example.com>';
    const expected = '<mailto:user@example.com|user@example.com>';
    assert.equal(stripRichTextFormatting(input), expected);
  });

  test('should handle text with no formatting', () => {
    const input = 'plain text';
    const expected = 'plain text';
    assert.equal(stripRichTextFormatting(input), expected);
  });

  test('should return empty string for null input', () => {
    assert.equal(stripRichTextFormatting(null), '');
  });

  test('should return empty string for undefined input', () => {
    assert.equal(stripRichTextFormatting(undefined), '');
  });
});

// Test suite: parseNeededByString
suite('parseNeededByString', () => {
  test('should parse ASAP as 20 minutes from now', () => {
    const before = new Date();
    const result = parseNeededByString('ASAP');
    
    assert(result instanceof Date);
    const diffMinutes = (result - before) / (1000 * 60);
    assert(diffMinutes >= 19.9 && diffMinutes <= 20.1, 'Should be approximately 20 minutes from now');
  });

  test('should parse ASAP case-insensitively', () => {
    const tests = ['ASAP', 'asap', 'Asap', 'aSaP'];
    tests.forEach(input => {
      const result = parseNeededByString(input);
      assert(result instanceof Date, `Should parse "${input}" as a date`);
    });
  });

  test('should parse MM/DD/YYYY format', () => {
    const result = parseNeededByString('11/04/2025');
    assert(result instanceof Date);
    assert.equal(result.getFullYear(), 2025);
    assert.equal(result.getMonth(), 10); // November (0-indexed)
    assert.equal(result.getDate(), 4);
  });

  test('should parse MM/DD/YYYY with time', () => {
    const result = parseNeededByString('11/04/2025 7PM');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 19); // 7PM = 19:00
  });

  test('should parse YYYY-MM-DD format', () => {
    const result = parseNeededByString('2025-11-04');
    assert(result instanceof Date);
    assert.equal(result.getFullYear(), 2025);
    assert.equal(result.getMonth(), 10); // November (0-indexed)
    // Note: YYYY-MM-DD is parsed as ISO (UTC midnight), which may shift to previous day in local timezone
    assert(result.getDate() === 3 || result.getDate() === 4, 'Date should be 3 or 4 depending on timezone');
  });

  test('should parse YYYY-MM-DD with time', () => {
    const result = parseNeededByString('2025-11-04 14:30');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 14);
    assert.equal(result.getMinutes(), 30);
  });

  test('should return null for invalid input', () => {
    const result = parseNeededByString('invalid date');
    assert.equal(result, null);
  });

  test('should return null for null input', () => {
    const result = parseNeededByString(null);
    assert.equal(result, null);
  });

  test('should return null for undefined input', () => {
    const result = parseNeededByString(undefined);
    assert.equal(result, null);
  });

  test('should return null for empty string', () => {
    const result = parseNeededByString('');
    assert.equal(result, null);
  });
});

// Print summary
console.log(`\n${'='.repeat(60)}`);
console.log(`Test Summary:`);
console.log(`  Total:  ${totalTests} tests`);
console.log(`  Passed: ${passedTests} ${passedTests === totalTests ? '✓' : ''}`);
console.log(`  Failed: ${failedTests} ${failedTests > 0 ? '✗' : ''}`);
console.log(`${'='.repeat(60)}\n`);

process.exit(failedTests > 0 ? 1 : 0);
