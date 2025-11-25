// ASCII art frames and helpers (single source)
// Cat frames (3 lines each), ASCII-only
export const catFrames = {
  normal: [
    '       /\\_/\\  ',
    '      ( o.o ) ',
    '       > ^ <  ',
  ],
  blink: [
    '       /\\_/\\  ',
    '      ( -.- ) ',
    '       > ^ <  ',
  ],
};

/**
 * Return a cat frame based on current time window to simulate blinking animation.
 * Uses 30-second cycle with scattered blinks at different intervals.
 *
 * @param {Date} [date=new Date()] - The date to use for animation timing
 * @returns {string[]} Cat frame (array of 3 strings)
 *
 * Blink windows (in seconds modulo 30):
 * - 0-1: short blink
 * - 3-4: short blink
 * - 10-12: medium blink (wink)
 * - 24-29: long restful blink
 * - otherwise: normal (eyes open)
 */
export function getCatFrame(date = new Date()) {
  const s = Math.floor((date.getTime() / 1000) % 30);
  // Scattered short blinks
  if (s >= 0 && s <= 1) { return catFrames.blink; }
  if (s >= 3 && s <= 4) { return catFrames.blink; }
  if (s >= 10 && s <= 12) { return catFrames.blink; }
  // Long restful blink window (extended closed eyes)
  if (s >= 24 && s <= 29) { return catFrames.blink; }
  return catFrames.normal;
}

/** Simple CLI spinner frames */
export const spinnerFrames = ['|', '/', '-', '\\'];
