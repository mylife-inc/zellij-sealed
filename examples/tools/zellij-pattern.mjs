/**
 * Draws Moroccan zellij, rather than photographing it.
 *
 * The geometry is public domain — these constructions are centuries old and
 * belong to nobody — but a photograph of them is owned by whoever took it. That
 * distinction is why this file exists: every photograph considered for the site
 * either carried a stock watermark or arrived without provenance, and the way
 * out of a licensing question about a pattern nobody owns is to build the
 * pattern.
 *
 * What it buys beyond the licence: a few kilobytes of code instead of megabytes
 * of JPEG, artwork that takes the theme's palette instead of fighting it, and
 * any size without resampling.
 *
 * The construction is the ordinary one. A square lattice carries a sixteen-point
 * rosette — the *shamsa* — at every corner, and the space left between four of
 * them takes an eight-point star, the *khatim*. Everything is drawn as polygons
 * on a ground colour, and the ground showing between them is the grout, which is
 * how real tilework reads at a distance: the white lines are as much of the
 * pattern as the colours.
 */
import { createImage, drawOver, resize } from './image.mjs';

/**
 * Supersampling factor.
 *
 * Polygons are filled by scanline with no per-pixel coverage, so edges land on
 * whole pixels and a sixteen-point star drawn that way is visibly ragged.
 * Rendering three times over and box-averaging down is `resize`'s shrink path,
 * which averages every source pixel inside an output pixel — nine samples an
 * edge, which is enough for geometry this angular.
 */
const SS = 3;

/* ------------------------------------------------------------- polygon fill */

/** Fills a polygon by scanline, even-odd, clipped to the canvas. */
function fillPolygon(image, points, colour) {
  const { width, height, data } = image;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const from = Math.max(0, Math.floor(minY));
  const to = Math.min(height - 1, Math.ceil(maxY));
  const crossings = [];

  for (let y = from; y <= to; y += 1) {
    const scan = y + 0.5;
    crossings.length = 0;

    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      // Half-open in y, so a vertex shared by two edges is counted once.
      if (y1 <= scan ? y2 > scan : y2 <= scan) {
        crossings.push(x1 + ((scan - y1) / (y2 - y1)) * (x2 - x1));
      }
    }

    crossings.sort((a, b) => a - b);

    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const x0 = Math.max(0, Math.ceil(crossings[i] - 0.5));
      const x1 = Math.min(width - 1, Math.floor(crossings[i + 1] - 0.5));

      for (let x = x0; x <= x1; x += 1) {
        const at = (y * width + x) * 4;
        data[at] = colour[0];
        data[at + 1] = colour[1];
        data[at + 2] = colour[2];
        data[at + 3] = 255;
      }
    }
  }

  return image;
}

/**
 * Pulls every vertex toward the centroid, which is what leaves the grout.
 *
 * Not a true polygon offset — a real one moves each edge along its normal and
 * re-intersects. This is the cheap version, and the difference shows only on
 * shapes far from equilateral. The clamp matters more than the approximation:
 * the spikes of a rosette are long and thin, and pulling their vertices a fixed
 * distance inward turns them inside out. Never move a vertex more than a third
 * of its own distance from the centre and a thin shape gets thin grout instead
 * of a knot.
 */
function inset(points, amount) {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;

  return points.map(([x, y]) => {
    const dx = cx - x;
    const dy = cy - y;
    const distance = Math.hypot(dx, dy) || 1;
    const move = Math.min(amount, distance * 0.34);
    return [x + (dx / distance) * move, y + (dy / distance) * move];
  });
}

/** Polar to cartesian, angles clockwise from twelve o'clock. */
const at = (cx, cy, radius, angle) => [
  cx + radius * Math.sin(angle),
  cy - radius * Math.cos(angle),
];

/* --------------------------------------------------------------- the shapes */

/** A regular polygon. */
function ngon(cx, cy, radius, sides, phase = 0) {
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    points.push(at(cx, cy, radius, phase + (i * Math.PI * 2) / sides));
  }
  return points;
}

/**
 * An eight-point star — the *khatim*, the seal.
 *
 * Two squares at forty-five degrees, which is the same thing as a sixteen-sided
 * polygon whose radius alternates. The inner radius is not a taste decision:
 * cos(π/8) / cos(π/4) ≈ 0.5412 is the value at which the star's edges lie
 * straight, so opposite sides are collinear and it reads as two squares rather
 * than as a sixteen-pointed blob.
 */
function khatim(cx, cy, radius, colour, phase = 0) {
  const points = [];
  const inner = radius * 0.5412;

  for (let i = 0; i < 16; i += 1) {
    points.push(at(cx, cy, i % 2 === 0 ? radius : inner, phase + (i * Math.PI) / 8));
  }

  return { points, colour };
}

