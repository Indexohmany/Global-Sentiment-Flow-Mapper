import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Data load
// ---------------------------------------------------------------------------
// Mode II forward-declarations: we reference currentMode and modeTransition
// in tick() and the input handlers, which run before the Mode II module
// block initializes. Declaring them here keeps them out of the temporal
// dead zone.

let currentMode = 'geo';
const modeTransition = { active: false, startTime: 0, durationMs: 1400 };
// COUNTRY_OFFSETS is also forward-declared because makeBasemapTexture()
// reads it on first call. Populated lazily once COUNTRIES is loaded.
const COUNTRY_OFFSETS = new Map();
// UP/DOWN mode: two separate offset maps, one per pane. When in 'updown'
// mode, both are populated and the basemap is drawn as a stacked split.
// Outside UP/DOWN mode, these are unused.
const COUNTRY_OFFSETS_UP = new Map();
const COUNTRY_OFFSETS_DOWN = new Map();
// Identifiers of the two focal countries (FIPS) when in UP/DOWN mode.
let updownTopFips = null;
let updownBottomFips = null;
// Elevation toggle state, hoisted because setMode references it.
let elevationOn = true;
let elevationBtn = null;  // assigned at element-init time

// PASS-16: Compare-feature state.
//   - on:        true while the Compare toggle is engaged
//   - refFips:   country chosen as the reference (Mode II only — UP/DOWN
//                uses the per-pane focals as implicit references)
// updownPaneEdges{Up,Down} cache directed delta_tone + counts from the
// focal toward each non-focal country in that pane, populated by
// computeUpDownOffsets so the comparison tooltip and lines can read them
// without re-aggregating ROWS on every hover.
//
// PASS-16b: compareLineLabel is hoisted up here too. tick() and the
// hover handler both reach for it, and they run synchronously during
// startup before the Compare module's own const declaration would land.
// `import * as THREE` happens at line 1, so THREE is available here.
const compareState = { on: false, refFips: null };
let updownPaneEdgesUp = [];   // [{fips, sym, count}, ...]
let updownPaneEdgesDown = [];
const compareLineLabel = {
  active: false,
  midpoint: new THREE.Vector3(),
};
// Module scripts run with the DOM already parsed, so it's safe to grab the
// element reference up here. Hoisting it (instead of leaving it inside the
// Compare module) keeps the hover handler's hideLineLabel() call TDZ-safe.
const lineLabelEl = document.getElementById('line-label');

// Data is split across files inside ./data/ — see data.js for the layout.
// data.js owns the top-level await; importing the resolved values is
// synchronous from this module's perspective.
import {
  COUNTRIES, ROWS, ARTICLE_INDEX, DATES, DATE_INDEX
} from './data.js';
import { toneColor, toneTagOf } from './palette.js';
import { initCountryModal, openCountryModal } from './modal.js';

// ---------------------------------------------------------------------------
// Projection — equirectangular flat plane
// X = lon * COORD_SCALE
// Z = -lat * COORD_SCALE   (so north points toward -Z, default camera view)
// Y = elevation
// ---------------------------------------------------------------------------
const COORD_SCALE = 1.5;
// PASS-15: MAP_W and MAP_D are dynamic. Geo and Reorganized modes use
// the BASE values (540 × 270 — standard 2:1 world canvas) for Geographic.
// Reorganized gets its own slightly wider/taller canvas so force-sim
// spread doesn't push countries off the basemap. UP/DOWN gets the widest
// canvas of all: its strong-negative distance ring (BASELINE × 8.5 ≈ 595
// units from each focal, plus polygon half-widths) needs real room, and
// the user wants the distance schedule preserved verbatim.
// Mode change rebuilds the basemap mesh + frame.
const MAP_W_BASE   = 540;   // Geographic
const MAP_D_BASE   = 270;
const MAP_W_REORG  = 900;   // Reorganized (Mode II)
const MAP_D_REORG  = 450;
const MAP_W_UPDOWN = 1400;  // UP/DOWN (Mode III)
const MAP_D_UPDOWN = 700;
let MAP_W = MAP_W_BASE;
let MAP_D = MAP_D_BASE;
function projLon(lon) { return lon * COORD_SCALE; }
function projLat(lat) { return -lat * COORD_SCALE; }

// ---------------------------------------------------------------------------
// Per-domain aggregation
// ---------------------------------------------------------------------------
// (DATES, DATE_INDEX, ROWS, COUNTRIES, ARTICLE_INDEX all live in data.js
// now and are imported above. Aggregator code below uses them directly.)

// (toneTagOf, TONE_STOPS, toneColor moved to palette.js — imported above.)

function aggregateForFilters({ domain, dateMin, dateMax, blocs, countries, toneTags, minCount }) {
  // Filter rows by domain + date window + reporter (country override beats bloc) + tone bucket
  const useCountryOverride = countries && countries.size > 0;
  const byReporter = new Map();
  for (const r of ROWS) {
    if (r.domain !== domain) continue;
    const di = DATE_INDEX.get(r.date);
    if (di < dateMin || di > dateMax) continue;
    if (!toneTags.has(toneTagOf(r.avg_tone))) continue;
    const reporterCountry = COUNTRIES[r.reporter];
    if (!reporterCountry) continue;
    // Reporter selection: explicit country list (when set) takes priority,
    // otherwise we use the bloc filter.
    if (useCountryOverride) {
      if (!countries.has(r.reporter)) continue;
    } else {
      if (!blocs.has(reporterCountry.bloc)) continue;
    }
    let agg = byReporter.get(r.reporter);
    if (!agg) {
      agg = { count: 0, toneSum: 0, mentionedCount: new Map() };
      byReporter.set(r.reporter, agg);
    }
    agg.count += r.count;
    agg.toneSum += r.avg_tone * r.count;
    agg.mentionedCount.set(r.mentioned,
      (agg.mentionedCount.get(r.mentioned) || 0) + r.count);
  }

  // Apply min-count threshold by dropping reporters below the bar
  const out = new Map();
  let articles = 0, toneNum = 0, toneDen = 0, pairs = 0;
  const mentionedSet = new Set();
  for (const [code, a] of byReporter) {
    if (a.count < minCount) continue;
    const top = [...a.mentionedCount.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([c, n]) => `${c}(${n})`);
    out.set(code, {
      count: a.count,
      avgTone: a.toneSum / a.count,
      topTargets: top,
    });
    articles += a.count;
    toneNum += a.toneSum;
    toneDen += a.count;
    for (const m of a.mentionedCount.keys()) mentionedSet.add(m);
    pairs += a.mentionedCount.size;
  }

  return {
    perReporter: out,
    summary: {
      reporters: out.size,
      mentioned: mentionedSet.size,
      articles, pairs,
      meanTone: toneDen ? toneNum / toneDen : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// (TONE_STOPS + toneColor moved to palette.js — imported above.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Three.js scene setup
// ---------------------------------------------------------------------------
const sceneEl = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
sceneEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36,
  window.innerWidth / window.innerHeight, 0.1, 3000);

// Lighting — strong key + fill + soft ambient. Heightfields love directional.
const keyLight = new THREE.DirectionalLight(0xffeec0, 1.7);
keyLight.position.set(220, 380, 240);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x9ca8c4, 0.85);
fillLight.position.set(-280, 160, -180);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xddc296, 0.55);
rimLight.position.set(0, 80, 420);
scene.add(rimLight);
scene.add(new THREE.AmbientLight(0x3a4258, 1.4));

// ---------------------------------------------------------------------------
// Basemap — bright atlas-style continents
// In Reorganized mode, COUNTRY_OFFSETS hold per-country (ox, oz) translations
// in world units. In Geographic mode, offsets are all zero and the output is
// the standard equirectangular world map.
// ---------------------------------------------------------------------------
function makeBasemapTexture() {
  const W = 4096, H = 2048;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const ctx = cnv.getContext('2d');

  // Ocean
  ctx.fillStyle = '#0f141d';
  ctx.fillRect(0, 0, W, H);

  const HW = MAP_W / 2;  // 270
  const HD = MAP_D / 2;  // 135

  // Helper: draw a country's polygon at position (geo + offset)
  function drawCountry(c, ox, oz) {
    for (const shape of c.shapes) {
      ctx.beginPath();
      const ring = shape.outer;
      for (let i = 0; i < ring.length; i++) {
        const wx = projLon(ring[i][0]) + ox;
        const wz = projLat(ring[i][1]) + oz;
        const px = (wx + HW) / MAP_W * W;
        const py = (wz + HD) / MAP_D * H;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // Faint graticule
  ctx.strokeStyle = '#1a2230';
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = ((lon + 180) / 360) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  if (currentMode === 'updown') {
    // Two panes stacked. Top pane uses COUNTRY_OFFSETS_UP, bottom uses
    // COUNTRY_OFFSETS_DOWN. Both render full-width into the canvas.
    ctx.fillStyle = '#3a4255';
    ctx.strokeStyle = '#62707f';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';

    // Top pane countries
    for (const code in COUNTRIES) {
      const off = COUNTRY_OFFSETS_UP.get(code);
      if (!off || off.hidden) continue;
      drawCountry(COUNTRIES[code], off.ox, off.oz);
    }
    // Bottom pane countries
    for (const code in COUNTRIES) {
      const off = COUNTRY_OFFSETS_DOWN.get(code);
      if (!off || off.hidden) continue;
      drawCountry(COUNTRIES[code], off.ox, off.oz);
    }

    // Highlight the focal countries: redraw in accent color
    ctx.fillStyle = '#c9a96e';
    ctx.strokeStyle = '#e0c08c';
    ctx.lineWidth = 2.4;
    if (updownTopFips && COUNTRIES[updownTopFips]) {
      const off = COUNTRY_OFFSETS_UP.get(updownTopFips);
      if (off && !off.hidden) drawCountry(COUNTRIES[updownTopFips], off.ox, off.oz);
    }
    if (updownBottomFips && COUNTRIES[updownBottomFips]) {
      const off = COUNTRY_OFFSETS_DOWN.get(updownBottomFips);
      if (off && !off.hidden) drawCountry(COUNTRIES[updownBottomFips], off.ox, off.oz);
    }

    // Divider band between panes — a clear visual gap, not just a hairline.
    // Filled with the deepest background tone so the two panes read as
    // separate viewports, with subtle accent rules at top and bottom.
    // PASS-15: countries are already kept clear of this band by the
    // halfH-aware Z clamp in computeUpDownOffsets, so nothing should
    // ever sit underneath it.
    const DIVIDER_PX = 30;
    const yMid = H / 2;
    ctx.fillStyle = '#0a0d12';     // matches --bg-deepest
    ctx.fillRect(0, yMid - DIVIDER_PX / 2, W, DIVIDER_PX);
    ctx.strokeStyle = '#4a5365';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, yMid - DIVIDER_PX / 2); ctx.lineTo(W, yMid - DIVIDER_PX / 2);
    ctx.moveTo(0, yMid + DIVIDER_PX / 2); ctx.lineTo(W, yMid + DIVIDER_PX / 2);
    ctx.stroke();

    // Pane labels
    ctx.fillStyle = '#d6dae0';
    ctx.font = '600 38px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`From ${COUNTRIES[updownTopFips]?.name ?? updownTopFips}'s perspective`, 32, 24);
    ctx.fillText(`From ${COUNTRIES[updownBottomFips]?.name ?? updownBottomFips}'s perspective`, 32, H / 2 + 24);
  } else {
    // Standard single-layout draw (Geographic or Reorganized).
    ctx.fillStyle = '#3a4255';
    ctx.strokeStyle = '#62707f';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    for (const code in COUNTRIES) {
      const off = COUNTRY_OFFSETS.get(code);
      if (off && off.hidden) continue;
      const ox = off ? off.ox : 0;
      const oz = off ? off.oz : 0;
      drawCountry(COUNTRIES[code], ox, oz);
    }
  }

  // Subtle vignette
  const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.4,
                                       W/2, H/2, Math.max(W,H)*0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const basemapMat = new THREE.MeshBasicMaterial({
  map: makeBasemapTexture(),
  transparent: true,
});
const basemap = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_D), basemapMat);
basemap.rotation.x = -Math.PI / 2;
basemap.position.y = -0.05;
scene.add(basemap);

// Frame — kept in a tracked variable so setMapDimensions() can rebuild it
// when the world's vertical extent changes for UP/DOWN mode.
function makeFrameGeometry() {
  return new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-MAP_W/2, 0, -MAP_D/2),
    new THREE.Vector3( MAP_W/2, 0, -MAP_D/2),
    new THREE.Vector3( MAP_W/2, 0,  MAP_D/2),
    new THREE.Vector3(-MAP_W/2, 0,  MAP_D/2),
    new THREE.Vector3(-MAP_W/2, 0, -MAP_D/2),
  ]);
}
const frameLine = new THREE.Line(
  makeFrameGeometry(),
  new THREE.LineBasicMaterial({ color: 0x4a5365 })
);
scene.add(frameLine);

// Swap the world's extent (width and/or depth) and rebuild the affected
// geometries. Called when entering or leaving UP/DOWN mode. Cheap (a
// couple of small geometry rebuilds); the basemap TEXTURE is redrawn
// separately by rebuildBasemapTexture() during the mode-transition step.
function setMapDimensions(newW, newD) {
  if (MAP_W === newW && MAP_D === newD) return;
  MAP_W = newW;
  MAP_D = newD;
  basemap.geometry.dispose();
  basemap.geometry = new THREE.PlaneGeometry(MAP_W, MAP_D);
  frameLine.geometry.dispose();
  frameLine.geometry = makeFrameGeometry();
}

// ---------------------------------------------------------------------------
// SDF (signed-distance-to-polygon) data per country shape.
//
// To get country-shaped mountains rather than circular ones, we compute, for
// every heightfield vertex, the *distance to the nearest country boundary*.
// Inside the polygon the contribution is full; outside, it falls off with
// distance over a small skirt (FALLOFF_DEG). This makes the mountains trace
// the actual borders.
//
// Performance: each shape's outer ring is sub-sampled to <= MAX_BOUNDARY_VERTS
// (uniform-arc-length) and stored as flat arrays (Float32 boundary). Together
// with a bbox per shape, point-in-polygon + min-edge-distance run in one
// linear pass per (vertex, shape) pair, with bbox prefilter cutting most
// pairs out cheaply.
// ---------------------------------------------------------------------------
const FALLOFF_DEG = 1.5;        // skirt width outside the polygon
const MAX_BOUNDARY_VERTS = 80;  // simplification target per shape

