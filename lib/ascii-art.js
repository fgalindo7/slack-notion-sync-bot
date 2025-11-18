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
  kiss: [
    '       /\\_/\\  ',
    '      ( o3o ) ',
    '       > ^ <  ',
  ],
  lick: [
    '       /\\_/\\  ',
    '      ( ^.^ ) ',
    '      \\ > ^ < ',
  ],
  yawn: [
    '       /\\_/\\  ',
    '      ( o O ) ',
    '       > ^ <  ',
  ],
};

/**
 * Return a cat frame based on current time window to simulate animation.
 * Windows (in seconds modulo 30):
 * - 0-6: blink
 * - 10-12: kiss
 * - 16-19: lick
 * - 24-26: yawn
 * - otherwise: normal
 */
export function getCatFrame(date = new Date()) {
  const s = Math.floor((date.getTime() / 1000) % 30);
  if (s >= 0 && s <= 1) { return catFrames.blink; }
  if (s >= 3 && s <= 4) { return catFrames.blink; }
  if (s >= 10 && s <= 12) { return catFrames.kiss; }
  if (s >= 16 && s <= 19) { return catFrames.lick; }
  if (s >= 24 && s <= 26) { return catFrames.yawn; }
  return catFrames.normal;
}

/** Simple CLI spinner frames */
export const spinnerFrames = ['|', '/', '-', '\\'];
