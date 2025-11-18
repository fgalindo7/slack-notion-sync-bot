// Status token colorizer
// Provides ANSI color wrapping for standardized status tokens.
// Tokens colored:
// [OK] -> green
// [dry-run] -> yellow
// [WARN] -> orange (256-color 208) fallback to yellow if unsupported
// [ERR] -> red
// [WAIT], [PEND] -> light blue (256-color 111) fallback to cyan
// Safe fallback to original token when not a TTY or NO_COLOR is set.

const BASIC = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

// Extended 256-color codes
const EXT = {
  orange: '\x1b[38;5;208m',
  lightBlue: '\x1b[38;5;111m'
};

function supportsColor() {
  if (process.env.NO_COLOR) { return false; }
  return Boolean(process.stdout && process.stdout.isTTY);
}

const TOKEN_MAP = [
  { re: /^\[OK\]$/, color: () => BASIC.green },
  { re: /^\[dry-run\]$/, color: () => BASIC.yellow },
  { re: /^\[WARN\]$/, color: () => (supportsColor() ? (EXT.orange || BASIC.yellow) : '') },
  { re: /^\[ERR\]$/, color: () => BASIC.red },
  { re: /^\[(WAIT|PEND)\]$/, color: () => (supportsColor() ? (EXT.lightBlue || BASIC.cyan) : '') }
];

export function colorStatusToken(token) {
  if (!supportsColor()) { return token; } // no coloring in non-TTY
  for (const entry of TOKEN_MAP) {
    if (entry.re.test(token)) {
      const c = entry.color();
      if (!c) { return token; } // fallback
      return c + token + BASIC.reset;
    }
  }
  return token;
}

// Colorize an entire line, replacing standalone tokens.
export function colorizeLine(line) {
  if (!supportsColor()) { return line; }
  return line.replace(/\[(OK|dry-run|WARN|ERR|WAIT|PEND)\]/g, (m) => colorStatusToken(m));
}

export default { colorStatusToken, colorizeLine };