function ringArea(ring) {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function ringPerimeter(ring) {
  let p = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}

// Uniform-arc-length resampling: walks the perimeter and emits N points
// at equal arc-length intervals. Preserves shape character at low vertex counts.
function resampleRing(ring, n) {
  if (ring.length <= n) return ring.slice();
  const total = ringPerimeter(ring);
  const step = total / n;
  const out = [];
  let acc = 0;
  let target = 0;
  out.push([ring[0][0], ring[0][1]]);
  let written = 1;
  for (let i = 0; i < ring.length && written < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const seg = Math.hypot(x2 - x1, y2 - y1);
    while (written < n && acc + seg >= target + step) {
      target += step;
      const t = (target - acc) / Math.max(seg, 1e-9);
      out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
      written++;
    }
    acc += seg;
  }
  return out;
}

// Per-shape SDF record. We store the resampled boundary as Float32 flats
// (lon0, lat0, lon1, lat1, ...) for a tight inner loop with no GC churn.
const SHAPES = [];  // [{fips, areaWeight, minLon, maxLon, minLat, maxLat, boundary: Float32Array}]

for (const fips in COUNTRIES) {
  const c = COUNTRIES[fips];
  const totalArea = c.shapes.reduce((s, sh) => s + ringArea(sh.outer), 0);
  for (const sh of c.shapes) {
    const a = ringArea(sh.outer);
    if (a < 0.05) continue;  // drop tiny slivers
    const ring = resampleRing(sh.outer, MAX_BOUNDARY_VERTS);
    const flat = new Float32Array(ring.length * 2);
    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const x = ring[i][0], y = ring[i][1];
      flat[i * 2] = x;
      flat[i * 2 + 1] = y;
      if (x < minLon) minLon = x;
      if (x > maxLon) maxLon = x;
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
    SHAPES.push({
      fips,
      areaWeight: a / Math.max(totalArea, 1e-6),
      minLon, maxLon, minLat, maxLat,
      boundary: flat,
    });
  }
}
console.log(`Built SDF data for ${SHAPES.length} shapes (${Object.keys(COUNTRIES).length} countries)`);

// Smooth multi-octave value noise sampled at world coordinates.
// Used for *interior* topographic variation — replaces the per-vertex
// hash noise that crackled when the camera moved.
const NOISE_GRID = 64;          // 64x64 base grid (~5.6° per cell)
const NOISE_SCALE = 360 / NOISE_GRID;
function _hash2(x, y) {
  let h = (x * 374761393) ^ (y * 668265263);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(lon, lat) {
  // 3-octave smooth noise; lon/lat in degrees
  let v = 0;
  let amp = 1;
  let total = 0;
  let scale = NOISE_SCALE;
  for (let oct = 0; oct < 3; oct++) {
    const x = (lon + 180) / scale;
    const y = (lat + 90) / scale;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const v00 = _hash2(x0, y0);
    const v10 = _hash2(x0 + 1, y0);
    const v01 = _hash2(x0, y0 + 1);
    const v11 = _hash2(x0 + 1, y0 + 1);
    const lerp1 = v00 + (v10 - v00) * sx;
    const lerp2 = v01 + (v11 - v01) * sx;
    v += (lerp1 + (lerp2 - lerp1) * sy) * amp;
    total += amp;
    amp *= 0.5;
    scale *= 0.5;
  }
  return (v / total) - 0.5;  // centered around 0, range roughly [-0.5, +0.5]
}

// ---------------------------------------------------------------------------
// Country bounding boxes + point-in-polygon for hover gating.
// We compute one bbox per shape and test in two phases: bbox reject (fast),
// then ray-casting point-in-polygon on the outer ring.
// ---------------------------------------------------------------------------
const COUNTRY_BBOXES = [];  // {fips, minLon, maxLon, minLat, maxLat, ring, oxLon, ozLat}

for (const fips in COUNTRIES) {
  for (const shape of COUNTRIES[fips].shapes) {
    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    for (const [x, y] of shape.outer) {
      if (x < minLon) minLon = x;
      if (x > maxLon) maxLon = x;
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
    // oxLon/ozLat are zero in geo mode; rebuilt by rebuildBboxesWithOffsets
    // in reorganized mode.
    COUNTRY_BBOXES.push({
      fips, minLon, maxLon, minLat, maxLat,
      ring: shape.outer,
      oxLon: 0, ozLat: 0,
    });
  }
}

function pointInRing(lon, lat, ring) {
  // Standard ray-casting algorithm. Cast horizontally to the right.
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > lat) !== (yj > lat)) &&
                       (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function countryAtLonLat(lon, lat) {
  for (const b of COUNTRY_BBOXES) {
    if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) continue;
    if (pointInRing(lon, lat, b.ring)) return b.fips;
  }
  return null;  // ocean
}

// ---------------------------------------------------------------------------
// Heightfield mesh — single subdivided plane covering the world
// Resolution: 1.5° per vertex (240 cols x 120 rows = ~28K vertices)
// ---------------------------------------------------------------------------
// Resolution: 1.5° per vertex (240 cols x 120 rows = ~28K vertices)
// ---------------------------------------------------------------------------
const HF_COLS = 240;       // along X (longitude)
const HF_ROWS = 120;       // along Z (latitude)
const HF_VERTS = HF_COLS * HF_ROWS;
const DEG_PER_COL = 360 / HF_COLS;   // 1.5°
const DEG_PER_ROW = 180 / HF_ROWS;   // 1.5°

const HEIGHT_SCALE = 2.4;     // gentler ramp so mountains stay shallow
const MAX_HEIGHT = 16;        // hard cap; aspect ratio ~ 1:6 for typical countries

// Pre-compute each vertex's lon/lat once
const vertLon = new Float32Array(HF_VERTS);
const vertLat = new Float32Array(HF_VERTS);
for (let r = 0; r < HF_ROWS; r++) {
  const lat = 90 - r * DEG_PER_ROW - DEG_PER_ROW * 0.5;
  for (let c = 0; c < HF_COLS; c++) {
    const lon = -180 + c * DEG_PER_COL + DEG_PER_COL * 0.5;
    const i = r * HF_COLS + c;
    vertLon[i] = lon;
    vertLat[i] = lat;
  }
}

// Build the geometry once. Positions and colors will be updated per-domain.
const hfGeom = new THREE.BufferGeometry();
const positions = new Float32Array(HF_VERTS * 3);
const colors = new Float32Array(HF_VERTS * 3);
const alphas = new Float32Array(HF_VERTS);  // 1 = render, 0 = discard
for (let i = 0; i < HF_VERTS; i++) {
  positions[i * 3 + 0] = projLon(vertLon[i]);
  positions[i * 3 + 1] = 0;
  positions[i * 3 + 2] = projLat(vertLat[i]);
  colors[i * 3 + 0] = 0.45;
  colors[i * 3 + 1] = 0.48;
  colors[i * 3 + 2] = 0.55;
  alphas[i] = 0;  // start invisible — basemap shows through
}
hfGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
hfGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
hfGeom.setAttribute('vAlpha', new THREE.BufferAttribute(alphas, 1));

// Build the index buffer — two triangles per quad
const indices = [];
for (let r = 0; r < HF_ROWS - 1; r++) {
  for (let c = 0; c < HF_COLS - 1; c++) {
    const a = r * HF_COLS + c;
    const b = r * HF_COLS + (c + 1);
    const cc = (r + 1) * HF_COLS + (c + 1);
    const d = (r + 1) * HF_COLS + c;
    indices.push(a, d, b);
    indices.push(b, d, cc);
  }
}
hfGeom.setIndex(indices);
hfGeom.computeVertexNormals();

// MeshStandardMaterial with shader injection: read per-vertex alpha and
// discard fragments below threshold. This makes the heightfield invisible
// where there's no terrain — the basemap shows through cleanly, no
// z-fighting because there's nothing rendered at those pixels.
// Note: not transparent — we use discard, which keeps the material opaque
// and avoids the sort-order issues that real transparency would introduce.
const hfMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.85,
  metalness: 0.0,
  flatShading: false,
});
hfMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>',
      '#include <common>\nattribute float vAlpha;\nvarying float vAlphaV;')
    .replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvAlphaV = vAlpha;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>',
      '#include <common>\nvarying float vAlphaV;')
    .replace('void main() {',
      'void main() {\n  if (vAlphaV < 0.5) discard;');
};
const hfMesh = new THREE.Mesh(hfGeom, hfMat);
scene.add(hfMesh);

// Hover requires raycasting into this mesh; we'll resolve hits to nearest country
const positionAttr = hfGeom.attributes.position;
const colorAttr = hfGeom.attributes.color;

// ---------------------------------------------------------------------------
// Heightfield update — recomputes per-vertex height, color, and roughness
// driven by tone, all from the active domain's per-country aggregates.
// ---------------------------------------------------------------------------
// Reusable color object to avoid garbage creation in the hot loop
const tmpColor = new THREE.Color();

// Squared distance from point (px,py) to segment (ax,ay)->(bx,by)
function segDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = ((px - ax) * dx + (py - ay) * dy) / Math.max(lenSq, 1e-12);
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const cx = ax + dx * t, cy = ay + dy * t;
  const ex = px - cx, ey = py - cy;
  return ex * ex + ey * ey;
}

// Combined SDF + point-in-polygon.
// Returns: signed distance in degrees. Negative = inside, positive = outside.
// Uses min-edge-distance + ray-cast crossing count in a single boundary pass.
function shapeSDF(lon, lat, boundary) {
  const N = boundary.length / 2;
  let inside = false;
  let minDistSq = Infinity;
  for (let i = 0, j = N - 1; i < N; j = i, i++) {
    const ax = boundary[j * 2], ay = boundary[j * 2 + 1];
    const bx = boundary[i * 2], by = boundary[i * 2 + 1];
    // crossing test
    if ((ay > lat) !== (by > lat)) {
      const xCross = (bx - ax) * (lat - ay) / ((by - ay) + 1e-12) + ax;
      if (lon < xCross) inside = !inside;
    }
    // edge-distance
    const d2 = segDistSq(lon, lat, ax, ay, bx, by);
    if (d2 < minDistSq) minDistSq = d2;
  }
  const d = Math.sqrt(minDistSq);
  return inside ? -d : d;
}

function applyDomain(domain, perReporter, summary) {
  const t0 = performance.now();

  // Stats panel
  document.getElementById('s-reporters').textContent = summary.reporters;
  document.getElementById('s-mentioned').textContent = summary.mentioned;
  document.getElementById('s-articles').textContent = summary.articles.toLocaleString();
  document.getElementById('s-pairs').textContent = summary.pairs.toLocaleString();
  document.getElementById('s-tone').textContent = summary.meanTone.toFixed(2);

  // Build active shapes list — only those whose country has data this domain.
  // Each entry caches its weight (height contribution at full intensity) and tone.
  const activeShapes = [];
  for (const sh of SHAPES) {
    const data = perReporter.get(sh.fips);
    if (!data) continue;
    activeShapes.push({
      shape: sh,
      weight: Math.log(data.count + 1) * HEIGHT_SCALE * sh.areaWeight,
      tone: data.avgTone,
    });
  }

  // Two-pass per-vertex accumulation. We avoid the naive O(verts × shapes) by
  // iterating per-shape and visiting only the heightfield vertices inside each
  // shape's expanded bbox (inverted loop).
  const pos = positionAttr.array;
  const col = colorAttr.array;
  // Reset per-vertex accumulators for this frame
  // (heightAcc and toneAcc and weightAcc all keyed by vertex index)
  const heightAcc = new Float32Array(HF_VERTS);
  const toneAcc = new Float32Array(HF_VERTS);
  const weightAcc = new Float32Array(HF_VERTS);

  // Inverse map from lon/lat to vertex grid coords:
  //   col c = (lon + 180) / DEG_PER_COL - 0.5
  //   row r = (90 - lat) / DEG_PER_ROW - 0.5
  // (inverse of the offset used when we wrote vertLon/vertLat at startup)
  for (let k = 0; k < activeShapes.length; k++) {
    const a = activeShapes[k];
    const sh = a.shape;
    const wt = a.weight;
    const tn = a.tone;
    const minLon = sh.minLon - FALLOFF_DEG;
    const maxLon = sh.maxLon + FALLOFF_DEG;
    const minLat = sh.minLat - FALLOFF_DEG;
    const maxLat = sh.maxLat + FALLOFF_DEG;
    // Map lon range -> col range, lat range -> row range
    const c0 = Math.max(0, Math.floor((minLon + 180) / DEG_PER_COL - 0.5));
    const c1 = Math.min(HF_COLS - 1, Math.ceil((maxLon + 180) / DEG_PER_COL - 0.5));
    const r0 = Math.max(0, Math.floor((90 - maxLat) / DEG_PER_ROW - 0.5));
    const r1 = Math.min(HF_ROWS - 1, Math.ceil((90 - minLat) / DEG_PER_ROW - 0.5));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const vi = r * HF_COLS + c;
        const sd = shapeSDF(vertLon[vi], vertLat[vi], sh.boundary);
        let f;
        if (sd <= 0) {
          f = 1;
        } else if (sd < FALLOFF_DEG) {
          const u = sd / FALLOFF_DEG;
          f = (1 - u) * (1 - u);
        } else {
          continue;
        }
        const contrib = wt * f;
        heightAcc[vi] += contrib;
        toneAcc[vi] += tn * contrib;
        weightAcc[vi] += contrib;
      }
    }
  }

  // Second pass: write positions, colors, alphas from accumulators
  const VISIBLE_THRESHOLD = 0.4;
  const alpha = hfGeom.attributes.vAlpha.array;

  for (let i = 0; i < HF_VERTS; i++) {
    let h = heightAcc[i];
    if (h > MAX_HEIGHT) h = MAX_HEIGHT;
    const wsum = weightAcc[i];

    if (h < VISIBLE_THRESHOLD) {
      // No terrain here — invisible, basemap shows through.
      pos[i * 3 + 1] = 0;
      alpha[i] = 0;
      // Color doesn't matter (fragment is discarded), but we set it anyway
      // in case the alpha test ever needs to be relaxed.
      col[i * 3 + 0] = 0.16;
      col[i * 3 + 1] = 0.18;
      col[i * 3 + 2] = 0.22;
      continue;
    }

    if (h > 1.5 && wsum > 0) {
      const localTone = toneAcc[i] / wsum;
      const rugged = Math.max(0, Math.min(1, (-localTone + 1) / 6));
      const nval = valueNoise(vertLon[i], vertLat[i]);
      h += nval * rugged * Math.min(2.5, h * 0.25);
      if (h < 0) h = 0;
    }

    pos[i * 3 + 1] = h;
    alpha[i] = 1;

    const localTone = toneAcc[i] / wsum;
    toneColor(localTone, tmpColor);
    const lum = 1 + Math.min(0.35, h / 200);
    col[i * 3 + 0] = tmpColor.r * lum;
    col[i * 3 + 1] = tmpColor.g * lum;
    col[i * 3 + 2] = tmpColor.b * lum;
  }

  hfGeom.attributes.vAlpha.needsUpdate = true;

  positionAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  hfGeom.computeVertexNormals();

  console.log(`applyDomain(${domain}): ${(performance.now() - t0).toFixed(0)}ms ` +
              `(${activeShapes.length} active shapes)`);
}

// Smooth domain transitions: tween between previous and target heightfields.
// We keep a "current" snapshot of positions+colors and a "target" snapshot.
// The render loop interpolates and pushes to the actual buffers.
const positionsCurrent = new Float32Array(HF_VERTS * 3);
const positionsTarget  = new Float32Array(HF_VERTS * 3);
const colorsCurrent    = new Float32Array(HF_VERTS * 3);
const colorsTarget     = new Float32Array(HF_VERTS * 3);

// Initialize current = positions (base plane). Target will be set by applyDomain.
positionsCurrent.set(positionAttr.array);
positionsTarget.set(positionAttr.array);
colorsCurrent.set(colorAttr.array);
colorsTarget.set(colorAttr.array);