/* -------------------------------------------------------------- the palette */

export const PALETTES = {
  /** After the tilework of Fez: cyan and navy, rust, a saffron centre. */
  fez: {
    ground: [244, 240, 232],
    facet: [168, 67, 31],
    star: [21, 62, 104],
    starInner: [41, 176, 205],
    core: [240, 166, 47],
    square: [250, 247, 240],
  },
  /** The green of Meknes, on lime plaster. */
  meknes: {
    ground: [246, 244, 238],
    facet: [176, 154, 74],
    star: [26, 74, 63],
    starInner: [46, 138, 106],
    core: [232, 226, 210],
    square: [250, 249, 244],
  },
  /** Cobalt and white, the Chefchaouen end of the range. */
  majorelle: {
    ground: [242, 244, 250],
    facet: [206, 122, 62],
    star: [24, 40, 92],
    starInner: [63, 106, 200],
    core: [238, 242, 250],
    square: [248, 250, 254],
  },
};

/* ------------------------------------------------------------------- render */

/**
 * A field of tilework.
 *
 * `cell` is the lattice pitch — the distance between rosette centres — given in
 * pixels of the finished image. Rosettes sit on the lattice *corners* and the
 * khatim in the middle of each cell, and both are drawn a cell beyond every edge
 * so nothing shows a cut-off centre at the boundary.
 */
export function field({ width, height, cell = 320, palette = PALETTES.fez, grout = 1.6 }) {
  const w = width * SS;
  const h = height * SS;
  const p = cell * SS;
  const canvas = createImage(w, h, [...palette.ground, 255]);
  const gap = grout * SS;

  /*
   * The octagon-and-square tessellation, which is exact.
   *
   * Octagons centred on a square lattice of pitch `p`, squares in the middle of
   * every cell, and between them they cover the plane with nothing left over.
   * Two numbers make that true and neither is a choice:
   *
   *   octagon circumradius  p / (2 cos 22.5°) ≈ 0.5412 p
   *   square  circumradius  0.2929 p, turned 45°
   *
   * The first puts the octagon's apothem at exactly p/2, so neighbours along
   * each axis meet edge to edge. The second gives the square an apothem of
   * 0.2071p, and 0.5 p + 0.2071 p is 0.7071 p — the distance from an octagon's
   * centre to the cell centre. The square's edges land flat against the
   * octagons' diagonal edges with no gap and no overlap.
   *
   * Getting this wrong is what the first attempt got wrong: shapes placed on a
   * background, with the background showing through everywhere. Tilework has no
   * background. Every millimetre is a tile or it is grout, and the grout here is
   * the ground showing through the inset — a line, not a field.
   */
  const octagon = p * 0.5412;
  const square = p * 0.2929;

  const columns = Math.ceil(w / p) + 2;
  const rows = Math.ceil(h / p) + 2;

  for (let row = -1; row < rows; row += 1) {
    for (let col = -1; col < columns; col += 1) {
      // Vertices on the axes, so the edges face the octagons' diagonal edges.
      fillPolygon(
        canvas,
        inset(ngon((col + 0.5) * p, (row + 0.5) * p, square, 4, 0), gap),
        palette.square,
      );
    }
  }

  for (let row = -1; row < rows; row += 1) {
    for (let col = -1; col < columns; col += 1) {
      const cx = col * p;
      const cy = row * p;

      /*
       * The eight facets, drawn as pieces rather than left as background.
       *
       * The star's points land on the octagon's vertices, so what remains of
       * the octagon is eight triangles — each spanning two vertices, with the
       * star's notch between them. Leaving those as the octagon's own fill made
       * them the same colour as the cell squares they touch, and the two merged
       * into one shape across the grout: the pattern went to squares and
       * diamonds and the star disappeared into the background.
       *
       * Cut as their own pieces they can take their own colour, which is what
       * makes the star a star. It is also what a *maallem* actually does — each
       * of these is a separate piece of glazed clay, chipped to shape.
       */
      const notch = octagon * 0.5412;
      for (let k = 0; k < 8; k += 1) {
        const a = Math.PI / 8 + (k * Math.PI) / 4;
        fillPolygon(
          canvas,
          inset(
            [
              at(cx, cy, octagon, a),
              at(cx, cy, notch, a + Math.PI / 8),
              at(cx, cy, octagon, a + Math.PI / 4),
            ],
            gap,
          ),
          palette.facet,
        );
      }

      const star = khatim(cx, cy, octagon, palette.star, Math.PI / 8);
      fillPolygon(canvas, inset(star.points, gap), star.colour);
      fillPolygon(canvas, inset(ngon(cx, cy, octagon * 0.42, 8, Math.PI / 8), gap), palette.starInner);
      fillPolygon(canvas, inset(ngon(cx, cy, octagon * 0.17, 8, 0), gap), palette.core);
    }
  }

  return resize(canvas, width, height);
}

