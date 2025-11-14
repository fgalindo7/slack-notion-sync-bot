/**
 * Unit tests for parser utilities
 * Tests email normalization, date parsing, and rich text formatting
 * Run with: node lib/parser.test.js
 */

import { strict as assert } from 'assert';
import { normalizeEmail, stripRichTextFormatting, parseNeededByString, parseAutoBlock } from './parser.js';

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

  test('should extract email from text with extra words', () => {
    const input = 'an email email@acme.corp or hint';
    const expected = 'email@acme.corp';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should extract email from text at the beginning', () => {
    const input = 'user@example.com is the email';
    const expected = 'user@example.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should extract email from text at the end', () => {
    const input = 'the email is user@example.com';
    const expected = 'user@example.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should extract complex email with plus sign from text', () => {
    const input = 'contact support+k1893@doss.com for help';
    const expected = 'support+k1893@doss.com';
    assert.equal(normalizeEmail(input), expected);
  });

  test('should extract first email if multiple are present', () => {
    const input = 'email first@example.com or second@example.com';
    const expected = 'first@example.com';
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

  // Tests for lowercase am/pm
  test('should parse lowercase am', () => {
    const result = parseNeededByString('11/13/2025 7am');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 7);
  });

  test('should parse lowercase pm', () => {
    const result = parseNeededByString('11/13/2025 7pm');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 19);
  });

  test('should parse uppercase AM', () => {
    const result = parseNeededByString('11/13/2025 7AM');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 7);
  });

  test('should parse uppercase PM', () => {
    const result = parseNeededByString('11/13/2025 7PM');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 19);
  });

  // Tests for am/pm with periods
  test('should parse a.m. with lowercase periods', () => {
    const result = parseNeededByString('11/13/2025 7a.m.');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 7);
  });

  test('should parse p.m. with lowercase periods', () => {
    const result = parseNeededByString('11/13/2025 7p.m.');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 19);
  });

  test('should parse A.M. with uppercase periods', () => {
    const result = parseNeededByString('11/13/2025 7A.M.');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 7);
  });

  test('should parse P.M. with uppercase periods', () => {
    const result = parseNeededByString('11/13/2025 7P.M.');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 19);
  });

  test('should parse mixed case p.M.', () => {
    const result = parseNeededByString('11/13/2025 7p.M.');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 19);
  });

  // Tests for military time
  test('should parse 4-digit military time', () => {
    const result = parseNeededByString('11/13/2025 1432');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 14);
    assert.equal(result.getMinutes(), 32);
  });

  test('should parse 3-digit military time', () => {
    const result = parseNeededByString('11/13/2025 432');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 4);
    assert.equal(result.getMinutes(), 32);
  });

  test('should parse single digit as military time (assume 0800)', () => {
    const result = parseNeededByString('11/13/2025 8');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 8);
    assert.equal(result.getMinutes(), 0);
  });

  test('should parse two digits as military time (10 = 1000)', () => {
    const result = parseNeededByString('11/13/2025 10');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 10);
    assert.equal(result.getMinutes(), 0);
  });

  test('should parse midnight military time (0000)', () => {
    const result = parseNeededByString('11/13/2025 0000');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 0);
    assert.equal(result.getMinutes(), 0);
  });

  test('should parse noon military time (1200)', () => {
    const result = parseNeededByString('11/13/2025 1200');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 12);
    assert.equal(result.getMinutes(), 0);
  });

  test('should handle 12am (midnight)', () => {
    const result = parseNeededByString('11/13/2025 12am');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 0);
  });

  test('should handle 12pm (noon)', () => {
    const result = parseNeededByString('11/13/2025 12pm');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 12);
  });

  // Tests for YYYY-MM-DD format with new features
  test('should parse YYYY-MM-DD with lowercase pm', () => {
    const result = parseNeededByString('2025-11-13 7pm');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 19);
  });

  test('should parse YYYY-MM-DD with p.m.', () => {
    const result = parseNeededByString('2025-11-13 7p.m.');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 19);
  });

  test('should parse YYYY-MM-DD with military time', () => {
    const result = parseNeededByString('2025-11-13 1432');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 14);
    assert.equal(result.getMinutes(), 32);
  });

  test('should parse YYYY-MM-DD with single digit as military', () => {
    const result = parseNeededByString('2025-11-13 8');
    assert(result instanceof Date);
    assert.equal(result.getHours(), 8);
  });
});