// Re-baking the heightfield while a tween is in flight: we want the new
// computation to take effect immediately and tween from wherever the live
// buffer currently sits. So we read CURRENT from the live buffer (not from
// positionsCurrent which may be stale), then bake target, then keep live as
// the new "current."
function applyFiltersWithTween(filters) {
  // Snapshot the live buffer as our new "current" — this is whatever the
  // user is currently SEEING, regardless of mid-tween state.
  positionsCurrent.set(positionAttr.array);
  colorsCurrent.set(colorAttr.array);

  const { perReporter, summary } = aggregateForFilters(filters);
  // Compute target into the live buffer
  applyDomain(filters.domain, perReporter, summary);
  // Snapshot target, restore live to current
  positionsTarget.set(positionAttr.array);
  colorsTarget.set(colorAttr.array);
  positionAttr.array.set(positionsCurrent);
  colorAttr.array.set(colorsCurrent);
  // Alpha gets reset and re-derived from heights each tween step
  hfGeom.attributes.vAlpha.array.fill(0);
  positionAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  hfGeom.attributes.vAlpha.needsUpdate = true;

  // Cache for the tooltip
  lastDomainAgg = perReporter;
}

const TWEEN_RATE = 0.08;
function stepTween() {
  let stillMoving = false;
  const liveP = positionAttr.array;
  const liveC = colorAttr.array;
  const liveA = hfGeom.attributes.vAlpha.array;
  const VIS = 0.4;  // matches VISIBLE_THRESHOLD inside applyDomain
  for (let i = 0; i < HF_VERTS * 3; i++) {
    const dp = positionsTarget[i] - positionsCurrent[i];
    if (Math.abs(dp) > 0.0008) {
      positionsCurrent[i] += dp * TWEEN_RATE;
      stillMoving = true;
    } else {
      positionsCurrent[i] = positionsTarget[i];
    }
    liveP[i] = positionsCurrent[i];

    const dc = colorsTarget[i] - colorsCurrent[i];
    if (Math.abs(dc) > 0.0015) {
      colorsCurrent[i] += dc * TWEEN_RATE;
      stillMoving = true;
    } else {
      colorsCurrent[i] = colorsTarget[i];
    }
    liveC[i] = colorsCurrent[i];
  }
  // Drive alpha from the currently-displayed height: anything below the
  // threshold is invisible, anything above is visible. This makes mountains
  // appear/disappear smoothly during the tween rather than snapping.
  for (let i = 0; i < HF_VERTS; i++) {
    liveA[i] = liveP[i * 3 + 1] > VIS ? 1 : 0;
  }
  positionAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  hfGeom.attributes.vAlpha.needsUpdate = true;
  return stillMoving;
}

// ---------------------------------------------------------------------------
// Hover via raycast into the heightfield/basemap, then strict point-in-polygon
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tooltipEl = document.getElementById('tooltip');
let lastDomainAgg = null;

function updateTooltip(fips, screenX, screenY) {
  const c = COUNTRIES[fips];
  if (!c) {
    tooltipEl.classList.remove('visible');
    return;
  }
  ensureTooltipMode('normal');
  const data = lastDomainAgg ? lastDomainAgg.get(fips) : null;
  document.getElementById('tt-name').textContent = `${c.name} · ${fips}`;
  document.getElementById('tt-out').textContent = data ? data.count.toLocaleString() : '—';
  const toneEl = document.getElementById('tt-tone');
  if (data) {
    toneEl.textContent = data.avgTone.toFixed(2);
    toneEl.classList.toggle('neg', data.avgTone < -0.5);
    toneEl.classList.toggle('pos', data.avgTone > 0.5);
  } else {
    toneEl.textContent = '—';
    toneEl.classList.remove('neg', 'pos');
  }
  document.getElementById('tt-targets').textContent =
    data ? (data.topTargets.join(' ') || '—') : '—';
  document.getElementById('tt-bloc').textContent = c.bloc.replace(/_/g, ' ');
  tooltipEl.style.left = screenX + 'px';
  tooltipEl.style.top = screenY + 'px';
  tooltipEl.classList.add('visible');
}

// PASS-16: comparison tooltip — shows pairwise affinity to the reference
// country (Mode II) or to the pane's focal (UP/DOWN). Different rows than
// the normal tooltip, so we swap the body markup once when the mode
// changes via ensureTooltipMode().
let tooltipBodyMode = null;
function ensureTooltipMode(mode) {
  if (tooltipBodyMode === mode) return;
  tooltipBodyMode = mode;
  if (mode === 'compare') {
    tooltipEl.innerHTML = `
      <div class="name" id="tt-name">—</div>
      <div class="row"><span class="lbl">vs.</span><span class="v" id="tt-vs">—</span></div>
      <div class="row"><span class="lbl">Affinity</span><span class="v" id="tt-aff">—</span></div>
      <div class="row"><span class="lbl">Tier</span><span class="v" id="tt-tier">—</span></div>
      <div class="row"><span class="lbl">Articles</span><span class="v" id="tt-arts">—</span></div>
    `;
  } else {
    tooltipEl.innerHTML = `
      <div class="name" id="tt-name">—</div>
      <div class="row"><span class="lbl">Articles published</span><span class="v" id="tt-out">—</span></div>
      <div class="row"><span class="lbl">Mean tone (out)</span><span class="v" id="tt-tone">—</span></div>
      <div class="row"><span class="lbl">Top targets</span><span class="v" id="tt-targets">—</span></div>
      <div class="row"><span class="lbl">Bloc</span><span class="v" id="tt-bloc">—</span></div>
    `;
  }
}

function updateTooltipCompare(fips, refFips, paneId, screenX, screenY) {
  const c   = COUNTRIES[fips];
  const ref = COUNTRIES[refFips];
  if (!c || !ref) {
    tooltipEl.classList.remove('visible');
    return;
  }
  ensureTooltipMode('compare');

  // Resolve the affinity from cached edge data (no re-aggregation per hover)
  let sym = null, articlesText = '— (no mutual data)';
  const isDirected = currentMode === 'updown';
  if (currentMode === 'reorganized') {
    const edge = findReorgEdge(refFips, fips);
    if (edge) {
      sym = edge.sym;
      articlesText = `${edge.cA.toLocaleString()} ↔ ${edge.cB.toLocaleString()}`;
    }
  } else if (currentMode === 'updown') {
    const list = paneId === 'up' ? updownPaneEdgesUp : updownPaneEdgesDown;
    const e = list.find(x => x.fips === fips);
    if (e) {
      sym = e.sym;
      articlesText = e.count.toLocaleString();
    }
  }

  let symText = '—', symClass = '', tier = '—';
  if (sym !== null) {
    symText = (sym >= 0 ? '+' : '') + sym.toFixed(2);
    if (sym < -0.5) symClass = 'v neg';
    else if (sym > 0.5) symClass = 'v pos';
    else symClass = 'v';
    tier = compareTierLabel(sym);
  }

  document.getElementById('tt-name').textContent = `${c.name} · ${fips}`;
  document.getElementById('tt-vs').textContent = ref.name;
  const affEl = document.getElementById('tt-aff');
  affEl.textContent = symText + (isDirected ? ' (directed)' : ' (mutual)');
  affEl.className = symClass;
  document.getElementById('tt-tier').textContent = tier;
  document.getElementById('tt-arts').textContent = articlesText;
  tooltipEl.style.left = screenX + 'px';
  tooltipEl.style.top = screenY + 'px';
  tooltipEl.classList.add('visible');
}

