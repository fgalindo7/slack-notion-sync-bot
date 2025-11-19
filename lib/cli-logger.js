// Unified CLI logger with consistent formatting
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function colorize(color, msg) {
  return `${colors[color] || ''}${msg}${colors.reset}`;
}

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('bright', title));
  console.log('='.repeat(60) + '\n');
}

function info(msg) { console.log(colorize('blue', msg)); }
function warn(msg) { console.log(colorize('yellow', msg)); }
function error(msg) { console.error(colorize('red', msg)); }
function success(msg) { console.log(colorize('green', msg)); }
function highlight(msg) { console.log(colorize('cyan', msg)); }

export const logger = { section, info, warn, error, success, highlight, colors, colorize };
