/**
 * Generates the showcase's imagery.
 *
 * The showcase is an Apple-idiom product site for a fictional brand, so it
 * needs pictures that read as product renders rather than abstract gradients —
 * a page of coloured rectangles cannot tell you whether the layout works.
 * These are drawn procedurally: no binaries in git, no image dependency, and
 * deterministic.
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function png(width, height, paint) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x / width, y / height, width / height);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => Math.round(a + (b - a) * t);
const lerp = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Signed distance to a rounded rectangle centred at the origin. */
function roundedRect(x, y, halfW, halfH, radius) {
  const dx = Math.abs(x) - (halfW - radius);
  const dy = Math.abs(y) - (halfH - radius);
  return (
    Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
  );
}

/**
 * A device render: a rounded body with an inset screen, over a gradient field.
 *
 * Coordinates are normalised to the canvas *height*, so one definition keeps
 * its proportions on a square tile and a 21:8 banner alike.
 */
function device({ field, body, screen, scale = 0.62, aspect = 0.46, glow = null, drop = 0 }) {
  return (u, v, canvasRatio) => {
    const x = (u - 0.5) * canvasRatio;
    // `drop` moves the product down the frame, leaving the top clear for copy.
    const y = v - 0.5 - drop;

    const halfH = scale / 2;
    const halfW = halfH * aspect;

    let colour = lerp(field[0], field[1], clamp01((u * 0.6 + v * 0.7) / 1.3));

    // A soft bloom behind the device lifts it off the field.
    if (glow) {
      const d = Math.hypot(x, y) / (halfH * 2.4);
      colour = lerp(colour, glow, clamp01(1 - d) ** 2 * 0.55);
    }

    if (roundedRect(x, y, halfW, halfH, halfH * 0.17) > 0) return colour;

    // Body edge, then the screen inset within it.
    if (roundedRect(x, y, halfW * 0.93, halfH * 0.965, halfH * 0.15) > 0) {
      // A brighter rim along the top-left reads as a chamfer.
      return lerp(body[0], body[1], clamp01((-x - y) * 2.2 + 0.35));
    }

    const sx = clamp01((x + halfW * 0.93) / (halfW * 1.86));
    const sy = clamp01((y + halfH * 0.965) / (halfH * 1.93));
    return lerp(screen[0], screen[1], clamp01(sx * 0.35 + sy * 0.75));
  };
}

/** A flat field with a soft vignette — for tiles that carry copy, not a device. */
function wash(from, to, angle = 0.6) {
  return (u, v) => {
    const base = lerp(from, to, clamp01(u * angle + v * (1 - angle)));
    return lerp(base, [0, 0, 0], clamp01(Math.hypot(u - 0.5, v - 0.5) - 0.35) * 0.35);
  };
}

const INK = [[12, 13, 18], [30, 33, 46]];
const SLATE = [[226, 231, 238], [178, 189, 205]];
const SAND = [[244, 238, 230], [214, 196, 176]];
const NIGHT = [[8, 9, 14], [22, 26, 40]];

const TITANIUM = [[104, 110, 122], [206, 212, 222]];
const GRAPHITE = [[38, 40, 48], [96, 100, 112]];

const SCREEN_WARM = [[252, 116, 62], [120, 32, 96]];
const SCREEN_COOL = [[46, 128, 232], [16, 26, 72]];
const SCREEN_DEEP = [[120, 68, 220], [18, 18, 38]];