function onMouseMove(ev) {
  if (orbit.dragging || orbit.panning) return;
  ndc.x = (ev.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(ev.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  // Hover: works in both modes via offset-aware countryAtWorldXZ
  const hits = raycaster.intersectObjects([hfMesh, basemap], false);
  if (hits.length > 0) {
    const p = hits[0].point;
    const fips = countryAtWorldXZ(p.x, p.z);
    if (fips) {
      // PASS-16: in Compare mode, route to the comparison tooltip when
      // we have a reference. UP/DOWN: each pane's focal is its reference;
      // we determine pane from the sign of world-Z (divider is at z=0).
      if (compareState.on && currentMode === 'reorganized' && compareState.refFips
          && compareState.refFips !== fips) {
        updateTooltipCompare(fips, compareState.refFips, null, ev.clientX, ev.clientY);
        // PASS-16b: also anchor the affinity number to the line midpoint
        const refPos = countryWorldPos(compareState.refFips);
        const tgtPos = countryWorldPos(fips);
        const edge = findReorgEdge(compareState.refFips, fips);
        if (refPos && tgtPos && edge) showLineLabel(refPos, tgtPos, edge.sym);
        else hideLineLabel();
        return;
      }
      if (compareState.on && currentMode === 'updown') {
        const paneId = p.z < 0 ? 'up' : 'down';
        const focal  = paneId === 'up' ? updownTopFips : updownBottomFips;
        if (focal && focal !== fips) {
          updateTooltipCompare(fips, focal, paneId, ev.clientX, ev.clientY);
          const list   = paneId === 'up' ? updownPaneEdgesUp : updownPaneEdgesDown;
          const e      = list.find(x => x.fips === fips);
          const refPos = countryWorldPos(focal, paneId);
          const tgtPos = countryWorldPos(fips, paneId);
          if (refPos && tgtPos && e) showLineLabel(refPos, tgtPos, e.sym);
          else hideLineLabel();
          return;
        }
      }
      hideLineLabel();
      updateTooltip(fips, ev.clientX, ev.clientY);
      return;
    }
  }
  hideLineLabel();
  tooltipEl.classList.remove('visible');
}
window.addEventListener('mousemove', onMouseMove);

// ---------------------------------------------------------------------------
// Orbit camera
// Drag (left click)            → orbit / rotate
// Ctrl/Cmd+drag, right-click   → pan (translate target along the map plane)
// Wheel                        → zoom
// ---------------------------------------------------------------------------
const orbit = {
  azimuth: 0,
  altitude: 0.78,
  distance: 480,
  target: new THREE.Vector3(0, 0, 0),
  dragging: false,
  panning: false,
  lastX: 0, lastY: 0,
};
function applyOrbit() {
  const cx = orbit.target.x + orbit.distance * Math.cos(orbit.altitude) * Math.sin(orbit.azimuth);
  const cy = orbit.target.y + orbit.distance * Math.sin(orbit.altitude);
  const cz = orbit.target.z + orbit.distance * Math.cos(orbit.altitude) * Math.cos(orbit.azimuth);
  camera.position.set(cx, cy, cz);
  camera.lookAt(orbit.target);
}
applyOrbit();

renderer.domElement.addEventListener('mousedown', e => {
  // Ctrl/Cmd+drag, Shift+drag, or right-click drag → pan
  // Plain left-drag → orbit
  const wantsPan = e.ctrlKey || e.metaKey || e.shiftKey || e.button === 2;
  if (wantsPan) {
    orbit.panning = true;
    renderer.domElement.style.cursor = 'move';
  } else {
    orbit.dragging = true;
    renderer.domElement.style.cursor = 'grabbing';
  }
  orbit.lastX = e.clientX;
  orbit.lastY = e.clientY;
  tooltipEl.classList.remove('visible');
  hideLineLabel();
});
window.addEventListener('mouseup', () => {
  orbit.dragging = false;
  orbit.panning = false;
  renderer.domElement.style.cursor = 'default';
});
window.addEventListener('mousemove', e => {
  if (orbit.dragging) {
    const dx = e.clientX - orbit.lastX;
    const dy = e.clientY - orbit.lastY;
    orbit.azimuth   -= dx * 0.005;
    orbit.altitude  = Math.max(0.18, Math.min(1.45, orbit.altitude + dy * 0.005));
    orbit.lastX = e.clientX; orbit.lastY = e.clientY;
    applyOrbit();
  } else if (orbit.panning) {
    // Pan the target along the camera-aligned XZ floor plane. Speed
    // scales with zoom distance so the pan feels consistent at any zoom.
    // "Drag the world" feel: as the cursor moves, the world appears to
    // follow it (target moves opposite to cursor delta in world space).
    const dx = e.clientX - orbit.lastX;
    const dy = e.clientY - orbit.lastY;
    const az = orbit.azimuth;
    const panSpeed = orbit.distance * 0.0018;
    // Camera right-vector in the XZ floor plane
    const rightX =  Math.cos(az);
    const rightZ = -Math.sin(az);
    // Camera forward projected onto the XZ floor plane
    const fwdX = -Math.sin(az);
    const fwdZ = -Math.cos(az);
    orbit.target.x += -dx * panSpeed * rightX + dy * panSpeed * fwdX;
    orbit.target.z += -dx * panSpeed * rightZ + dy * panSpeed * fwdZ;
    // Soft bounds so the user can't pan into the void and lose the map
    const PAN_BOUND_X = MAP_W * 1.2;
    const PAN_BOUND_Z = MAP_D * 1.2;
    if (orbit.target.x >  PAN_BOUND_X) orbit.target.x =  PAN_BOUND_X;
    if (orbit.target.x < -PAN_BOUND_X) orbit.target.x = -PAN_BOUND_X;
    if (orbit.target.z >  PAN_BOUND_Z) orbit.target.z =  PAN_BOUND_Z;
    if (orbit.target.z < -PAN_BOUND_Z) orbit.target.z = -PAN_BOUND_Z;
    orbit.lastX = e.clientX; orbit.lastY = e.clientY;
    applyOrbit();
  }
});
// Right-click pan: suppress the browser's context menu on the canvas
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  orbit.distance = Math.max(150, Math.min(1100, orbit.distance + e.deltaY * 0.6));
  applyOrbit();
}, { passive: false });

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
let normalRecomputeSkip = 0;
let wasMovingLastFrame = false;
function tick() {
  const moving = stepTween();
  if (moving) {
    // Recompute normals at most every 3rd frame during tween — visible quality
    // is fine, CPU cost drops by 2/3 on a 28K-vertex mesh.
    normalRecomputeSkip = (normalRecomputeSkip + 1) % 3;
    if (normalRecomputeSkip === 0) hfGeom.computeVertexNormals();
  } else if (wasMovingLastFrame) {
    // Just settled — recompute one final time so static state has correct shading
    hfGeom.computeVertexNormals();
  }
  wasMovingLastFrame = moving;
  // Mode II reorganization tween (only runs if mode === 'reorganized')
  if (currentMode === 'reorganized' || modeTransition.active) {
    stepReorganization();
  }
  // PASS-16b: keep the line-label glued to its world anchor as the camera
  // orbits/pans/zooms. No-op when the label is hidden.
  updateLineLabelPosition();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// ===========================================================================
// MODE II — Reorganization (Affinity / Antagonism)
//
// Same map, same countries, same mountains — but each country's polygon is
// translated to a new (x,z) position determined by news affinity:
//   - countries that mutually report positively about each other → close
//   - countries that mutually report negatively about each other → far apart
//
// Implementation: per-country offset (offsetX, offsetZ) added to each polygon
// vertex. Geographic mode = all offsets zero. Reorganized mode = offsets
// from a force simulation. Toggle smoothly tweens the offsets.
// ===========================================================================

// (COUNTRY_OFFSETS map is forward-declared at the top of the module so that
// makeBasemapTexture() can reference it during initial setup. Populate it
// here now that COUNTRIES is loaded. The 'hidden' flag, used only in
// Reorganized mode, marks countries excluded by the current filter; they
// won't be drawn on the basemap or contribute to the heightfield.)
for (const fips in COUNTRIES) {
  COUNTRY_OFFSETS.set(fips, {
    ox: 0, oz: 0, targetOx: 0, targetOz: 0, hidden: false,
  });
  COUNTRY_OFFSETS_UP.set(fips, { ox: 0, oz: 0, hidden: false });
  COUNTRY_OFFSETS_DOWN.set(fips, { ox: 0, oz: 0, hidden: false });
}

// (modeTransition is also hoisted to the top — see Mode II forward-declarations.)

// =========================================================================
// Affinity force simulation — computes target offsets for each country
// =========================================================================

function computeReorganizedOffsets() {
  // Aggregate symmetric pairwise affinity from current filter state.
  // Use delta_tone (per-pair tone vs global mean) as the relationship signal.
  const f = buildFilters();
  const useCountryOverride = f.countries && f.countries.size > 0;

  // Determine which reporters are eligible per current filter
  function reporterEligible(fips) {
    const c = COUNTRIES[fips];
    if (!c) return false;
    if (useCountryOverride) return f.countries.has(fips);
    return f.blocs.has(c.bloc);
  }

  const directed = new Map();  // "A>B" -> {dt_w_sum, count}
  for (const r of ROWS) {
    if (r.domain !== f.domain) continue;
    const di = DATE_INDEX.get(r.date);
    if (di < f.dateMin || di > f.dateMax) continue;
    if (!f.toneTags.has(toneTagOf(r.avg_tone))) continue;
    if (!reporterEligible(r.reporter)) continue;
    const k = r.reporter + '>' + r.mentioned;
    let p = directed.get(k);
    if (!p) { p = { dt: 0, c: 0 }; directed.set(k, p); }
    p.dt += r.delta_tone * r.count;
    p.c += r.count;
  }

  // Identify nodes: ALL eligible countries (with polygon data), so they all
  // participate. Countries without affinity edges still get baseline targets.
  const nodes = new Set();
  for (const fips in COUNTRIES) {
    if (reporterEligible(fips)) nodes.add(fips);
  }

  // Build symmetric edges — keep ALL valid pairs (no percentile filtering).
  // Under the new force model, every pair has a target distance:
  //   - Pairs with data → target = function of mutual delta_tone
  //   - Pairs without data → target = BASELINE (default spacing)
  // Near-zero deltas naturally produce near-baseline targets, so they don't
  // need to be dropped — they just sit at neutral distance.
  const edges = [];
  for (const [k, p] of directed) {
    const [a, b] = k.split('>');
    if (a >= b) continue;
    const k2 = b + '>' + a;
    const p2 = directed.get(k2);
    if (!p2) continue;
    if (p.c < 3 || p2.c < 3) continue;
    if (!nodes.has(a) || !nodes.has(b)) continue;
    const dtA = p.dt / p.c;
    const dtB = p2.dt / p2.c;
    const dtAvg = (dtA + dtB) / 2;
    edges.push({
      a, b,
      sym: dtAvg,
      weight: Math.log(Math.min(p.c, p2.c) + 1),
      cA: p.c,    // articles a→b  (PASS-16: used by Compare tooltip)
      cB: p2.c,   // articles b→a
    });
  }

  console.log(`Reorganization: ${nodes.size} nodes, ${edges.length} edges with mutual data ` +
              `(remaining pairs use baseline spacing)`);

  // === Force simulation in 2D ===
  // World units: same scale as the map (COORD_SCALE = 1.5/deg).
  // Map spans [-270, +270] x [-135, +135]. We keep the simulation in the
  // same canvas so reorganized continents fit naturally.
  const nodeArr = [...nodes];
  const idx = new Map();
  nodeArr.forEach((fips, i) => idx.set(fips, i));
  const N = nodeArr.length;
  const x = new Float32Array(N);
  const z = new Float32Array(N);
  const vx = new Float32Array(N);
  const vz = new Float32Array(N);

  // Initialize at geographic positions, plus precompute effective country
  // "radius" in world units — derived from each country's polygon bbox so
  // that big countries (Russia, Canada) repel proportionally more space.
  const effRadius = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const c = COUNTRIES[nodeArr[i]];
    if (c) {
      // Pre-stretch initial positions horizontally (X expanded, Z compressed)
      // so the simulation seeds in a wide configuration. This biases the layout
      // toward horizontal elongation. Combined with anisotropic spring forces
      // (Z component scaled down) and stronger Z center pull, the simulation
      // settles into a layout that fills the canvas's wide aspect ratio.
      x[i] = projLon(c.lon) * 1.4;
      z[i] = projLat(c.lat) * 0.55;
      // Compute bbox of the country's largest shape, then diagonal/2
      let bestArea = 0;
      let bestDiag = 8;
      for (const sh of c.shapes) {
        let mn = Infinity, mx = -Infinity, mny = Infinity, mxy = -Infinity;
        for (const [lon, lat] of sh.outer) {
          if (lon < mn) mn = lon;
          if (lon > mx) mx = lon;
          if (lat < mny) mny = lat;
          if (lat > mxy) mxy = lat;
        }
        const w = (mx - mn) * COORD_SCALE;
        const h = (mxy - mny) * COORD_SCALE;
        const a = w * h;
        if (a > bestArea) {
          bestArea = a;
          bestDiag = Math.sqrt(w * w + h * h) * 0.5;
        }
      }
      // Clamp: small countries get min radius 6, huge countries cap at 80
      effRadius[i] = Math.max(6, Math.min(80, bestDiag));
    } else {
      x[i] = (Math.random() - 0.5) * 240;
      z[i] = (Math.random() - 0.5) * 80;
      effRadius[i] = 6;
    }
  }

  // === Pair distance map ===
  // For every (A, B) pair, compute a TARGET DISTANCE in world units. The
  // simulation then has a single spring per pair driving the actual distance
  // toward target. No separate Coulomb repulsion — the baseline distance for
  // pairs without data IS the repulsion.
  //
  // Distance-from-tone schedule (in world units, additive on top of effective radii):
  //   sym = +2.0  → very_close   = 4    (nearly touching)
  //   sym = +1.0  → close        = 18
  //   sym =  0.0  → BASELINE     = 35   (default minimum spacing)
  //   sym = -1.0  → far          = 90
  //   sym = -2.0  → very_far     = 180
  //
  // Mapped via piecewise linear; sym values beyond ±2 clamp.
  const BASELINE = 35;
  function targetDistanceForSym(sym) {
    const s = Math.max(-2, Math.min(2, sym));
    if (s >= 1)      return 4   + (1 - (s - 1)) * (18 - 4);
    if (s >= 0)      return 18  + (1 - s)       * (BASELINE - 18);
    if (s >= -1)     return BASELINE + (-s)     * (90 - BASELINE);
    return 90 + (-(s + 1))     * (180 - 90);
  }

  // For pairs with data (mutual delta_tone known): target = radius-sum + dist-from-tone.
  // For pairs without data: target = radius-sum + BASELINE (default spacing).
  // We store this in a flat array indexed by (i*N + j) for tight inner loop.
  const pairTarget = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const baseTarget = effRadius[i] + effRadius[j] + BASELINE;
      pairTarget[i * N + j] = baseTarget;
    }
  }
  // Apply known-tone targets — overrides baseline for pairs we have data for.
  // We also need the per-pair spring weight (stronger for higher-volume pairs).
  const pairWeight = new Float32Array(N * N);
  // Default weight for baseline pairs — small but nonzero so they're enforced gently.
  for (let i = 0; i < N * N; i++) pairWeight[i] = 0.4;
  for (const e of edges) {
    const i = idx.get(e.a), j = idx.get(e.b);
    const lo = Math.min(i, j), hi = Math.max(i, j);
    const target = effRadius[lo] + effRadius[hi] + targetDistanceForSym(e.sym);
    pairTarget[lo * N + hi] = target;
    // Active edges get full spring weight scaled by article-volume confidence
    pairWeight[lo * N + hi] = Math.min(2.5, 0.8 + e.weight * 0.25);
  }

  // Force parameters
  const SPRING_K = 0.018;      // single global stiffness; per-pair weight modulates
  const CENTER = 0.0006;       // gentle pull toward origin so layout stays bounded
  const DAMP = 0.62;
  const STEPS = 200;

  // Horizontal-bias factor: spring forces along Z are scaled DOWN, so a pair
  // with a target distance of 100 ends up preferring to satisfy that distance
  // along X rather than Z. This biases the entire layout toward horizontal
  // elongation (matching the canvas aspect ratio) while preserving the
  // ordering of pair distances — pairs that are "closer" or "farther" by tone
  // remain in the same relative ordering.
  const Z_BIAS = 0.45;

  for (let step = 0; step < STEPS; step++) {
    const fx = new Float32Array(N);
    const fz = new Float32Array(N);

    // Single pairwise spring: drives distance toward pairTarget.
    // The spring is asymmetric: when distance < target, full spring force
    // (push apart); when distance > target, only data-having pairs pull
    // back (so unrelated countries don't get dragged together by their
    // baseline). This makes target distance act as a MINIMUM, not a strict
    // attractor, for pairs without data.
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = x[j] - x[i];
        const dz = z[j] - z[i];
        const d = Math.sqrt(dx * dx + dz * dz) + 1e-6;
        const target = pairTarget[i * N + j];
        const w = pairWeight[i * N + j];
        const stretch = d - target;
        const asymK = (stretch < 0) ? 1.0 : (w > 1.0 ? 0.6 : 0.05);
        const force = SPRING_K * w * stretch * asymK;
        const ux = dx / d, uz = dz / d;
        // Apply horizontal bias: Z-component scaled down so the simulation
        // resolves "I need to be 100 units away" preferentially in the X axis.
        fx[i] += ux * force;
        fz[i] += uz * force * Z_BIAS;
        fx[j] -= ux * force;
        fz[j] -= uz * force * Z_BIAS;
      }
    }

    // Center pull + integrate.
    // Anisotropic damping & center pull: vertical (Z) gets stronger center pull
    // and slightly heavier damping than horizontal (X). This is a gentle
    // horizontal bias — it doesn't change spring rest lengths (so pair
    // distances are still semantic) but the simulation prefers settling into
    // a wider equilibrium when one is reachable.
    const DAMP_X = DAMP;
    const DAMP_Z = DAMP * 0.92;
    const CENTER_X = CENTER;
    const CENTER_Z = CENTER * 1.8;
    for (let i = 0; i < N; i++) {
      fx[i] -= x[i] * CENTER_X;
      fz[i] -= z[i] * CENTER_Z;
      vx[i] = (vx[i] + fx[i]) * DAMP_X;
      vz[i] = (vz[i] + fz[i]) * DAMP_Z;
      // velocity clamp
      const vm2 = vx[i]*vx[i] + vz[i]*vz[i];
      if (vm2 > 25) { const s = 5 / Math.sqrt(vm2); vx[i] *= s; vz[i] *= s; }
      x[i] += vx[i];
      z[i] += vz[i];
    }
  }

  // Post-process step 1: PCA rotation. Find the layout's dominant axis
  // (direction of greatest variance) and rotate the whole layout so that
  // axis runs horizontally. This preserves every pair distance exactly —
  // rotation is a rigid transform — while making the natural elongation
  // of the layout match the canvas's wide aspect ratio. Without this,
  // the layout's longest direction can land at any angle, producing a
  // "tall narrow" appearance even though the canvas is wide.
  {
    // Compute centroid
    let mx = 0, mz = 0;
    for (let i = 0; i < N; i++) { mx += x[i]; mz += z[i]; }
    mx /= N; mz /= N;
    // Compute 2x2 covariance entries
    let cxx = 0, czz = 0, cxz = 0;
    for (let i = 0; i < N; i++) {
      const dx = x[i] - mx, dz = z[i] - mz;
      cxx += dx * dx; czz += dz * dz; cxz += dx * dz;
    }
    cxx /= N; czz /= N; cxz /= N;
    // Closed-form eigendecomposition for 2x2 symmetric matrix.
    // Eigenvector for the LARGER eigenvalue defines the dominant axis.
    const tr = cxx + czz;
    const det = cxx * czz - cxz * cxz;
    const disc = Math.max(0, tr * tr / 4 - det);
    const lam1 = tr / 2 + Math.sqrt(disc);  // larger eigenvalue
    // Eigenvector for lam1: any non-zero column of (M - lam1*I)... easier:
    // for a symmetric 2x2, dominant eigenvector points at angle
    // theta where tan(2*theta) = 2*cxz / (cxx - czz). Equivalently:
    let theta = 0;
    if (Math.abs(cxz) > 1e-9 || Math.abs(cxx - czz) > 1e-9) {
      theta = 0.5 * Math.atan2(2 * cxz, cxx - czz);
    }
    // Rotate by -theta so dominant axis becomes the x-axis (horizontal)
    const cosT = Math.cos(-theta);
    const sinT = Math.sin(-theta);
    for (let i = 0; i < N; i++) {
      const dx = x[i] - mx, dz = z[i] - mz;
      x[i] = mx + dx * cosT - dz * sinT;
      z[i] = mz + dx * sinT + dz * cosT;
    }
  }

  // Post-process step 2: center the layout, scale to fit canvas. Use the
  // canvas's aspect ratio so we fill the available width/height proportionally.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (z[i] < minZ) minZ = z[i];
    if (z[i] > maxZ) maxZ = z[i];
  }
  const layoutW = maxX - minX || 1;
  const layoutH = maxZ - minZ || 1;
  const TARGET_W = MAP_W * 0.92;
  const TARGET_H = MAP_D * 0.75;
  const scale = Math.min(1.8, Math.min(TARGET_W / layoutW, TARGET_H / layoutH));
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  for (let i = 0; i < N; i++) {
    x[i] = (x[i] - cx) * scale;
    z[i] = (z[i] - cz) * scale;
  }

  // Translate offsets into the per-country offset map.
  // Offset = (final position) − (geographic position).
  // Countries not in the eligible-reporter set are marked hidden and won't
  // be drawn on the basemap or contribute to the heightfield.
  for (const [fips, off] of COUNTRY_OFFSETS) {
    if (!idx.has(fips)) {
      // Country was filtered out — hide it
      off.targetOx = 0;
      off.targetOz = 0;
      off.hidden = true;
      continue;
    }
    const i = idx.get(fips);
    const c = COUNTRIES[fips];
    const geoX = projLon(c.lon);
    const geoZ = projLat(c.lat);
    off.targetOx = x[i] - geoX;
    off.targetOz = z[i] - geoZ;
    off.hidden = false;
  }

  // Save edge data for optional rendering of affinity lines later
  REORG_EDGES = edges;
}

let REORG_EDGES = [];

// =========================================================================
// UP/DOWN computation — single-focal layout per pane
// =========================================================================
// For each pane, the focal country is pinned at the pane's center. Every
// other country's distance from the focal is determined by the focal's
// DIRECTED delta_tone toward it (how the focal country writes about it),
// not by symmetric mutual tone. Non-focal pairs use the baseline distance
// only. The layout is constrained to fit in a half-canvas (full width,
// half the height) so the basemap can stack two panes.
//
// paneId: 'up' or 'down'. focalFips: FIPS code of the focal country.
// Writes results into COUNTRY_OFFSETS_UP or COUNTRY_OFFSETS_DOWN.
// Returns true on success, false if focal has no data.

