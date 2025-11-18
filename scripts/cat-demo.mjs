#!/usr/bin/env node
/**
 * Subtle / gentle animated cat demo (standalone)
 * Default mode: gentle (slow, minimal motion, occasional blink + lick)
 * Active mode: faster, frequent motions (legacy style)
 * Usage:
 *   npm run cat:demo                # gentle defaults
 *   npm run cat:demo --mode=active  # legacy frequent motion
 *   npm run cat:demo --interval=500 # override interval
 *   npm run cat:demo --cycles=3     # number of cycles
 *   (yawn removed) blink-only modes; long blink in gentle
 */
import { catFrames } from '../lib/ascii-art.js';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const getFlag = (name, def) => {
  const raw = args.find(a => a.startsWith(`--${name}=`));
  if (!raw) {
    return def;
  }
  const v = raw.split('=')[1];
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
};

const mode = getFlag('mode', 'gentle');
const gentle = mode === 'gentle' || hasFlag('gentle');
// Yawn removed; no flags processed for yawn

// Interval (ms) defaults differ per mode
const interval = getFlag('interval', gentle ? 650 : 120);
// Fewer cycles for gentle by default
const cycles = getFlag('cycles', gentle ? 3 : 5);

const color = '\x1b[36m'; // cyan
const reset = '\x1b[0m';

// Gentle motion blocks: lots of stillness, sparse actions
const gentleMotionsBase = [
  { name: 'calm',  frames: ['normal','normal','normal','normal','normal'] },
  { name: 'blink', frames: ['normal','blink','blink','blink','normal'] }, // extended closed
  { name: 'rest',  frames: ['normal','normal','normal'] },
  { name: 'blink', frames: ['normal','blink','blink','normal'] },
  { name: 'calm',  frames: ['normal','normal','normal','normal'] }
];

// Append yawn if requested (once per cycle)
const gentleMotions = gentleMotionsBase; // no yawn appended

// Active (legacy) frequent motion sequence
const activeMotions = [
  { name: 'blink', frames: ['normal','blink','normal','blink','blink','normal'] }
];

const motions = gentle ? gentleMotions : activeMotions;

let cycleCount = 0;
let motionIndex = 0;
let frameIndex = 0;
let frameNumber = 0;

function renderFrame(key) {
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen
  const label = motions[motionIndex].name.toUpperCase();
  console.log(`${color}ASCII Cat Demo (${gentle ? 'gentle' : 'active'}) | cycle ${cycleCount + 1}/${cycles} | ${label} (${frameIndex + 1}/${motions[motionIndex].frames.length})${reset}`);
  console.log('');
  (catFrames[key] || catFrames.normal).forEach(line => console.log(color + line + reset));
  console.log(`\nTotal frames: ${++frameNumber}`);
}

function advance() {
  const motion = motions[motionIndex];
  renderFrame(motion.frames[frameIndex]);
  frameIndex++;
  if (frameIndex >= motion.frames.length) {
    motionIndex++;
    frameIndex = 0;
    if (motionIndex >= motions.length) {
      motionIndex = 0;
      cycleCount++;
      if (cycleCount >= cycles) {
        console.log('\nDemo complete (cat returns to quiet watch).');
        return;
      }
    }
  }
  setTimeout(advance, interval);
}

advance();