/* ----------------------------------------------------------- the letterforms */

/*
 * Five glyphs, drawn as strokes in a unit box.
 *
 * Not a font and not a substitute for one. The brief was the lettering of *The
 * Orville*, which is a licensed typeface neither present on this machine nor
 * redistributable in a repository — so this takes the qualities that make that
 * lettering recognisable and draws them: one uniform stroke weight, flat
 * terminals, wide apertures, and tracking loose enough that the word reads as
 * six separate marks. Six letters, five shapes.
 *
 * Coordinates are x right, y down, 0..1 on the cap height; `advance` is the
 * glyph's own width in the same unit.
 */
const GLYPHS = {
  Z: { advance: 0.86, strokes: [[[0, 0], [0.86, 0]], [[0.86, 0], [0, 1]], [[0, 1], [0.86, 1]]] },
  E: {
    advance: 0.78,
    strokes: [
      [[0, 0], [0, 1]],
      [[0, 0], [0.78, 0]],
      [[0, 0.5], [0.6, 0.5]],
      [[0, 1], [0.78, 1]],
    ],
  },
  L: { advance: 0.72, strokes: [[[0, 0], [0, 1]], [[0, 1], [0.72, 1]]] },
  I: { advance: 0.06, strokes: [[[0.03, 0], [0.03, 1]]] },
  J: {
    advance: 0.72,
    strokes: [
      [[0.69, 0], [0.69, 0.74]],
      [[0.69, 0.74], [0.5, 0.98]],
      [[0.5, 0.98], [0.18, 0.98]],
      [[0.18, 0.98], [0, 0.8]],
    ],
  },
};

/** A stroke as a quad, with a square cap at each end to join the corners. */
function strokeSegment(image, [x1, y1], [x2, y2], weight, colour) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * (weight / 2);
  const ny = (dx / length) * (weight / 2);

  fillPolygon(
    image,
    [
      [x1 + nx, y1 + ny],
      [x2 + nx, y2 + ny],
      [x2 - nx, y2 - ny],
      [x1 - nx, y1 - ny],
    ],
    colour,
  );

  for (const [x, y] of [[x1, y1], [x2, y2]]) {
    fillPolygon(image, ngon(x, y, weight / 2, 8, Math.PI / 8), colour);
  }
}

/**
 * Sets a word across the middle of an image.
 *
 * The plaque underneath is not decoration. White lettering over sixteen-point
 * rosettes is illegible in the places where it crosses a saffron core or a
 * white grout line, and no stroke weight fixes that — the ground is high
 * contrast everywhere. Zellij panels carry calligraphic bands set into the
 * tilework for exactly this reason, so the word sits on one: an octagonal
 * cartouche, the field's own dark, laid over the pattern rather than beside it.
 */
export function wordmark(image, text, { size = 0.09, colour = [255, 255, 255], plaque = [12, 26, 46], plaqueOpacity = 0.84 } = {}) {
  const cap = image.height * size;
  const weight = cap * 0.115;
  const tracking = cap * 0.42;

  const glyphs = [...text].map((character) => GLYPHS[character]);
  const width =
    glyphs.reduce((total, glyph) => total + glyph.advance * cap, 0) + tracking * (glyphs.length - 1);

  const cx = image.width / 2;
  const cy = image.height / 2;

  if (plaqueOpacity > 0) {
    const padX = cap * 0.85;
    const padY = cap * 0.72;
    const left = cx - width / 2 - padX;
    const right = cx + width / 2 + padX;
    const top = cy - cap / 2 - padY;
    const bottom = cy + cap / 2 + padY;
    const corner = (bottom - top) * 0.3;

    const band = createImage(image.width, image.height);
    fillPolygon(
      band,
      [
        [left + corner, top],
        [right - corner, top],
        [right, top + corner],
        [right, bottom - corner],
        [right - corner, bottom],
        [left + corner, bottom],
        [left, bottom - corner],
        [left, top + corner],
      ],
      plaque,
    );
    drawOver(image, band, 0, 0, plaqueOpacity);
  }

  let x = cx - width / 2;
  const top = cy - cap / 2;

  for (const glyph of glyphs) {
    for (const [from, to] of glyph.strokes) {
      strokeSegment(
        image,
        [x + from[0] * cap, top + from[1] * cap],
        [x + to[0] * cap, top + to[1] * cap],
        weight,
        colour,
      );
    }
    x += glyph.advance * cap + tracking;
  }

  return image;
}