function computeUpDownOffsets(paneId, focalFips) {
  const offMap = paneId === 'up' ? COUNTRY_OFFSETS_UP : COUNTRY_OFFSETS_DOWN;
  const f = buildFilters();

  // Aggregate focal's directed tone toward every other country in the
  // current filter window. Result keyed by mentioned-country FIPS.
  const focalDirected = new Map();
  for (const r of ROWS) {
    if (r.reporter !== focalFips) continue;
    if (r.domain !== f.domain) continue;
    const di = DATE_INDEX.get(r.date);
    if (di < f.dateMin || di > f.dateMax) continue;
    if (!f.toneTags.has(toneTagOf(r.avg_tone))) continue;
    let p = focalDirected.get(r.mentioned);
    if (!p) { p = { dt: 0, c: 0 }; focalDirected.set(r.mentioned, p); }
    p.dt += r.delta_tone * r.count;
    p.c += r.count;
  }

  if (focalDirected.size === 0) {
    console.warn(`UP/DOWN: focal ${focalFips} has no coverage in current filter`);
    // Fall back to: focal at center, others hidden
    for (const [fips, off] of offMap) {
      off.hidden = (fips !== focalFips);
      off.ox = 0; off.oz = 0;
    }
    return false;
  }

  // Choose nodes: focal + every country focal has covered (with ≥3 articles).
  // Others are hidden in this pane.
  const nodes = new Set([focalFips]);
  for (const [men, p] of focalDirected) {
    if (p.c >= 3 && COUNTRIES[men]) nodes.add(men);
  }
  if (nodes.size < 2) {
    for (const [fips, off] of offMap) {
      off.hidden = (fips !== focalFips);
      off.ox = 0; off.oz = 0;
    }
    return false;
  }

  const nodeArr = [...nodes];
  const idx = new Map();
  nodeArr.forEach((fips, i) => idx.set(fips, i));
  const N = nodeArr.length;
  const focalIdx = idx.get(focalFips);

  // Effective radius per country = polygon BBOX HALF-DIAGONAL of the
  // largest shape. This is the circumscribed-circle radius: two countries
  // whose centers are at least r_i + r_j apart cannot have overlapping
  // polygons (each polygon is contained in its circle).
  //
  // PASS-13 FIX: removed the upper cap of 80 that previously crushed big
  // countries (Russia ~130, Canada ~110) into the same simulation footprint
  // as medium ones, causing visible polygon overlap in the pane. We also
  // remember per-axis half-W and half-H so pane sizing can use a tight,
  // axis-aware buffer rather than 2 * effRadius (which overstates a
  // wide-and-flat country's vertical extent).
  const effRadius = new Float32Array(N);
  const halfW = new Float32Array(N);
  const halfH = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const c = COUNTRIES[nodeArr[i]];
    let bestArea = 0, bestDiag = 8, bestW = 0, bestH = 0;
    for (const sh of c.shapes) {
      let mn = Infinity, mx = -Infinity, mny = Infinity, mxy = -Infinity;
      for (const [lon, lat] of sh.outer) {
        if (lon < mn) mn = lon; if (lon > mx) mx = lon;
        if (lat < mny) mny = lat; if (lat > mxy) mxy = lat;
      }
      const w = (mx - mn) * COORD_SCALE, h = (mxy - mny) * COORD_SCALE;
      const a = w * h;
      if (a > bestArea) {
        bestArea = a;
        bestDiag = Math.sqrt(w*w + h*h) * 0.5;
        bestW = w; bestH = h;
      }
    }
    effRadius[i] = Math.max(6, bestDiag);   // floor only, no upper cap
    halfW[i] = bestW / 2;
    halfH[i] = bestH / 2;
  }

  // Distance schedule. The returned value is the GAP between polygon
  // edges (added on top of effRadius[i] + effRadius[j] to get the
  // center-to-center target). The schedule encodes:
  //
  //   sym = +2.0 → 4    extreme positive: effectively touching the focal
  //   sym = +1.0 → 30   moderately positive: close, clear gap
  //   sym =  0.0 → 70   BASELINE: comfortable, visibly distinct gap
  //   sym = -1.0 → 160  moderately negative: clearly far
  //   sym = -2.0 → 300  extreme negative: pushed to the edge of the pane
  //
  // PASS-13: BASELINE doubled and the negative end pushed out so neutral
  // coverage has obvious breathing room and "moderately bad" is
  // unmistakably farther than neutral. The previous schedule (BASELINE 35,
  // -2 → 180) compressed all tiers into a tight clump around the focal,
  // defeating the purpose of the mode.
  const BASELINE = 70;
  function targetDistanceForSym(sym) {
    const s = Math.max(-2, Math.min(2, sym));
    if (s >= 1)      return 4   + (1 - (s - 1)) * (30 - 4);
    if (s >= 0)      return 30  + (1 - s)       * (BASELINE - 30);
    if (s >= -1)     return BASELINE + (-s)     * (160 - BASELINE);
    return 160 + (-(s + 1))     * (300 - 160);
  }

  // Pair targets:
  //   - focal-to-others: based on focal's DIRECTED delta_tone (focal → other)
  //   - other-to-other: based on the OTHER PAIR's symmetric mutual tone
  //     (the same data Mode II uses). This makes non-focal countries respect
  //     their own relationships to each other, so they spread out properly
  //     instead of collapsing on top of one another.
  //
  // The aggregator below ignores the reporter-eligibility filter because
  // we need rows from ALL reporters to compute mutual tone between any
  // two countries in our node set, not just from focal's reporters.

  const allDirected = new Map();  // "A>B" -> {dt, c} — all rows in current filter window
  for (const r of ROWS) {
    if (r.domain !== f.domain) continue;
    const di = DATE_INDEX.get(r.date);
    if (di < f.dateMin || di > f.dateMax) continue;
    if (!f.toneTags.has(toneTagOf(r.avg_tone))) continue;
    // Only aggregate rows where BOTH reporter and mentioned are in our node set.
    if (!nodes.has(r.reporter) || !nodes.has(r.mentioned)) continue;
    const k = r.reporter + '>' + r.mentioned;
    let p = allDirected.get(k);
    if (!p) { p = { dt: 0, c: 0 }; allDirected.set(k, p); }
    p.dt += r.delta_tone * r.count;
    p.c += r.count;
  }

  const pairTarget = new Float32Array(N * N);
  const pairWeight = new Float32Array(N * N);
  // Default: BASELINE for any pair without data
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      pairTarget[i * N + j] = effRadius[i] + effRadius[j] + BASELINE;
      pairWeight[i * N + j] = 0.4;
    }
  }

  // Apply symmetric mutual-tone targets between every NON-FOCAL pair.
  // This is the key fix: without these targets, non-focal countries had no
  // forces driving them apart and they all collapsed near the focal.
  for (const [k, p] of allDirected) {
    const [a, b] = k.split('>');
    if (a >= b) continue;  // process each unordered pair once
    if (a === focalFips || b === focalFips) continue;  // focal handled below
    const k2 = b + '>' + a;
    const p2 = allDirected.get(k2);
    if (!p2) continue;
    if (p.c < 3 || p2.c < 3) continue;
    const i = idx.get(a), j = idx.get(b);
    if (i === undefined || j === undefined) continue;
    const lo = Math.min(i, j), hi = Math.max(i, j);
    const dtAvg = (p.dt / p.c + p2.dt / p2.c) / 2;
    pairTarget[lo * N + hi] = effRadius[lo] + effRadius[hi] + targetDistanceForSym(dtAvg);
    pairWeight[lo * N + hi] = Math.min(2.0, 0.7 + Math.log(Math.min(p.c, p2.c) + 1) * 0.18);
  }

  // Focal-to-others: directed targets (how the focal writes about each)
  for (const [men, p] of focalDirected) {
    if (!idx.has(men)) continue;
    if (men === focalFips) continue;
    const dt = p.dt / p.c;
    const i = Math.min(focalIdx, idx.get(men));
    const j = Math.max(focalIdx, idx.get(men));
    pairTarget[i * N + j] = effRadius[i] + effRadius[j] + targetDistanceForSym(dt);
    pairWeight[i * N + j] = Math.min(2.5, 1.4 + Math.log(p.c + 1) * 0.25);
  }

  // Initialize positions: focal at origin. Each non-focal country is seeded
  // at approximately its target distance from focal, on a horizontally-
  // stretched ring. Seeding at roughly the right distance helps the simulation
  // converge to a clean layout in 200 steps rather than wandering.
  const x = new Float32Array(N);
  const z = new Float32Array(N);
  const vx = new Float32Array(N);
  const vz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (i === focalIdx) { x[i] = 0; z[i] = 0; continue; }
    const angle = (i / N) * Math.PI * 2;
    // Use the target distance from focal as the seed radius (or BASELINE
    // if no focal data for this country).
    const lo = Math.min(focalIdx, i), hi = Math.max(focalIdx, i);
    const seedR = pairTarget[lo * N + hi];
    x[i] = Math.cos(angle) * seedR * 1.1;       // X-stretched
    z[i] = Math.sin(angle) * seedR * 0.55;      // Z-compressed
  }

  // Force parameters — same as Mode II
  const SPRING_K = 0.018;
  const CENTER_X = 0.0006;
  const CENTER_Z = 0.0006 * 1.8;  // stronger Z center pull (horizontal bias)
  const DAMP_X = 0.62;
  const DAMP_Z = 0.62 * 0.92;
  const STEPS = 350;  // PASS-13: more steps to let the larger schedule settle
  const Z_BIAS = 0.5;  // Spring forces along Z scaled down → horizontal layout

  for (let step = 0; step < STEPS; step++) {
    const fx = new Float32Array(N);
    const fz = new Float32Array(N);

    // Pairwise springs (same asymmetric law as Mode II, with horizontal bias)
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = x[j] - x[i];
        const dz = z[j] - z[i];
        const d = Math.sqrt(dx*dx + dz*dz) + 1e-6;
        const target = pairTarget[i * N + j];
        const w = pairWeight[i * N + j];
        const stretch = d - target;
        const asymK = (stretch < 0) ? 1.0 : (w > 1.0 ? 0.6 : 0.05);
        const force = SPRING_K * w * stretch * asymK;
        const ux = dx / d, uz = dz / d;
        fx[i] += ux * force;
        fz[i] += uz * force * Z_BIAS;
        fx[j] -= ux * force;
        fz[j] -= uz * force * Z_BIAS;
      }
    }

    // Pin focal: zero out its forces
    fx[focalIdx] = 0; fz[focalIdx] = 0;

    // Integrate
    for (let i = 0; i < N; i++) {
      if (i === focalIdx) { x[i] = 0; z[i] = 0; continue; }
      fx[i] -= x[i] * CENTER_X;
      fz[i] -= z[i] * CENTER_Z;
      vx[i] = (vx[i] + fx[i]) * DAMP_X;
      vz[i] = (vz[i] + fz[i]) * DAMP_Z;
      const vm2 = vx[i]*vx[i] + vz[i]*vz[i];
      if (vm2 > 25) { const s = 5 / Math.sqrt(vm2); vx[i] *= s; vz[i] *= s; }
      x[i] += vx[i];
      z[i] += vz[i];
    }
  }

  // PCA rotation around focal (which is at origin) — focal stays at origin
  {
    let cxx = 0, czz = 0, cxz = 0;
    for (let i = 0; i < N; i++) {
      cxx += x[i] * x[i];
      czz += z[i] * z[i];
      cxz += x[i] * z[i];
    }
    let theta = 0;
    if (Math.abs(cxz) > 1e-9 || Math.abs(cxx - czz) > 1e-9) {
      theta = 0.5 * Math.atan2(2 * cxz, cxx - czz);
    }
    const cosT = Math.cos(-theta);
    const sinT = Math.sin(-theta);
    for (let i = 0; i < N; i++) {
      const dx = x[i], dz = z[i];
      x[i] = dx * cosT - dz * sinT;
      z[i] = dx * sinT + dz * cosT;
    }
  }

  // Scale & position. The layout's natural extent depends on the
  // schedule + effRadii; we scale to fit the pane but with a minimum-
  // scale floor, because polygons themselves do NOT scale — shrinking
  // positions too much pulls polygons into each other.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (z[i] < minZ) minZ = z[i];
    if (z[i] > maxZ) maxZ = z[i];
  }
  const layoutW = maxX - minX || 1;
  const layoutH = maxZ - minZ || 1;

  // PASS-13: use actual max half-W and half-H (not effRadius, which is
  // the half-DIAGONAL and overstates per-axis extent). For wide-and-flat
  // countries like Russia this gives a much tighter, accurate buffer.
  // We also use slightly more of the canvas (0.95 W × 0.46 H per pane).
  let maxHalfW = 0, maxHalfH = 0;
  for (let i = 0; i < N; i++) {
    if (halfW[i] > maxHalfW) maxHalfW = halfW[i];
    if (halfH[i] > maxHalfH) maxHalfH = halfH[i];
  }
  const TARGET_W = Math.max(60, MAP_W * 0.95 - 2 * maxHalfW);
  const TARGET_H = Math.max(60, MAP_D * 0.46 - 2 * maxHalfH);

  // Cap minimum scale at 0.65: going smaller compresses positions enough
  // to introduce polygon overlap even after the simulation has placed
  // centers correctly. If the layout is too big to fit at 0.65, we accept
  // overflow past the pane bounds — the user's intent is NEVER OVERLAP,
  // even at the cost of some countries spilling outside the pane.
  const fitScale = Math.min(TARGET_W / layoutW, TARGET_H / layoutH);
  const scale = Math.max(0.65, Math.min(1.4, fitScale));

  // Center the layout's bbox on the pane origin. Focal won't be exactly
  // centered if its neighbors cluster on one side, but the bbox centering
  // gives the most balanced visual.
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  for (let i = 0; i < N; i++) {
    x[i] = (x[i] - cx) * scale;
    z[i] = (z[i] - cz) * scale;
  }

  // PASS-14: integrated overlap repair + per-pane Z clamp.
  //
  // Two constraints to satisfy simultaneously:
  //   (A) No two countries' circumscribed circles overlap.
  //   (B) Each country's POLYGON (not just its center) stays in its pane,
  //       with a clear margin from the divider and canvas edges.
  //
  // We alternate (A) and (B) inside a single loop and iterate until
  // neither moves anything. Doing them in sequence (repair-then-clamp,
  // or clamp-then-repair) lets one undo the other; alternating lets them
  // settle into a layout where both hold.
  //
  // The Z-clamp uses halfH[i] (per-axis polygon half-height) so the
  // POLYGON edge — not just the country's center — stays clear of the
  // divider and edges. Previous passes only clamped centers, so big
  // polygons could still bleed across the divider into the other pane.
  const REPAIR_BUFFER = 4;        // tiny gap even at sym=+2 ("touching")
  const REPAIR_PASSES = 80;
  const DIVIDER_GAP = 26;         // total margin between the two panes
  const HALF_DIVIDER = DIVIDER_GAP / 2;
  const EDGE_BUFFER = 8;          // gap from canvas top/bottom edges
  for (let pass = 0; pass < REPAIR_PASSES; pass++) {
    let moved = false;

    // (A) Pairwise overlap push-apart. Focal stays pinned at origin.
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = x[j] - x[i];
        const dz = z[j] - z[i];
        const d = Math.sqrt(dx * dx + dz * dz);
        const minDist = effRadius[i] + effRadius[j] + REPAIR_BUFFER;
        if (d >= minDist) continue;
        moved = true;
        const overlap = (minDist - d) + 0.05;
        let ux, uz;
        if (d < 1e-3) {
          // Coincident — pick a deterministic but i-varied direction
          ux = Math.cos((i * 7 + j) * 0.41);
          uz = Math.sin((i * 7 + j) * 0.41);
        } else {
          ux = dx / d; uz = dz / d;
        }
        if (i === focalIdx) {
          x[j] += ux * overlap; z[j] += uz * overlap;
        } else if (j === focalIdx) {
          x[i] -= ux * overlap; z[i] -= uz * overlap;
        } else {
          x[i] -= ux * overlap * 0.5; z[i] -= uz * overlap * 0.5;
          x[j] += ux * overlap * 0.5; z[j] += uz * overlap * 0.5;
        }
      }
    }

    // (B) Per-pane Z clamp by POLYGON EDGE, not center. Final z is
    // (z[i] + paneShift); polygon spans final ± halfH[i].
    //   Top pane    (paneShift = -MAP_D/4):
    //     final - halfH ≥ -MAP_D/2 + EDGE_BUFFER   (above canvas top)
    //     final + halfH ≤ -HALF_DIVIDER             (above divider gap)
    //   Bottom pane (paneShift = +MAP_D/4):
    //     final - halfH ≥ +HALF_DIVIDER             (below divider gap)
    //     final + halfH ≤ +MAP_D/2 - EDGE_BUFFER    (above canvas bottom)
    for (let i = 0; i < N; i++) {
      if (i === focalIdx) continue;
      let zMin, zMax;
      if (paneId === 'up') {
        zMin = -MAP_D/4 + EDGE_BUFFER + halfH[i];
        zMax =  MAP_D/4 - HALF_DIVIDER - halfH[i];
      } else {
        zMin = -MAP_D/4 + HALF_DIVIDER + halfH[i];
        zMax =  MAP_D/4 - EDGE_BUFFER - halfH[i];
      }
      if (zMin > zMax) {
        // Country too tall to fit cleanly — center it in the pane and
        // accept that it slightly nicks an edge. Rare in practice.
        const target = (zMin + zMax) / 2;
        if (Math.abs(z[i] - target) > 0.05) { z[i] = target; moved = true; }
      } else {
        if (z[i] < zMin) { z[i] = zMin; moved = true; }
        if (z[i] > zMax) { z[i] = zMax; moved = true; }
      }
    }

    if (!moved) break;
  }

  // After scaling+centering, layout fits in approximately
  //   x ∈ [-TARGET_W/2, +TARGET_W/2]
  //   z ∈ [-TARGET_H/2, +TARGET_H/2]
  // Now translate the whole pane up or down so it sits cleanly in its half:
  //   'up' pane center at z = -MAP_D/4 (top-half center)
  //   'down' pane center at z = +MAP_D/4 (bottom-half center)
  const paneShift = paneId === 'up' ? -MAP_D / 4 : MAP_D / 4;

  // Write to offsets. Hidden = countries not in this pane's node set.
  for (const [fips, off] of offMap) {
    if (!idx.has(fips)) {
      off.hidden = true;
      off.ox = 0; off.oz = 0;
      continue;
    }
    const i = idx.get(fips);
    const c = COUNTRIES[fips];
    const geoX = projLon(c.lon);
    const geoZ = projLat(c.lat);
    off.ox = x[i] - geoX;
    off.oz = z[i] + paneShift - geoZ;
    off.hidden = false;
  }

  // PASS-16: cache the focal's directed delta_tone + count toward each
  // non-focal country in this pane, so Compare lines/tooltips can read
  // the values without re-aggregating ROWS on every hover. Only mentions
  // we actually placed in the pane (idx.has) are kept.
  const cachedEdges = [];
  for (const [men, p] of focalDirected) {
    if (men === focalFips) continue;
    if (!idx.has(men)) continue;
    cachedEdges.push({ fips: men, sym: p.dt / p.c, count: p.c });
  }
  if (paneId === 'up') updownPaneEdgesUp = cachedEdges;
  else                 updownPaneEdgesDown = cachedEdges;

  return true;
}

