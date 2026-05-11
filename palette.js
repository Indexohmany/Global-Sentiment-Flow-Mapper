// palette.js
//
// Tone color palette (atlas-style, ember red → light slate → moss/teal)
// and the bucket helper used by the tone filter. Pure data + pure
// functions; the only dependency is THREE for the Color type that
// toneColor optionally writes into.

import * as THREE from 'three';

export const TONE_STOPS = [
  { t: -8, c: [0xb8/255, 0x33/255, 0x22/255] },  // deep ember red
  { t: -4, c: [0xe8/255, 0x6a/255, 0x3a/255] },  // warm orange
  { t: -1, c: [0xd0/255, 0xa0/255, 0x70/255] },  // sandy/pale ochre
  { t:  0, c: [0xa6/255, 0xae/255, 0xb8/255] },  // light cool slate
  { t: +1, c: [0x9c/255, 0xc0/255, 0x8a/255] },  // pale moss
  { t: +4, c: [0x5c/255, 0xab/255, 0x6a/255] },  // moss green
  { t: +8, c: [0x2e/255, 0x8a/255, 0x82/255] },  // teal
];

// Interpolate the palette at `tone`. If `outColor` (a THREE.Color) is
// passed, write into it in-place — useful in hot loops to avoid GC churn.
// Returns the color either way.
export function toneColor(tone, outColor) {
  const t = Math.max(-8, Math.min(8, tone));
  for (let i = 0; i < TONE_STOPS.length - 1; i++) {
    const a = TONE_STOPS[i], b = TONE_STOPS[i+1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      const r = a.c[0] + (b.c[0] - a.c[0]) * f;
      const g = a.c[1] + (b.c[1] - a.c[1]) * f;
      const blu = a.c[2] + (b.c[2] - a.c[2]) * f;
      if (outColor) { outColor.setRGB(r, g, blu); return outColor; }
      return new THREE.Color(r, g, blu);
    }
  }
  if (outColor) { outColor.setRGB(0.5, 0.5, 0.5); return outColor; }
  return new THREE.Color(0.5, 0.5, 0.5);
}

// Tone bucket: classifies a value into one of three categories used by
// the tone filter pills.
export function toneTagOf(t) {
  if (t < -0.7) return 'neg';
  if (t > +0.7) return 'pos';
  return 'zero';
}
