/**
 * Unit tests for validation utilities
 * Tests 1Password email validation and type checking
 * Run with: node lib/validation.test.js
 */

import { strict as assert } from 'assert';
import { missingFields, typeIssues } from './validation.js';

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

// Test suite: 1Password email validation
suite('typeIssues - 1Password email validation', () => {
  test('should accept valid plain email', () => {
    const parsed = { onepass: 'user@example.com' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should accept email with plus sign', () => {
    const parsed = { onepass: 'support+k1893@doss.com' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should accept email with hyphen', () => {
    const parsed = { onepass: 'user-name@example.com' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should accept email with dots', () => {
    const parsed = { onepass: 'user.name@example.co.uk' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should accept email with numbers', () => {
    const parsed = { onepass: 'support1893@doss.com' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should accept email wrapped in bold formatting', () => {
    const parsed = { onepass: '*user@example.com*' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should accept email wrapped in italic formatting', () => {
    const parsed = { onepass: '_user@example.com_' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should accept Slack mailto format', () => {
    const parsed = { onepass: '<mailto:user@example.com|user@example.com>' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should accept Slack mailto with bold formatting', () => {
    const parsed = { onepass: '*<mailto:support+k1893@doss.com|support+k1893@doss.com>*' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should accept angle-bracket wrapped email', () => {
    const parsed = { onepass: '<user@example.com>' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should extract and accept email from text with extra words', () => {
    const parsed = { onepass: 'an email email@acme.corp or hint' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should extract and accept email from text at beginning', () => {
    const parsed = { onepass: 'user@example.com is the email' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should extract and accept email from text at end', () => {
    const parsed = { onepass: 'the email is user@example.com' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should extract and accept email with plus sign from text', () => {
    const parsed = { onepass: 'contact support+k1893@doss.com for help' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should accept email with whitespace around it', () => {
    const parsed = { onepass: '  user@example.com  ' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 0, 'Should have no validation issues');
  });

  test('should reject text without valid email', () => {
    const parsed = { onepass: 'just some text without email' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 1, 'Should have one validation issue');
    assert(issues[0].includes('1Password field must be an email address'));
  });

  test('should reject invalid email format', () => {
    const parsed = { onepass: 'not-an-email' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 1, 'Should have one validation issue');
    assert(issues[0].includes('1Password field must be an email address'));
  });

  test('should reject email without domain', () => {
    const parsed = { onepass: 'user@' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 1, 'Should have one validation issue');
    assert(issues[0].includes('1Password field must be an email address'));
  });

  test('should reject email without @ symbol', () => {
    const parsed = { onepass: 'userexample.com' };
    const issues = typeIssues(parsed);
    assert.equal(issues.length, 1, 'Should have one validation issue');
    assert(issues[0].includes('1Password field must be an email address'));
  });

  test('should handle empty string', () => {
    const parsed = { onepass: '' };
    const issues = typeIssues(parsed);
    // Empty onepass is caught by missingFields, not typeIssues
    assert.equal(issues.length, 0, 'Should have no type issues for empty string');
  });

  test('should handle undefined onepass', () => {
    const parsed = {};
    const issues = typeIssues(parsed);
    // Undefined onepass is caught by missingFields, not typeIssues
    assert.equal(issues.length, 0, 'Should have no type issues for undefined');
  });
});

// Test suite: missingFields
suite('missingFields - 1Password field', () => {
  test('should detect missing 1Password field', () => {
    const parsed = {
      priority: 'P1',
      issue: 'Test issue',
      replicate: 'Steps',
      customer: 'Acme Corp',
      // onepass is missing
    };
    const missing = missingFields(parsed);
    assert(missing.includes('1Password (email)'), 'Should detect missing 1Password field');
  });

  test('should not report 1Password as missing when present', () => {
    const parsed = {
      priority: 'P1',
      issue: 'Test issue',
      replicate: 'Steps',
      customer: 'Acme Corp',
      onepass: 'user@example.com',
    };
    const missing = missingFields(parsed);
    assert(!missing.includes('1Password (email)'), 'Should not report 1Password as missing');
  });

  test('should detect missing 1Password when empty string', () => {
    const parsed = {
      priority: 'P1',
      issue: 'Test issue',
      replicate: 'Steps',
      customer: 'Acme Corp',
      onepass: '',
    };
    const missing = missingFields(parsed);
    assert(missing.includes('1Password (email)'), 'Should detect empty 1Password field');
  });
});

// Test suite: Combined validation (missing + type issues)
suite('Combined validation scenarios', () => {
  test('should report both missing and type issues separately', () => {
    const parsed = {
      priority: '',  // missing
      issue: 'Test issue',
      replicate: 'Steps',
      customer: 'Acme Corp',
      onepass: 'not-an-email',  // invalid type
    };
    const missing = missingFields(parsed);
    const issues = typeIssues(parsed);
    
    assert(missing.includes('Priority (P0/P1/P2)'), 'Should detect missing priority');
    assert.equal(issues.length, 1, 'Should have one type issue');
    assert(issues[0].includes('1Password field must be an email address'));
  });

  test('should accept all valid fields including extracted email', () => {
    const parsed = {
      priority: 'P1',
      issue: 'Production API timeout',
      replicate: 'Call /checkout endpoint',
      customer: 'Acme Corp',
      onepass: 'contact support+k1893@acme.com for access',  // email extracted from text
      needed: new Date(),
      neededValid: true,
    };
    const missing = missingFields(parsed);
    const issues = typeIssues(parsed);
    
    assert.equal(missing.length, 0, 'Should have no missing fields');
    assert.equal(issues.length, 0, 'Should have no type issues');
  });

  test('should fail validation when email cannot be extracted', () => {
    const parsed = {
      priority: 'P1',
      issue: 'Production API timeout',
      replicate: 'Call /checkout endpoint',
      customer: 'Acme Corp',
      onepass: 'vault password hint only',  // no email
      needed: new Date(),
      neededValid: true,
    };
    const missing = missingFields(parsed);
    const issues = typeIssues(parsed);
    
    assert.equal(missing.length, 0, 'Should have no missing fields (field is present)');
    assert.equal(issues.length, 1, 'Should have one type issue');
    assert(issues[0].includes('1Password field must be an email address'));
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