// =========================================================================
// Geometry rebuild — applies current offsets to polygons & heightfield
// =========================================================================

// Rebuild SHAPES (resampled boundaries + bboxes) using current offsets.
// SHAPES is consumed by applyDomain() to rasterize the heightfield.
function rebuildShapesWithOffsets() {
  SHAPES.length = 0;

  // UP/DOWN mode: include shapes from BOTH panes in the heightfield, each
  // at their pane-shifted positions. A country covered in both panes will
  // appear as two separate mountains (one in each pane).
  if (currentMode === 'updown') {
    for (const paneId of ['up', 'down']) {
      const offMap = paneId === 'up' ? COUNTRY_OFFSETS_UP : COUNTRY_OFFSETS_DOWN;
      for (const fips in COUNTRIES) {
        const c = COUNTRIES[fips];
        const off = offMap.get(fips);
        if (!off || off.hidden) continue;
        const oxLon = off.ox / COORD_SCALE;
        const ozLat = -off.oz / COORD_SCALE;
        const totalArea = c.shapes.reduce((s, sh) => s + ringArea(sh.outer), 0);
        for (const sh of c.shapes) {
          const a = ringArea(sh.outer);
          if (a < 0.05) continue;
          const ring = resampleRing(sh.outer, MAX_BOUNDARY_VERTS);
          const flat = new Float32Array(ring.length * 2);
          let minLon = Infinity, maxLon = -Infinity;
          let minLat = Infinity, maxLat = -Infinity;
          for (let i = 0; i < ring.length; i++) {
            const x = ring[i][0] + oxLon;
            const y = ring[i][1] + ozLat;
            flat[i * 2] = x;
            flat[i * 2 + 1] = y;
            if (x < minLon) minLon = x;
            if (x > maxLon) maxLon = x;
            if (y < minLat) minLat = y;
            if (y > maxLat) maxLat = y;
          }
          SHAPES.push({
            fips, areaWeight: a / Math.max(totalArea, 1e-6),
            minLon, maxLon, minLat, maxLat, boundary: flat,
          });
        }
      }
    }
    return;
  }

  // Geographic / Reorganized: single layout from COUNTRY_OFFSETS
  for (const fips in COUNTRIES) {
    const c = COUNTRIES[fips];
    const off = COUNTRY_OFFSETS.get(fips);
    if (off && off.hidden) continue;  // filtered out in Reorganized mode
    const oxLon = off ? off.ox / COORD_SCALE : 0;
    const ozLat = off ? -off.oz / COORD_SCALE : 0;
    const totalArea = c.shapes.reduce((s, sh) => s + ringArea(sh.outer), 0);
    for (const sh of c.shapes) {
      const a = ringArea(sh.outer);
      if (a < 0.05) continue;
      const ring = resampleRing(sh.outer, MAX_BOUNDARY_VERTS);
      const flat = new Float32Array(ring.length * 2);
      let minLon = Infinity, maxLon = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;
      for (let i = 0; i < ring.length; i++) {
        const x = ring[i][0] + oxLon;
        const y = ring[i][1] + ozLat;
        flat[i * 2] = x;
        flat[i * 2 + 1] = y;
        if (x < minLon) minLon = x;
        if (x > maxLon) maxLon = x;
        if (y < minLat) minLat = y;
        if (y > maxLat) maxLat = y;
      }
      SHAPES.push({
        fips, areaWeight: a / Math.max(totalArea, 1e-6),
        minLon, maxLon, minLat, maxLat, boundary: flat,
      });
    }
  }
}

// Rebuild basemap canvas using current offsets. The canonical
// makeBasemapTexture is offset-aware, so we just regenerate.
function rebuildBasemapTexture() {
  const tex = makeBasemapTexture();
  basemapMat.map.dispose();
  basemapMat.map = tex;
  basemapMat.needsUpdate = true;
}

// =========================================================================
// Mode tween — runs each frame while modeTransition.active
// =========================================================================

// =========================================================================
// Mode tween — simplified to a snap, with the heightfield itself tweening
// via the existing applyFiltersWithTween path. Rebuilding SHAPES + basemap +
// bboxes per-frame is too expensive (~150ms each), so we accept the visual
// abruptness on the basemap and let only the mountains tween.
// =========================================================================

function stepReorganization() {
  if (!modeTransition.active) return;

  if (currentMode === 'updown') {
    // UP/DOWN mode: rebuild basemap from both panes, rebuild SHAPES (with
    // both panes unioned) for the heightfield, rebuild bboxes for clicks,
    // and kick a filter-tween so the heightfield bakes mountains.
    rebuildBasemapTexture();
    rebuildShapesWithOffsets();
    rebuildBboxesForUpDown();
    applyFiltersWithTween(buildFilters());
    modeTransition.active = false;
    refreshCompareVisuals();   // PASS-16
    return;
  }

  // Geographic / Reorganized: snap offsets to target, rebuild, kick tween
  for (const off of COUNTRY_OFFSETS.values()) {
    off.ox = off.targetOx;
    off.oz = off.targetOz;
  }
  rebuildShapesWithOffsets();
  rebuildBasemapTexture();
  rebuildBboxesWithOffsets();
  applyFiltersWithTween(buildFilters());
  modeTransition.active = false;
  refreshCompareVisuals();     // PASS-16
}

// Bbox cache for UP/DOWN mode. Each country may appear in either or both
// panes; we tag each bbox entry with its pane so click resolution can route.
function rebuildBboxesForUpDown() {
  COUNTRY_BBOXES.length = 0;
  for (const paneId of ['up', 'down']) {
    const offMap = paneId === 'up' ? COUNTRY_OFFSETS_UP : COUNTRY_OFFSETS_DOWN;
    for (const fips in COUNTRIES) {
      const c = COUNTRIES[fips];
      const off = offMap.get(fips);
      if (!off || off.hidden) continue;
      const oxLon = off.ox / COORD_SCALE;
      const ozLat = -off.oz / COORD_SCALE;
      for (const shape of c.shapes) {
        let minLon = Infinity, maxLon = -Infinity;
        let minLat = Infinity, maxLat = -Infinity;
        for (const [lon, lat] of shape.outer) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
        COUNTRY_BBOXES.push({
          fips,
          minLon: minLon + oxLon,
          maxLon: maxLon + oxLon,
          minLat: minLat + ozLat,
          maxLat: maxLat + ozLat,
          ring: shape.outer,
          oxLon, ozLat,
          pane: paneId,  // Used by click resolution to differentiate
        });
      }
    }
  }
}

// Per-country bbox cache, used by countryAtWorldXZ for click resolution.
// Needs to be rebuilt when offsets change so click hits resolve correctly.
function rebuildBboxesWithOffsets() {
  COUNTRY_BBOXES.length = 0;
  for (const fips in COUNTRIES) {
    const c = COUNTRIES[fips];
    const off = COUNTRY_OFFSETS.get(fips);
    if (off && off.hidden) continue;  // filtered out in Reorganized mode
    const oxLon = off ? off.ox / COORD_SCALE : 0;
    const ozLat = off ? -off.oz / COORD_SCALE : 0;
    for (const shape of c.shapes) {
      let minLon = Infinity, maxLon = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;
      for (const [lon, lat] of shape.outer) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      // Offset-translated bbox in lon/lat space
      COUNTRY_BBOXES.push({
        fips,
        minLon: minLon + oxLon,
        maxLon: maxLon + oxLon,
        minLat: minLat + ozLat,
        maxLat: maxLat + ozLat,
        ring: shape.outer,
        oxLon, ozLat,  // store so click handler can subtract for point-in-polygon test
      });
    }
  }
}

// World (x, z) → fips, accounting for offsets in the bbox + ring lookup.
function countryAtWorldXZ(wx, wz) {
  const lon = wx / COORD_SCALE;
  const lat = -wz / COORD_SCALE;
  for (const b of COUNTRY_BBOXES) {
    if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) continue;
    // Subtract offset before testing against the original ring
    if (pointInRing(lon - b.oxLon, lat - b.ozLat, b.ring)) return b.fips;
  }
  return null;
}

// =========================================================================
// PASS-16 — Compare feature
//
// When the user toggles Compare ON, the click-to-open-modal interaction is
// replaced by click-to-set-reference (Mode II only — UP/DOWN uses the
// per-pane focals as implicit references). With a reference active:
//   - faint lines fan out from the reference to every other country in
//     view, color-coded by tone (red=hostile, teal=friendly, dim=neutral)
//   - hovering a country shows a comparison tooltip with the affinity
//     score, tier label, and underlying article counts
//   - the reference country gets a thin gold outline
//
// All compare visuals are children of compareGroup so they can be cleared
// in one call. Lines use a single LineSegments mesh with vertex colors
// (low-signal pairs get dimmer color baked in — there's no per-line alpha
// in plain WebGL line materials, so we encode confidence in the color
// itself rather than fighting transparency).
// =========================================================================

const compareGroup = new THREE.Group();
scene.add(compareGroup);

// Schedule tier label — buckets the symmetric/directed delta_tone into
// the same five categories the layout's distance schedule uses.
function compareTierLabel(sym) {
  if (sym >=  1.5) return 'extreme positive';
  if (sym >=  0.5) return 'close';
  if (sym >  -0.5) return 'baseline';
  if (sym >  -1.5) return 'far';
  return 'very far';
}

// Look up the symmetric Mode-II edge for a pair of countries. REORG_EDGES
// stores edges with a < b alphabetically; we normalize before searching.
// Returns {sym, cA, cB} or null if no mutual data.
function findReorgEdge(fipsA, fipsB) {
  if (fipsA === fipsB) return null;
  const a = fipsA < fipsB ? fipsA : fipsB;
  const b = fipsA < fipsB ? fipsB : fipsA;
  for (const e of REORG_EDGES) {
    if (e.a === a && e.b === b) return e;
  }
  return null;
}

// World-space position of a country's centroid in the current mode.
// In UP/DOWN this depends on which pane the country is in (a country
// covered in both panes appears twice — caller passes paneId to disambiguate).
function countryWorldPos(fips, paneId = null) {
  const c = COUNTRIES[fips];
  if (!c) return null;
  const offMap = paneId === 'up'   ? COUNTRY_OFFSETS_UP
              : paneId === 'down'  ? COUNTRY_OFFSETS_DOWN
              :                      COUNTRY_OFFSETS;
  const off = offMap.get(fips);
  if (off && off.hidden) return null;
  const ox = off ? off.ox : 0;
  const oz = off ? off.oz : 0;
  return { x: projLon(c.lon) + ox, z: projLat(c.lat) + oz };
}

// Sample the existing tone palette into an [r, g, b] in [0..1].
// (Reuses toneColor's logic via the tmpColor scratch object.)
function toneRGB(sym) {
  toneColor(sym, tmpColor);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}

// Dispose every Three.js child of compareGroup and remove them.
function clearCompareVisuals() {
  while (compareGroup.children.length > 0) {
    const obj = compareGroup.children.pop();
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  }
}

