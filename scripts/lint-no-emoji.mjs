#!/usr/bin/env node
/**
 * Fail if any non-ASCII emoji characters appear in code scripts.
 * Scans JS/MJS in scripts and lib, plus shell scripts.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const globs = [
  'scripts/**/*.mjs',
  'scripts/**/*.js',
  'scripts/**/*.sh',
  'lib/**/*.js',
  'app.js',
];

function listFiles(pattern) {
  const out = execSync(`ls -1 ${pattern} 2>/dev/null || true`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.split(/\r?\n/).filter(Boolean);
}

// Unicode property for pictographic emoji
const emojiRegex = /\p{Extended_Pictographic}/u;
let failed = 0;

for (const pattern of globs) {
  for (const file of listFiles(pattern)) {
    const text = readFileSync(file, 'utf8');
    if (emojiRegex.test(text)) {
      // find lines with emoji
      const lines = text.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (emojiRegex.test(line)) {
          console.error(`${file}:${idx + 1}: contains emoji`);
          failed++;
        }
      });
    }
  }
}

if (failed > 0) {
  console.error(`\nFound ${failed} emoji occurrence(s). Please replace with ASCII icons.`);
  process.exit(1);
}
console.log('No emojis found in script files.');
