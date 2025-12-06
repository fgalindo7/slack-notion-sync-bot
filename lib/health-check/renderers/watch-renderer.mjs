/**
 * @fileoverview Watch mode renderer with animation
 * @author Francisco Galindo
 */

import { TerminalRenderer } from './terminal-renderer.mjs';
import { colors, drawHeader } from '../formatters.mjs';
import { catFrames } from '../../ascii-art.js';

/**
 * Watch renderer with animated cat and periodic refresh
 */
export class WatchRenderer extends TerminalRenderer {
  constructor(config = {}, flags = {}) {
    super(config, flags);
    this.animTimer = null;
    this.countdownTimer = null;
    this.refreshTimer = null;
    this.isRefreshing = false;
    this.secondsUntilRefresh = Math.floor(flags.interval / 1000);
  }

  async render(results) {
    // Don't clear on first render in watch mode, just render dashboard
    this.renderDashboard(results);
  }

  renderDashboard(results) {
    // In watch mode, leave space for the animated cat at the top
    console.log('\n\n\n');

    // Draw header
    console.log(drawHeader('On-Call Cat - Health Check Dashboard'));
    console.log('');

    // Render each section (reuse parent logic)
    for (const result of results) {
      if (result.status === 'error' && !result.data) {
        continue;
      }

      const renderer = this.getRendererForChecker(result.checker);
      if (renderer) {
        renderer.call(this, result);
      }
    }

    // Summary
    this.renderSummary(results);

    // Empty line for countdown
    console.log('');
  }

  async startWatchMode(fetchCallback) {
    // Animation state
    const gentle = this.flags.animMode === 'gentle';
    const motions = gentle
      ? [
          { name: 'calm', frames: ['normal', 'normal', 'normal', 'normal', 'normal'] },
          { name: 'blink', frames: ['normal', 'blink', 'blink', 'blink', 'normal'] },
          { name: 'rest', frames: ['normal', 'normal', 'normal'] },
          { name: 'blink', frames: ['normal', 'blink', 'blink', 'normal'] },
          { name: 'calm', frames: ['normal', 'normal', 'normal', 'normal'] },
        ]
      : [
          { name: 'blink', frames: ['normal', 'blink', 'normal', 'blink', 'blink', 'normal'] },
        ];

    let mi = 0; // motion index
    let fi = 0; // frame index within motion

    // Paint only the cat header at the top
    const paintCatHeader = (key) => {
      if (this.isRefreshing) {return;}

      const catColor = this.getCatColor();
      process.stdout.write('\x1b[H');
      console.log('');
      const lines = catFrames[key] || catFrames.normal;
      for (const line of lines) {
        process.stdout.write(`  ${catColor}${line}${colors.reset}\n`);
      }
    };

    // Animation loop
    this.animTimer = setInterval(() => {
      const motion = motions[mi];
      const key = motion.frames[fi];
      paintCatHeader(key);
      fi += 1;
      if (fi >= motion.frames.length) {
        fi = 0;
        mi = (mi + 1) % motions.length;
      }
    }, Math.max(120, this.flags.animInterval || 650));

    // Countdown updater
    this.countdownTimer = setInterval(() => {
      if (this.isRefreshing) {return;}

      this.secondsUntilRefresh -= 1;
      if (this.secondsUntilRefresh < 0) {
        this.secondsUntilRefresh = 0;
      }

      // Update countdown line at the bottom
      process.stdout.write('\x1b7'); // Save cursor
      process.stdout.write('\x1b[999;0H'); // Move to very bottom
      process.stdout.write('\x1b[1A'); // Move up one line
      process.stdout.write('\x1b[2K'); // Clear line
      process.stdout.write(`${colors.gray}Refreshing in ${this.secondsUntilRefresh}s... (Ctrl+C to exit)${colors.reset}`);
      process.stdout.write('\x1b8'); // Restore cursor
    }, 1000);

    // Periodic full refresh
    this.refreshTimer = setInterval(async () => {
      this.isRefreshing = true;
      const results = await fetchCallback();
      this.secondsUntilRefresh = Math.floor(this.flags.interval / 1000);
      console.clear();
      this.renderDashboard(results);
      this.isRefreshing = false;
    }, Math.max(1000, this.flags.interval));

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      this.cleanup();
      process.exit(130);
    });
  }

  cleanup() {
    if (this.animTimer) {clearInterval(this.animTimer);}
    if (this.countdownTimer) {clearInterval(this.countdownTimer);}
    if (this.refreshTimer) {clearInterval(this.refreshTimer);}
  }

  renderCat() {
    // No-op in watch mode - cat is rendered by animation loop
  }

  clear() {
    // Clear only on initial render
    console.clear();
  }
}

export default WatchRenderer;