// Build a thin gold outline mesh tracing the reference country's polygon
// rings, slightly elevated so it sits above the basemap. Used in Mode II;
// in UP/DOWN the focals are already gold-highlighted on the basemap canvas.
function buildReferenceOutline(fips, paneId = null) {
  const c = COUNTRIES[fips];
  if (!c) return;
  const pos = countryWorldPos(fips, paneId);
  if (!pos) return;
  // The world position uses the country's centroid + offset. For drawing
  // the outline we need the offset alone (so each polygon vertex's lon/lat
  // gets the same delta applied).
  const ox = pos.x - projLon(c.lon);
  const oz = pos.z - projLat(c.lat);
  const mat = new THREE.LineBasicMaterial({
    color: 0xc9a96e,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  for (const sh of c.shapes) {
    const points = [];
    for (const [lon, lat] of sh.outer) {
      points.push(new THREE.Vector3(projLon(lon) + ox, 3.5, projLat(lat) + oz));
    }
    points.push(points[0].clone());  // close the loop
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 999;          // draw last, above other transparents
    compareGroup.add(line);
  }
}

// Build a fan of lines from one reference position to a list of targets.
// Each entry of `targets` is {pos: {x,z}, sym, count}. Color is the tone
// palette for `sym`; intensity scales with |sym| × confidence so neutral /
// low-signal pairs fade out while strong pairs pop.
//   - This is a single LineSegments mesh: 2 vertices per line.
function buildFanLines(refPos, targets) {
  if (!refPos || targets.length === 0) return;
  const positions = new Float32Array(targets.length * 6);     // 2 verts × 3 coords
  const colors    = new Float32Array(targets.length * 6);
  const Y = 2.5;  // slightly above basemap, below most mountains
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t.pos) continue;
    const [r, g, b] = toneRGB(t.sym);
    // Intensity: combine |sym| (0..2) with log-confidence (0..~5)
    const symStrength = Math.min(1, Math.abs(t.sym) / 1.5);
    const conf = Math.min(1, Math.log((t.count || 0) + 1) / 4);
    const intensity = 0.25 + 0.75 * Math.max(symStrength, conf * 0.6);
    const o = i * 6;
    positions[o + 0] = refPos.x; positions[o + 1] = Y; positions[o + 2] = refPos.z;
    positions[o + 3] = t.pos.x;  positions[o + 4] = Y; positions[o + 5] = t.pos.z;
    colors[o + 0] = r * intensity; colors[o + 1] = g * intensity; colors[o + 2] = b * intensity;
    colors[o + 3] = r * intensity; colors[o + 4] = g * intensity; colors[o + 5] = b * intensity;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(geom, mat);
  lines.renderOrder = 998;
  compareGroup.add(lines);
}

// Master rebuild: re-derive all compare visuals from current state. Called
// when Compare toggles, when the reference changes, after layout re-runs
// (filter changes), and on mode switches.
function refreshCompareVisuals() {
  clearCompareVisuals();
  if (!compareState.on) return;

  if (currentMode === 'reorganized') {
    if (!compareState.refFips) return;
    const refPos = countryWorldPos(compareState.refFips);
    if (!refPos) return;
    // One pass over REORG_EDGES to collect the reference's neighbors;
    // avoids an O(N · |edges|) scan inside the country loop below.
    const refEdges = new Map();
    for (const e of REORG_EDGES) {
      if (e.a === compareState.refFips)      refEdges.set(e.b, e);
      else if (e.b === compareState.refFips) refEdges.set(e.a, e);
    }
    const targets = [];
    for (const fips in COUNTRIES) {
      if (fips === compareState.refFips) continue;
      const off = COUNTRY_OFFSETS.get(fips);
      if (off && off.hidden) continue;     // not in current filter
      const e = refEdges.get(fips);
      if (!e) continue;                    // no mutual data → no line
      const tpos = countryWorldPos(fips);
      if (!tpos) continue;
      targets.push({ pos: tpos, sym: e.sym, count: Math.min(e.cA, e.cB) });
    }
    buildFanLines(refPos, targets);
    buildReferenceOutline(compareState.refFips);
  } else if (currentMode === 'updown') {
    // Lines from each pane's focal to its non-focal neighbors. Focals are
    // already gold-highlighted on the basemap canvas, so no extra outline.
    if (updownTopFips) {
      const refPos = countryWorldPos(updownTopFips, 'up');
      const targets = updownPaneEdgesUp.map(e => ({
        pos: countryWorldPos(e.fips, 'up'),
        sym: e.sym, count: e.count,
      })).filter(t => t.pos);
      buildFanLines(refPos, targets);
    }
    if (updownBottomFips) {
      const refPos = countryWorldPos(updownBottomFips, 'down');
      const targets = updownPaneEdgesDown.map(e => ({
        pos: countryWorldPos(e.fips, 'down'),
        sym: e.sym, count: e.count,
      })).filter(t => t.pos);
      buildFanLines(refPos, targets);
    }
  }
}

// Exposed helpers used by the click handler and toggle button.
function setCompareReference(fips) {
  compareState.refFips = fips;
  refreshCompareVisuals();
}
function clearCompareReference() {
  compareState.refFips = null;
  refreshCompareVisuals();
}

// PASS-16b: floating affinity-score label anchored to the midpoint of the
// reference→hovered line. The element is fixed-positioned in screen space;
// each frame we project the world-space midpoint to screen coords and
// move it. World-space anchoring (rather than cursor-following) makes the
// label feel attached to the line, which is what makes it read as "the
// number FOR THIS line" rather than "a tooltip near the cursor".
// (lineLabelEl and compareLineLabel are hoisted to the top of the module
// — onMouseMove can fire before this section in the file is reached.)
function showLineLabel(refPos, tgtPos, sym) {
  // Anchor at the midpoint of the line, slightly elevated so it visually
  // floats above the line itself.
  compareLineLabel.midpoint.set(
    (refPos.x + tgtPos.x) / 2,
    5,
    (refPos.z + tgtPos.z) / 2,
  );
  compareLineLabel.active = true;
  const symText = (sym >= 0 ? '+' : '') + sym.toFixed(2);
  const tier = compareTierLabel(sym);
  lineLabelEl.innerHTML = symText + ` <span class="tier">${tier}</span>`;
  lineLabelEl.classList.remove('neg', 'pos');
  if      (sym < -0.5) lineLabelEl.classList.add('neg');
  else if (sym >  0.5) lineLabelEl.classList.add('pos');
  lineLabelEl.classList.add('visible');
}
function hideLineLabel() {
  compareLineLabel.active = false;
  lineLabelEl.classList.remove('visible');
}

// Update the label's screen position from its world-space anchor. Called
// each frame from tick(); cheap (one Vector3.project + 2 mutations).
function updateLineLabelPosition() {
  if (!compareLineLabel.active) return;
  const v = compareLineLabel.midpoint.clone().project(camera);
  if (v.z >= 1) {
    // Behind the camera — hide rather than render in a wrong spot
    lineLabelEl.classList.remove('visible');
    return;
  }
  // .project gives NDC in [-1, +1]; convert to viewport pixels.
  const x = (v.x + 1) * 0.5 * window.innerWidth;
  const y = (1 - v.y) * 0.5 * window.innerHeight;
  lineLabelEl.style.left = `${x}px`;
  lineLabelEl.style.top  = `${y}px`;
  if (!lineLabelEl.classList.contains('visible')) {
    lineLabelEl.classList.add('visible');
  }
}

// Update enabled state and label of the Compare button. Called on mode
// changes. Disabled in Geographic (distance has no semantic meaning when
// countries are at their real geographic positions).
function updateCompareButtonState() {
  const btn = document.getElementById('compare-btn');
  if (!btn) return;
  const allowed = currentMode === 'reorganized' || currentMode === 'updown';
  btn.disabled = !allowed;
  btn.classList.toggle('active', compareState.on && allowed);
  btn.textContent = 'Compare: ' + (compareState.on && allowed ? 'On' : 'Off');
}

// =========================================================================
// Mode toggle handler
// =========================================================================

function setMode(targetMode) {
  if (currentMode === targetMode) return;
  if (modeTransition.active) return;

  // Run entry guards FIRST (no side-effects yet)
  if (targetMode === 'updown' && filterState.countries.size !== 2) {
    console.warn('UP/DOWN: requires exactly 2 countries selected');
    return;
  }

  // Switch the world's extent (W and D) before computing offsets so each
  // mode gets the canvas it needs. Geographic uses the standard 2:1
  // world. Reorganized and UP/DOWN each get progressively more room so
  // their layouts don't clip at the edges.
  if (targetMode === 'updown') {
    setMapDimensions(MAP_W_UPDOWN, MAP_D_UPDOWN);
  } else if (targetMode === 'reorganized') {
    setMapDimensions(MAP_W_REORG, MAP_D_REORG);
  } else {
    setMapDimensions(MAP_W_BASE, MAP_D_BASE);
  }

  // Handle entry into each mode
  if (targetMode === 'reorganized') {
    computeReorganizedOffsets();
  } else if (targetMode === 'updown') {
    const arr = [...filterState.countries];
    updownTopFips = arr[0];
    updownBottomFips = arr[1];
    const okUp = computeUpDownOffsets('up', updownTopFips);
    const okDown = computeUpDownOffsets('down', updownBottomFips);
    if (!okUp || !okDown) {
      console.warn('UP/DOWN: insufficient data for one of the focal countries');
      // Revert to the canvas the previous mode was using so we don't jump
      // the user into a smaller world than they had.
      if (currentMode === 'reorganized') {
        setMapDimensions(MAP_W_REORG, MAP_D_REORG);
      } else {
        setMapDimensions(MAP_W_BASE, MAP_D_BASE);
      }
      return;
    }
    // Elevation toggle stays user-controlled in UP/DOWN mode (mountains will
    // appear in both panes with the same SDF method as Mode II).
  } else {
    // Geographic
    for (const off of COUNTRY_OFFSETS.values()) {
      off.targetOx = 0;
      off.targetOz = 0;
      off.hidden = false;
    }
  }

  currentMode = targetMode;
  modeTransition.active = true;
  modeTransition.startTime = performance.now();

  // PASS-16: clear any active Compare reference when leaving the modes
  // where it applies. Visuals are rebuilt by refreshCompareVisuals() in
  // stepReorganization (after the layout has snapped to its new state).
  if (targetMode !== 'reorganized') compareState.refFips = null;
  if (targetMode === 'geo' && compareState.on) compareState.on = false;
  hideLineLabel();
  updateCompareButtonState();

  const indicator = document.getElementById('meta-mode');
  if (indicator) {
    if (targetMode === 'updown') {
      const aName = COUNTRIES[updownTopFips]?.name ?? updownTopFips;
      const bName = COUNTRIES[updownBottomFips]?.name ?? updownBottomFips;
      indicator.textContent = `Mode III · UP/DOWN: ${aName} vs ${bName}`;
    } else if (targetMode === 'reorganized') {
      indicator.textContent = 'Mode II · Reorganized by Affinity';
    } else {
      indicator.textContent = 'Mode I · Geographic';
    }
  }
}

const modeToggleEl = document.getElementById('mode-toggle');
if (modeToggleEl) {
  modeToggleEl.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.disabled) return;
    document.querySelectorAll('#mode-toggle button').forEach(b =>
      b.classList.toggle('active', b === btn));
    setMode(btn.dataset.mode);
  });
}

// Enable/disable the UP/DOWN button based on the country picker state.
function updateUpDownButtonState() {
  const btn = document.querySelector('#mode-toggle button[data-mode="updown"]');
  if (!btn) return;
  if (filterState.countries.size === 2) {
    btn.disabled = false;
    btn.title = 'Compare these two countries\' perspectives';
  } else {
    btn.disabled = true;
    btn.title = `Select exactly 2 countries (you have ${filterState.countries.size}) to enable`;
    // If we're currently in UP/DOWN and country count drifts off 2, kick back
    if (currentMode === 'updown') {
      // Switch back to Reorganized mode (or Geographic if filterState changed)
      const targetMode = 'reorganized';
      // Manually update button states
      document.querySelectorAll('#mode-toggle button').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === targetMode);
      });
      setMode(targetMode);
    }
  }
}


// ---------------------------------------------------------------------------
// FILTER SYSTEM
// All UI controls write into filterState and call refresh().
// refresh() is throttled to ~150ms during rapid changes (slider drags).
// ---------------------------------------------------------------------------

// Discover all blocs from the country data
const ALL_BLOCS = [...new Set(Object.values(COUNTRIES).map(c => c.bloc))].sort();

// Time presets, in date-index space (DATES is sorted ascending)
function findDateIdx(yyyymmdd) {
  let best = -1;
  for (let i = 0; i < DATES.length; i++) {
    if (DATES[i] <= yyyymmdd) best = i;
  }
  return best;
}
const TIME_PRESETS = {
  all:    { min: 0, max: DATES.length - 1, label: 'All 21 days' },
  last7:  { min: Math.max(0, DATES.length - 7), max: DATES.length - 1, label: 'Last 7' },
  weekA:  { min: findDateIdx('2025-10-27'), max: findDateIdx('2025-11-02'), label: 'Election wk' },
  weekB:  { min: findDateIdx('2026-02-16'), max: findDateIdx('2026-02-22'), label: 'Olympics wk' },
  weekC:  { min: findDateIdx('2026-04-13'), max: findDateIdx('2026-04-19'), label: 'Science wk' },
};

const filterState = {
  domain: 'politics',
  dateMin: 0,
  dateMax: DATES.length - 1,
  blocs: new Set(ALL_BLOCS),
  // Explicit per-country filter. When non-empty, takes priority over blocs:
  // only these countries are admitted as reporters. Empty = use bloc filter.
  countries: new Set(),
  toneTags: new Set(['neg', 'zero', 'pos']),
  minCount: 0,
};

// Build the filters payload for aggregateForFilters
function buildFilters() {
  return {
    domain: filterState.domain,
    dateMin: filterState.dateMin,
    dateMax: filterState.dateMax,
    blocs: filterState.blocs,
    countries: filterState.countries,
    toneTags: filterState.toneTags,
    minCount: filterState.minCount,
  };
}

// Throttled refresh: invokes applyFiltersWithTween at most every 150ms during
// rapid changes. Final change always lands.
const REFRESH_INTERVAL_MS = 150;
let lastRefreshAt = 0;
let pendingRefresh = null;
function scheduleRefresh() {
  const now = performance.now();
  const since = now - lastRefreshAt;
  if (since >= REFRESH_INTERVAL_MS) {
    lastRefreshAt = now;
    if (pendingRefresh) { clearTimeout(pendingRefresh); pendingRefresh = null; }
    onFilterChange();
    return;
  }
  // Schedule a trailing-edge refresh
  if (pendingRefresh) return;
  pendingRefresh = setTimeout(() => {
    lastRefreshAt = performance.now();
    pendingRefresh = null;
    onFilterChange();
  }, REFRESH_INTERVAL_MS - since);
}

function onFilterChange() {
  // In reorganized mode, filter changes also redraw the affinity map.
  if (currentMode === 'reorganized') {
    for (const off of COUNTRY_OFFSETS.values()) {
      off.fromOx = off.ox;
      off.fromOz = off.oz;
    }
    computeReorganizedOffsets();
    modeTransition.active = true;
    modeTransition.startTime = performance.now();
    return;
    // Note: applyFiltersWithTween fires automatically at transition-end via
    // stepReorganization() — so heightfield reflects both new offsets AND new filter.
  }
  // In UP/DOWN mode, filter changes recompute both panes from scratch.
  if (currentMode === 'updown') {
    if (filterState.countries.size === 2) {
      const arr = [...filterState.countries];
      updownTopFips = arr[0];
      updownBottomFips = arr[1];
      computeUpDownOffsets('up', updownTopFips);
      computeUpDownOffsets('down', updownBottomFips);
      modeTransition.active = true;
      modeTransition.startTime = performance.now();
    }
    // (If country count drifted off 2, updateUpDownButtonState already kicked
    // us out of UP/DOWN mode.)
    return;
  }
  applyFiltersWithTween(buildFilters());
}

// ---------------------------------------------------------------------------
// Filter UI wiring
// ---------------------------------------------------------------------------

// Filter bar collapse handle
const filterbarEl = document.getElementById('filterbar');
document.getElementById('filterbar-handle').addEventListener('click', () => {
  filterbarEl.classList.toggle('open');
  // Mirror state on <body> so the corner panels know to lift above
  document.body.classList.toggle('filterbar-open', filterbarEl.classList.contains('open'));
});

