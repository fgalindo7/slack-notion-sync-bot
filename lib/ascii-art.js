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
 * Return a cat frame based on current time window to simulate animation.
 * Windows (in seconds modulo 30):
 * - 0-6: blink
 * - 10-12: blink (air-kiss/wink)
 * - 16-19: lick
 * - 24-26: yawn
 * - otherwise: normal
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