// Test suite: parseAutoBlock
suite('parseAutoBlock', () => {
  test('should parse complete message with all fields', () => {
    const message = `@auto
Priority: P1
Issue: Production API timeout
How to replicate: Call /checkout endpoint
Customer: Acme Corp
1Password: support@acme.com
Needed by: ASAP
Relevant Links: https://status.acme.io`;

    const result = parseAutoBlock(message);
    
    assert.equal(result.priority, 'P1');
    assert.equal(result.issue, 'Production API timeout');
    assert.equal(result.replicate, 'Call /checkout endpoint');
    assert.equal(result.customer, 'Acme Corp');
    assert.equal(result.onepass, 'support@acme.com');
    assert(result.needed instanceof Date);
    assert.equal(result.neededValid, true);
    assert.equal(result.urls.length, 1);
    assert.equal(result.urls[0], 'https://status.acme.io');
  });

  test('should handle P0 priority', () => {
    const message = `@auto
Priority: P0
Issue: Critical bug`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P0');
  });

  test('should handle P2 priority', () => {
    const message = `@auto
Priority: P2
Issue: Minor issue`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P2');
  });

  test('should strip bold formatting from priority (**P1**)', () => {
    const message = `@auto
Priority: **P1**
Issue: Test`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P1');
  });

  test('should strip italic formatting from priority (*P2*)', () => {
    const message = `@auto
Priority: *P2*
Issue: Test`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P2');
  });

  test('should strip underscore formatting from priority (__P0__)', () => {
    const message = `@auto
Priority: __P0__
Issue: Test`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P0');
  });

  test('should strip underscore italic from priority (_P1_)', () => {
    const message = `@auto
Priority: _P1_
Issue: Test`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P1');
  });

  test('should handle lowercase priority (p2)', () => {
    const message = `@auto
Priority: p2
Issue: Test`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P2');
  });

  test('should handle mixed formatting and lowercase (*p1*)', () => {
    const message = `@auto
Priority: *p1*
Issue: Test`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P1');
  });

  test('should default invalid priority to empty string', () => {
    const message = `@auto
Priority: P5
Issue: Test`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, '');
  });

  test('should handle missing priority as empty string', () => {
    const message = `@auto
Issue: Test issue`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, '');
  });

  test('should parse ASAP as needed by date', () => {
    const message = `@auto
Priority: P1
Issue: Test
Needed by: ASAP`;
    const result = parseAutoBlock(message);
    assert(result.needed instanceof Date);
    assert.equal(result.neededValid, true);
    // ASAP should be ~20 minutes from now
    const now = new Date();
    const diff = result.needed - now;
    assert(diff > 18 * 60 * 1000 && diff < 22 * 60 * 1000, 'ASAP should be ~20 minutes from now');
  });

  test('should parse date formats', () => {
    const message = `@auto
Priority: P1
Issue: Test
Needed by: 11/15/2025`;
    const result = parseAutoBlock(message);
    assert(result.needed instanceof Date);
    assert.equal(result.neededValid, true);
  });

  test('should handle invalid date gracefully', () => {
    const message = `@auto
Priority: P1
Issue: Test
Needed by: invalid-date`;
    const result = parseAutoBlock(message);
    assert(result.needed instanceof Date); // Falls back to default
    assert.equal(result.neededValid, false);
    assert.equal(result.neededRaw, 'invalid-date');
  });

  test('should extract multiple URLs from relevant links', () => {
    const message = `@auto Priority: P1 Issue: Test
Relevant Links: https://example.com https://status.io https://docs.example.com/page`;
    
    const result = parseAutoBlock(message);
    assert.equal(result.urls.length, 3);
    assert(result.urls.includes('https://example.com'));
    assert(result.urls.includes('https://status.io'));
    assert(result.urls.includes('https://docs.example.com/page'));
  });

  test('should extract URLs including Slack-formatted ones', () => {
    const message = `@auto
Priority: P1
Issue: Test
Relevant Links: <https://example.com|example>`;
    const result = parseAutoBlock(message);
    assert(result.urls.length >= 1);
    assert(result.linksText.includes('https://example.com'));
  });

  test('should handle missing fields', () => {
    const message = `@auto
Priority: P1
Issue: Basic test`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P1');
    assert.equal(result.issue, 'Basic test');
    assert.equal(result.replicate, '');
    assert.equal(result.customer, '');
    assert.equal(result.onepass, '');
  });

  test('should handle case-insensitive field labels', () => {
    const message = `@auto
PRIORITY: P1
ISSUE: Test
how to REPLICATE: Steps
CUSTOMER: Test Corp`;
    
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P1');
    assert.equal(result.issue, 'Test');
    assert.equal(result.replicate, 'Steps');
    assert.equal(result.customer, 'Test Corp');
  });

  test('should return raw email from 1Password field', () => {
    const message = `@auto
Priority: P1
Issue: Test
1Password: *<mailto:user@test.com|user@test.com>*`;
    const result = parseAutoBlock(message);
    // parseAutoBlock returns the raw field value; normalizeEmail is applied later
    assert(result.onepass.includes('user@test.com'));
  });

  test('should handle empty message', () => {
    const result = parseAutoBlock('');
    assert.equal(result.priority, '');
    assert.equal(result.issue, '');
    assert(result.needed instanceof Date);
  });

  test('should handle message without @auto trigger', () => {
    const message = `Priority: P1
Issue: Test without trigger`;
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P1');
    assert.equal(result.issue, 'Test without trigger');
  });

  test('should preserve neededRaw field', () => {
    const message = `@auto
Priority: P1
Issue: Test
Needed by: 11/15/2025 5PM`;
    const result = parseAutoBlock(message);
    assert.equal(result.neededRaw, '11/15/2025 5PM');
  });

  test('should handle whitespace in field values', () => {
    const message = `@auto
Priority:  P1  
Issue:   Production issue with spaces   
Customer:  Acme Corp  `;
    
    const result = parseAutoBlock(message);
    assert.equal(result.priority, 'P1');
    assert.equal(result.issue, 'Production issue with spaces');
    assert.equal(result.customer, 'Acme Corp');
  });

  test('should strip bold formatting from needed by date', () => {
    const message = `@auto
Priority: P1
Issue: Test
Needed by: *11/13/2025 6*`;
    const result = parseAutoBlock(message);
    assert.equal(result.neededValid, true);
    assert.equal(result.needed.getHours(), 6);
  });

  test('should strip italic formatting from needed by date', () => {
    const message = `@auto
Priority: P1
Issue: Test
Needed by: _11/13/2025 7pm_`;
    const result = parseAutoBlock(message);
    assert.equal(result.neededValid, true);
    assert.equal(result.needed.getHours(), 19);
  });

  test('should strip mixed formatting from needed by date with time', () => {
    const message = `@auto
Priority: P1
Issue: Test
Needed by: *11/13/2025* _1432_`;
    const result = parseAutoBlock(message);
    assert.equal(result.neededValid, true);
    assert.equal(result.needed.getHours(), 14);
    assert.equal(result.needed.getMinutes(), 32);
  });

  test('should handle bold ASAP', () => {
    const message = `@auto
Priority: P1
Issue: Test
Needed by: *ASAP*`;
    const result = parseAutoBlock(message);
    assert.equal(result.neededValid, true);
    assert(result.needed instanceof Date);
    const diffMinutes = (result.needed - new Date()) / (1000 * 60);
    assert(diffMinutes >= 19.5 && diffMinutes <= 20.5);
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