// Time slider — dual-thumb (two range inputs stacked, with a fill div)
const timeMinEl = document.getElementById('time-min');
const timeMaxEl = document.getElementById('time-max');
const timeFillEl = document.getElementById('time-fill');
const timeReadoutEl = document.getElementById('time-readout');
const tickMinEl = document.getElementById('tick-min');
const tickMaxEl = document.getElementById('tick-max');

timeMinEl.max = DATES.length - 1;
timeMaxEl.max = DATES.length - 1;
timeMinEl.value = 0;
timeMaxEl.value = DATES.length - 1;

// Z-index handling for stacked range inputs: when the max thumb sits at the
// far right (default), it's painted on top, occluding the min thumb if they
// happen to overlap. Raise whichever thumb is closer to the user's intent.
function adjustSliderZ() {
  const lo = +timeMinEl.value, hi = +timeMaxEl.value;
  const N = DATES.length - 1;
  // If the max thumb is at the high end, leave default; if it slid down to
  // share space with the min, raise the min thumb above it.
  if (hi <= lo + 1) {
    timeMinEl.style.zIndex = '3';
    timeMaxEl.style.zIndex = '2';
  } else if (hi < N * 0.5) {
    // Max has moved a lot left; min is more likely to be the intended target
    timeMinEl.style.zIndex = '3';
    timeMaxEl.style.zIndex = '2';
  } else {
    timeMinEl.style.zIndex = '2';
    timeMaxEl.style.zIndex = '3';
  }
}

function fmtDate(dateStr) {
  // YYYY-MM-DD -> MMM DD
  if (!dateStr) return '—';
  const [, mm, dd] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+mm - 1]} ${+dd}`;
}

function updateTimeUI() {
  const dMin = filterState.dateMin;
  const dMax = filterState.dateMax;
  const N = DATES.length - 1;
  const minPct = (dMin / N) * 100;
  const maxPct = (dMax / N) * 100;
  timeFillEl.style.left = minPct + '%';
  timeFillEl.style.width = (maxPct - minPct) + '%';
  const days = dMax - dMin + 1;
  timeReadoutEl.textContent = `${days} day${days === 1 ? '' : 's'} · ${fmtDate(DATES[dMin])} → ${fmtDate(DATES[dMax])}`;
  tickMinEl.textContent = fmtDate(DATES[dMin]);
  tickMaxEl.textContent = fmtDate(DATES[dMax]);
  // Mark which preset (if any) currently matches this exact range
  for (const btn of document.querySelectorAll('#time-presets button')) {
    const p = TIME_PRESETS[btn.dataset.preset];
    btn.classList.toggle('active', p && p.min === dMin && p.max === dMax);
  }
  adjustSliderZ();
  updateFilterSummary();
}

function onTimeInput() {
  let lo = parseInt(timeMinEl.value, 10);
  let hi = parseInt(timeMaxEl.value, 10);
  if (lo > hi) {
    // Push the other thumb so they don't cross
    if (this === timeMinEl) hi = lo;
    else lo = hi;
    timeMinEl.value = lo; timeMaxEl.value = hi;
  }
  filterState.dateMin = lo;
  filterState.dateMax = hi;
  updateTimeUI();
  scheduleRefresh();
}
timeMinEl.addEventListener('input', onTimeInput);
timeMaxEl.addEventListener('input', onTimeInput);

// Time presets
document.getElementById('time-presets').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const p = TIME_PRESETS[btn.dataset.preset];
  if (!p) return;
  filterState.dateMin = p.min;
  filterState.dateMax = p.max;
  timeMinEl.value = p.min;
  timeMaxEl.value = p.max;
  updateTimeUI();
  scheduleRefresh();
});

// Min-count slider
const countSliderEl = document.getElementById('count-slider');
const countReadoutEl = document.getElementById('count-readout');
countSliderEl.addEventListener('input', () => {
  filterState.minCount = parseInt(countSliderEl.value, 10);
  countReadoutEl.textContent = filterState.minCount + '+';
  updateFilterSummary();
  scheduleRefresh();
});

// === Reporters filter group ===
// Two tabs: "By Region" (bloc pills) and "By Country" (search + chips).
// Country override beats region selection when non-empty.

const reportersReadoutEl = document.getElementById('reporters-readout');
const regionPillsEl = document.getElementById('region-pills');

function blocLabel(b) {
  return b.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Region pills — built dynamically from ALL_BLOCS
for (const b of ALL_BLOCS) {
  const btn = document.createElement('button');
  btn.dataset.bloc = b;
  btn.classList.add('on');
  btn.textContent = blocLabel(b);
  regionPillsEl.appendChild(btn);
}

function updateReportersReadout() {
  if (filterState.countries.size > 0) {
    reportersReadoutEl.textContent = `${filterState.countries.size} countr${filterState.countries.size === 1 ? 'y' : 'ies'}`;
  } else if (filterState.blocs.size === ALL_BLOCS.length) {
    reportersReadoutEl.textContent = 'all regions';
  } else {
    reportersReadoutEl.textContent = `${filterState.blocs.size}/${ALL_BLOCS.length} regions`;
  }
}

regionPillsEl.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const b = btn.dataset.bloc;
  if (filterState.blocs.has(b)) {
    if (filterState.blocs.size === 1) return;
    filterState.blocs.delete(b);
    btn.classList.remove('on');
    btn.classList.add('off');
  } else {
    filterState.blocs.add(b);
    btn.classList.add('on');
    btn.classList.remove('off');
  }
  updateReportersReadout();
  updateFilterSummary();
  scheduleRefresh();
});

// Region select all / none
document.getElementById('region-select-all').addEventListener('click', () => {
  filterState.blocs = new Set(ALL_BLOCS);
  for (const btn of regionPillsEl.querySelectorAll('button')) {
    btn.classList.add('on'); btn.classList.remove('off');
  }
  updateReportersReadout();
  updateFilterSummary();
  scheduleRefresh();
});
document.getElementById('region-select-none').addEventListener('click', () => {
  // Pick the first bloc only — guaranteed non-empty (avoids empty filter)
  const keep = ALL_BLOCS[0];
  filterState.blocs = new Set([keep]);
  for (const btn of regionPillsEl.querySelectorAll('button')) {
    const on = btn.dataset.bloc === keep;
    btn.classList.toggle('on', on);
    btn.classList.toggle('off', !on);
  }
  updateReportersReadout();
  updateFilterSummary();
  scheduleRefresh();
});

// Tab switching
document.querySelectorAll('.rep-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.rep-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('rep-pane-regions').style.display = tab.dataset.tab === 'regions' ? '' : 'none';
    document.getElementById('rep-pane-countries').style.display = tab.dataset.tab === 'countries' ? '' : 'none';
  });
});

// Country search/select widget
const countrySearchEl = document.getElementById('country-search');
const countryChipsEl = document.getElementById('country-chips');
const countrySuggestionsEl = document.getElementById('country-suggestions');
const countryClearEl = document.getElementById('country-clear');

// Pre-build a sortable country list for search (only countries appearing as
// reporters — others wouldn't contribute anything if selected).
const REPORTER_FIPS_SET = new Set();
for (const r of ROWS) REPORTER_FIPS_SET.add(r.reporter);
const COUNTRY_INDEX = [...REPORTER_FIPS_SET]
  .filter(f => COUNTRIES[f])
  .map(fips => ({
    fips, name: COUNTRIES[fips].name,
    bloc: COUNTRIES[fips].bloc,
    search: (COUNTRIES[fips].name + ' ' + fips).toLowerCase(),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

function renderCountryChips() {
  countryChipsEl.innerHTML = '';
  for (const fips of filterState.countries) {
    const c = COUNTRIES[fips];
    if (!c) continue;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span>${c.name}</span><span class="x" data-fips="${fips}">×</span>`;
    countryChipsEl.appendChild(chip);
  }
}

function renderCountrySuggestions(query) {
  countrySuggestionsEl.innerHTML = '';
  const q = query.trim().toLowerCase();
  if (!q) {
    // Show top reporters when nothing typed
    const top = COUNTRY_INDEX.slice(0, 10);
    for (const c of top) renderSuggestion(c);
    return;
  }
  const matches = COUNTRY_INDEX
    .filter(c => c.search.includes(q) && !filterState.countries.has(c.fips))
    .slice(0, 14);
  for (const c of matches) renderSuggestion(c);
}

function renderSuggestion(c) {
  const sug = document.createElement('div');
  sug.className = 'sug';
  sug.dataset.fips = c.fips;
  sug.innerHTML = `<span>${c.name}</span><span class="meta">${c.fips} · ${blocLabel(c.bloc)}</span>`;
  countrySuggestionsEl.appendChild(sug);
}

countrySearchEl.addEventListener('input', () => {
  renderCountrySuggestions(countrySearchEl.value);
});
countrySearchEl.addEventListener('focus', () => {
  renderCountrySuggestions(countrySearchEl.value);
});

countrySuggestionsEl.addEventListener('click', e => {
  const sug = e.target.closest('.sug');
  if (!sug) return;
  filterState.countries.add(sug.dataset.fips);
  renderCountryChips();
  renderCountrySuggestions(countrySearchEl.value);
  updateReportersReadout();
  updateFilterSummary();
  updateUpDownButtonState();
  scheduleRefresh();
});

countryChipsEl.addEventListener('click', e => {
  const x = e.target.closest('.x');
  if (!x) return;
  filterState.countries.delete(x.dataset.fips);
  renderCountryChips();
  renderCountrySuggestions(countrySearchEl.value);
  updateReportersReadout();
  updateFilterSummary();
  updateUpDownButtonState();
  scheduleRefresh();
});

countryClearEl.addEventListener('click', () => {
  filterState.countries.clear();
  renderCountryChips();
  renderCountrySuggestions(countrySearchEl.value);
  updateReportersReadout();
  updateFilterSummary();
  updateUpDownButtonState();
  scheduleRefresh();
});

// Initial render: show top suggestions
renderCountryChips();
renderCountrySuggestions('');
updateReportersReadout();
updateUpDownButtonState();

// Tone pills
const tonePillsEl = document.getElementById('tone-pills');
const toneReadoutEl = document.getElementById('tone-readout');
tonePillsEl.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const t = btn.dataset.tone;
  if (filterState.toneTags.has(t)) {
    if (filterState.toneTags.size === 1) return;
    filterState.toneTags.delete(t);
    btn.classList.remove('on');
    btn.classList.add('off');
  } else {
    filterState.toneTags.add(t);
    btn.classList.add('on');
    btn.classList.remove('off');
  }
  const n = filterState.toneTags.size;
  toneReadoutEl.textContent = n === 3 ? 'all' : `${n}/3`;
  updateFilterSummary();
  scheduleRefresh();
});

// Compact summary on the collapsed handle
function updateFilterSummary() {
  const parts = [];
  const days = filterState.dateMax - filterState.dateMin + 1;
  parts.push(days === DATES.length ? 'All days' : `${days}d`);
  if (filterState.countries.size > 0) {
    parts.push(`${filterState.countries.size} countr${filterState.countries.size === 1 ? 'y' : 'ies'}`);
  } else {
    parts.push(filterState.blocs.size === ALL_BLOCS.length ? 'all regions'
               : `${filterState.blocs.size}/${ALL_BLOCS.length} regions`);
  }
  parts.push(filterState.toneTags.size === 3 ? 'all tones' : `${filterState.toneTags.size}/3 tones`);
  if (filterState.minCount > 0) parts.push(`min ${filterState.minCount}`);
  document.getElementById('filter-summary').textContent = parts.join(' · ');
}

// Domain toggle (kept where it was — remains the primary axis)
document.getElementById('domain-toggle').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const d = btn.dataset.domain;
  if (d === filterState.domain) return;
  document.querySelectorAll('#domain-toggle button').forEach(b =>
    b.classList.toggle('active', b === btn));
  filterState.domain = d;
  scheduleRefresh();
});

// Methodology
// Elevation toggle — hides/shows the heightfield mesh entirely. The basemap
// continues to render so users can study the reorganized layout flat.
// (elevationOn and elevationBtn are forward-declared at the top of the module.)
elevationBtn = document.getElementById('elevation-btn');
if (elevationBtn) {
  elevationBtn.addEventListener('click', () => {
    elevationOn = !elevationOn;
    hfMesh.visible = elevationOn;
    elevationBtn.textContent = 'Elevation: ' + (elevationOn ? 'On' : 'Off');
    elevationBtn.classList.toggle('active', elevationOn);
  });
}

// PASS-16: Compare toggle. Toggles the feature on/off; the active state
// drives whether clicks on countries set a reference (Mode II) or open the
// detail modal (default), and whether the comparison tooltip + lines are
// shown.
const compareBtnEl = document.getElementById('compare-btn');
if (compareBtnEl) {
  compareBtnEl.addEventListener('click', () => {
    if (compareBtnEl.disabled) return;
    compareState.on = !compareState.on;
    if (!compareState.on) compareState.refFips = null;
    if (!compareState.on) hideLineLabel();
    updateCompareButtonState();
    refreshCompareVisuals();
  });
}
// Set initial enabled state to match starting mode (Geographic ⇒ disabled).
updateCompareButtonState();

document.getElementById('method-link').addEventListener('click', () =>
  document.getElementById('method-modal').classList.add('open'));
document.getElementById('method-close').addEventListener('click', () =>
  document.getElementById('method-modal').classList.remove('open'));

// ---------------------------------------------------------------------------
// Collapsible corner panels
// ---------------------------------------------------------------------------
for (const id of ['stats', 'legend']) {
  const el = document.getElementById(id);
  const handle = el && el.querySelector('.panel-handle');
  if (handle) {
    handle.addEventListener('click', () => el.classList.toggle('collapsed'));
  }
}

// ---------------------------------------------------------------------------
// Country detail modal — moved to modal.js. Click handler below calls into
// it via openCountryModal(); the modal wires its own close + Escape
// handlers in initCountryModal().
// ---------------------------------------------------------------------------
initCountryModal(filterState);

// Click-to-open with drag-vs-click discrimination
let mouseDownPos = null;
renderer.domElement.addEventListener('mousedown', e => {
  mouseDownPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('mouseup', e => {
  if (!mouseDownPos) return;
  const dx = Math.abs(e.clientX - mouseDownPos.x);
  const dy = Math.abs(e.clientY - mouseDownPos.y);
  const wasClick = dx < 4 && dy < 4;
  mouseDownPos = null;
  if (!wasClick) return;
  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  // Click resolution works the same in both Geographic and Reorganized modes:
  // raycast hits the heightfield or basemap, recover the (offset) lon/lat, then
  // map it back to the original country via the offset table.
  const hits = raycaster.intersectObjects([hfMesh, basemap], false);
  if (!hits.length) return;
  const p = hits[0].point;
  const fips = countryAtWorldXZ(p.x, p.z);
  if (!fips) return;

  // PASS-16: in Reorganized mode with Compare on, click sets/toggles the
  // reference instead of opening the modal. UP/DOWN ignores click for
  // reference-setting (focals are tied to the country picker), so its
  // clicks still go to the modal even when Compare is on. Geographic
  // never has Compare available, so plain click → modal as always.
  if (compareState.on && currentMode === 'reorganized') {
    if (compareState.refFips === fips) clearCompareReference();
    else                               setCompareReference(fips);
    return;
  }
  openCountryModal(fips);
});

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initial render
updateTimeUI();
updateFilterSummary();
applyFiltersWithTween(buildFilters());

setTimeout(() => document.getElementById('loader').classList.add('hidden'), 240);