const IMAGES = [
  // Landing: the product family.
  ['hero-device.png', 1800, 1000, device({ field: NIGHT, body: TITANIUM, screen: SCREEN_WARM, scale: 0.82, glow: [90, 60, 140] })],
  ['promo-pro.png', 1600, 900, device({ field: NIGHT, body: TITANIUM, screen: SCREEN_WARM, scale: 0.4, drop: 0.28, glow: [120, 70, 60] })],
  ['promo-standard.png', 1200, 900, device({ field: SLATE, body: GRAPHITE, screen: SCREEN_COOL, scale: 0.4, drop: 0.28 })],
  ['promo-watch.png', 1200, 900, device({ field: SAND, body: GRAPHITE, screen: SCREEN_DEEP, scale: 0.34, drop: 0.26, aspect: 0.82 })],
  ['promo-buds.png', 1200, 900, device({ field: SLATE, body: TITANIUM, screen: SCREEN_COOL, scale: 0.26, drop: 0.26, aspect: 0.9 })],
  ['promo-trade.png', 1600, 700, wash([28, 32, 48], [64, 74, 104])],

  // Product page.
  ['pro-hero.png', 2000, 1100, device({ field: NIGHT, body: TITANIUM, screen: SCREEN_WARM, scale: 0.86, glow: [130, 80, 60] })],
  ['pro-design.png', 2000, 900, device({ field: NIGHT, body: TITANIUM, screen: SCREEN_DEEP, scale: 0.68, glow: [80, 70, 160] })],
  ['pro-camera.png', 1600, 1000, device({ field: INK, body: GRAPHITE, screen: SCREEN_WARM, scale: 0.74 })],
  ['pro-display.png', 1600, 1000, device({ field: NIGHT, body: TITANIUM, screen: SCREEN_COOL, scale: 0.76 })],
  ['pro-chip.png', 1600, 1000, device({ field: INK, body: GRAPHITE, screen: SCREEN_DEEP, scale: 0.48, aspect: 1 })],
  ['pro-battery.png', 1600, 1000, device({ field: SLATE, body: GRAPHITE, screen: SCREEN_COOL, scale: 0.7 })],

  // Carousel tiles.
  ['card-trade.png', 900, 700, wash([236, 240, 246], [186, 200, 220])],
  ['card-carrier.png', 900, 700, wash([246, 238, 228], [222, 196, 168])],
  ['card-pay.png', 900, 700, wash([232, 242, 238], [180, 214, 202])],
  ['card-setup.png', 900, 700, wash([238, 234, 246], [200, 188, 226])],
  ['card-support.png', 900, 700, wash([236, 241, 248], [190, 202, 222])],

  // Finishes, for the gallery.
  ['finish/graphite.png', 900, 700, device({ field: NIGHT, body: GRAPHITE, screen: SCREEN_DEEP, scale: 0.62, aspect: 0.5 })],
  ['finish/titanium.png', 900, 700, device({ field: SLATE, body: TITANIUM, screen: SCREEN_COOL, scale: 0.62, aspect: 0.5 })],
  ['finish/sand.png', 900, 700, device({ field: SAND, body: [[150, 122, 96], [226, 204, 176]], screen: SCREEN_WARM, scale: 0.62, aspect: 0.5 })],
  ['finish/moss.png', 900, 700, device({ field: [[224, 232, 226], [178, 200, 186]], body: [[52, 74, 62], [128, 156, 138]], screen: SCREEN_COOL, scale: 0.62, aspect: 0.5 })],
  ['finish/ink.png', 900, 700, device({ field: INK, body: [[30, 34, 52], [92, 100, 130]], screen: SCREEN_DEEP, scale: 0.62, aspect: 0.5 })],
  ['finish/rose.png', 900, 700, device({ field: [[246, 232, 232], [222, 190, 192]], body: [[146, 96, 100], [226, 186, 186]], screen: SCREEN_WARM, scale: 0.62, aspect: 0.5 })],

  // The film's poster frame, and the generations timeline.
  ['film-poster.png', 1600, 900, device({ field: NIGHT, body: TITANIUM, screen: SCREEN_WARM, scale: 0.6, glow: [140, 80, 60] })],
  ['gen-1.png', 1000, 620, device({ field: SLATE, body: GRAPHITE, screen: SCREEN_COOL, scale: 0.56, aspect: 0.52 })],
  ['gen-2.png', 1000, 620, device({ field: SAND, body: GRAPHITE, screen: SCREEN_WARM, scale: 0.58, aspect: 0.5 })],
  ['gen-3.png', 1000, 620, device({ field: NIGHT, body: TITANIUM, screen: SCREEN_DEEP, scale: 0.6, aspect: 0.48 })],

  // Portraits — flat fields, since a generated face would be worse than none.
  ['people/rowan.png', 400, 400, wash([228, 234, 242], [176, 192, 214])],
  ['people/imani.png', 400, 400, wash([244, 234, 226], [216, 190, 168])],
  ['people/tobias.png', 400, 400, wash([230, 240, 236], [178, 206, 196])],
  ['avatar/nadia.png', 160, 160, wash([232, 236, 244], [182, 196, 218])],
  ['avatar/felix.png', 160, 160, wash([244, 236, 228], [218, 194, 172])],

  // A big "learn more" panel.
  ['showcase-privacy.png', 1600, 900, device({ field: INK, body: TITANIUM, screen: SCREEN_DEEP, scale: 0.58, glow: [70, 90, 170] })],

  // The guide still references this one.
  ['shot-reporting.png', 1200, 800, wash([238, 242, 248], [150, 172, 205])],
  ['og.png', 1200, 630, device({ field: NIGHT, body: TITANIUM, screen: SCREEN_WARM, scale: 0.7, glow: [120, 70, 60] })],
];

function wordmarkSvg(ink) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 32" width="132" height="32" role="img" aria-label="Lumen">
  <circle cx="15" cy="16" r="10" fill="none" stroke="${ink}" stroke-width="2.5"/>
  <circle cx="15" cy="16" r="3.5" fill="${ink}"/>
  <text x="34" y="23" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="21" font-weight="600" letter-spacing="-0.6" fill="${ink}">Lumen</text>
</svg>
`;
}

const root = path.resolve(import.meta.dirname, '..', 'content', 'assets');

for (const [name, width, height, paint] of IMAGES) {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, png(width, height, paint));
}

await writeFile(path.join(root, 'logo.svg'), wordmarkSvg('#1d1d1f'));
await writeFile(path.join(root, 'logo-dark.svg'), wordmarkSvg('#f5f5f7'));

// Carrier marks for the logo strip. Invented names — the point is the layout.
const CARRIERS = {
  northwave: '#3B6FD4',
  meridian: '#C2643A',
  kestrel: '#3F8F6F',
  orbit: '#7A5AA8',
};

await mkdir(path.join(root, 'carriers'), { recursive: true });
for (const [name, colour] of Object.entries(CARRIERS)) {
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  await writeFile(
    path.join(root, 'carriers', `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 190 44" width="190" height="44" role="img" aria-label="${label}">
  <rect x="2" y="10" width="24" height="24" rx="7" fill="${colour}"/>
  <text x="36" y="29" font-family="system-ui, sans-serif" font-size="18" font-weight="650" fill="#1d1d1f">${label}</text>
</svg>
`,
  );
}

console.log(`Generated ${IMAGES.length} images and 2 wordmarks.`);
