/**
 * Derives the docs site's imagery from the brand artwork in `content/assets/brand`.
 *
 * The source files are real designed assets and are committed. Everything else
 * — the nav wordmark at bar height, the fields the rosette sits on — is
 * generated here, so sizes and palettes stay in one place and no image
 * dependency is added to a project that has none.
 */
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  createImage,
  decodePng,
  drawOver,
  encodePng,
  gradientFill,
  resize,
  trim,
} from '../../tools/image.mjs';
import { PALETTES, field as tilework, wordmark } from '../../tools/zellij-pattern.mjs';

const root = path.resolve(import.meta.dirname, '..', 'content', 'assets');
const brand = path.join(root, 'brand');

const rosette = trim(decodePng(path.join(brand, 'zellij-rosette.png')));

/*
 * The bar mark. Not trimmed: it is a circle on a transparent ground, and
 * trimming to its ink would crop the antialiased edge and leave it a hair
 * wider than tall — enough for a round thing beside text to look off-centre.
 *
 * `zellij-wordmark.png` is still in this folder and no longer derived from.
 * It was what the bar used, and letters edge to edge is why the sizing there
 * has to be so conservative; a round mark is free to be larger.
 */
const mark = decodePng(path.join(brand, 'zellij-mark.png'));

/*
 * Three tile panels with the name already set into them, for the front of the
 * carousel. Generated images rather than photographs, and each one keeps a
 * faint mark in its bottom-right corner saying so — the crops below are chosen
 * to fall outside it.
 */
const CARD_PHOTOS = {
  a: decodePng(path.join(brand, 'card-photo-a.png')),
  b: decodePng(path.join(brand, 'card-photo-b.png')),
  c: decodePng(path.join(brand, 'card-photo-c.png')),
};

/**
 * Tilework, drawn.
 *
 * These four images were photographs until the licence question came up. The
 * geometry of zellij is public domain — it is centuries old and belongs to
 * nobody — but a photograph of it belongs to whoever took it, and every
 * candidate either carried a stock watermark or arrived without provenance.
 *
 * Drawing it settles that, and three other things: eight megabytes of JPEG
 * leave the repository, each image is generated at exactly the size it is used
 * at instead of resampled, and the palette is ours to choose.
 */
function tiles({ width, height, cell, palette, word = 0 }) {
  // Grout scales with the image, or a 2000px panel and an 800px card would be
  // laid by two different craftsmen.
  const image = tilework({ width, height, cell, palette, grout: Math.max(1.5, width / 620) });
  if (word > 0) wordmark(image, 'ZELLIJ', { size: word });
  return image;
}

/* ------------------------------------------------------------------ fields */

const INK = [
  [16, 18, 28],
  [34, 40, 66],
];
const SEA = [
  [232, 242, 240],
  [178, 212, 206],
];
const CLAY = [
  [250, 242, 234],
  [232, 206, 182],
];
const DUSK = [
  [22, 20, 34],
  [58, 42, 78],
];
const SLATE = [
  [238, 241, 246],
  [198, 209, 226],
];

/*
 * The themes card, which used to be `DUSK` and was the wrong kind of dark.
 *
 * Two things went wrong at once, and the second was caused by the first. Next
 * to three pastel siblings a near-black card does not read as one of a set, it
 * reads as a mistake. And the rosette is drawn with a dark navy outline: on a
 * light field that outline is what gives every petal its edge, and on a field
 * darker than the outline it disappears, leaving the colours to end wherever
 * they end. What looks like a rough picture is a picture with its edges
 * swallowed.
 *
 * Lilac keeps the hue the card had — this is the card about colour, and it was
 * the purple one — at a lightness that lets the outline do its job.
 */
const LILAC = [
  [246, 242, 252],
  [212, 200, 236],
];

/**
 * Scales an image to cover `width`×`height` and crops what overflows.
 *
 * `focus` picks which part survives — 0 keeps the left or top edge, 1 the right
 * or bottom. It is load-bearing here rather than cosmetic: each of these images
 * carries a small generator watermark in its bottom-right corner, and the crop
 * that fits a square source into a 4:3 card is chosen to land outside it.
 */
function cover(source, width, height, focus = [0.5, 0.5]) {
  const scale = Math.max(width / source.width, height / source.height);
  const scaled = resize(source, Math.round(source.width * scale), Math.round(source.height * scale));

  return drawOver(
    createImage(width, height),
    scaled,
    Math.round((width - scaled.width) * focus[0]),
    Math.round((height - scaled.height) * focus[1]),
  );
}

/**
 * A rosette on a gradient.
 *
 * Still how the small cards are made, and deliberately so. The four large
 * images are drawn tilework; a card is 800×600 and at that size a lattice of
 * stars is texture rather than pattern, and five of them in a row compete with
 * the words beside them. One medallion on a quiet ground says what a card needs
 * to say.
 *
 * Deliberately not a dense tiling of the *rosette*. It carries the "ZELLIJ"
 * wordmark at its centre, so repeating it across a canvas reads as a watermark
 * rather than as tilework — one medallion, or a small cluster, says it once and
 * says it better.
 *
 * `align` shifts the cluster's centre horizontally (0 left, 0.5 centred, 1
 * right), which is how the wide panel keeps its artwork clear of the copy.
 */
function emblem({ width, height, from, to, scale = 0.74, count = 1, align = 0.5, angle = 0.5 }) {
  const canvas = gradientFill(createImage(width, height), from, to, angle);

  const size = Math.round(height * scale);
  const tile = resize(rosette, size, Math.round((size * rosette.height) / rosette.width));

  // Overlapping slightly interlocks the points, the way laid tile does.
  const step = tile.width * 0.82;
  const spread = step * (count - 1);
  const centre = tile.width / 2 + (width - tile.width - spread) * align;

  for (let i = 0; i < count; i += 1) {
    drawOver(
      canvas,
      tile,
      Math.round(centre + i * step - tile.width / 2),
      Math.round((height - tile.height) / 2),
    );
  }

  return canvas;
}

/* ------------------------------------------------------------------ output */

// Clear what the previous generator left behind; otherwise it lingers in
// public/ after the next asset sync.
await rm(path.join(root, 'tile'), { recursive: true, force: true });
for (const stale of ['hero-mosaic.png', 'logo.svg', 'logo-dark.svg']) {
  await rm(path.join(root, stale), { force: true });
}
await mkdir(root, { recursive: true });

const IMAGES = {
  /*
   * The four drawn fields.
   *
   * No rosette laid over them. Tried that on the photographs and it was noise:
   * tilework is pattern at every scale and so is the rosette, and one over the
   * other left neither readable. The field is the artwork here — and now that
   * it is drawn rather than photographed, the name can be set into it the way a
   * zellij panel carries a calligraphic band, instead of floating a medallion
   * on top.
   *
   * `cell` is the lattice pitch in finished pixels, and it is the only dial
   * that matters: too large and three stars fill a hero, too small and the
   * whole thing turns to texture. Roughly a tenth of the width holds up.
   */
  'hero.png': tiles({ width: 1600, height: 900, cell: 168, palette: PALETTES.fez, word: 0.115 }),
  // The section lays its own scrim over this one, so it carries no wordmark of
  // its own — the copy sitting on it is the message.
  'panel-themes.png': tiles({ width: 2000, height: 900, cell: 182, palette: PALETTES.meknes }),
  'og.png': emblem({ width: 1200, height: 630, from: INK[0], to: INK[1], scale: 0.82 }),

  'card-content.png': cover(CARD_PHOTOS.a, 800, 600, [0.5, 0.24]),
  'card-sections.png': cover(CARD_PHOTOS.b, 800, 600, [0.5, 0.24]),
  'card-themes.png': cover(CARD_PHOTOS.c, 800, 600, [0.12, 0.5]),
  'card-guides.png': tiles({ width: 800, height: 600, cell: 132, palette: PALETTES.meknes }),
  'card-cli.png': tiles({ width: 800, height: 600, cell: 132, palette: PALETTES.majorelle }),

  'bento-model.png': emblem({ width: 1200, height: 750, from: SEA[0], to: SEA[1], scale: 0.8 }),
  'bento-themes.png': tiles({ width: 1200, height: 750, cell: 152, palette: PALETTES.fez }),

  /*
   * Artwork for the documentation examples under `content/examples`. A gallery
   * needs six images and a team grid three before either shows what it does, so
   * they are derived here alongside everything else rather than committed.
   */
  'example/tile-1.png': emblem({ width: 900, height: 900, from: SEA[0], to: SEA[1] }),
  'example/tile-2.png': emblem({ width: 900, height: 900, from: CLAY[0], to: CLAY[1], angle: 0.2 }),
  'example/tile-3.png': emblem({ width: 900, height: 900, from: DUSK[0], to: DUSK[1], angle: 0.8 }),
  'example/tile-4.png': emblem({ width: 900, height: 900, from: SLATE[0], to: SLATE[1] }),
  'example/tile-5.png': emblem({ width: 900, height: 900, from: INK[0], to: INK[1], angle: 0.3 }),
  'example/tile-6.png': emblem({ width: 900, height: 900, from: SEA[1], to: SEA[0], angle: 0.6 }),

  'example/person-1.png': emblem({ width: 600, height: 600, from: SEA[0], to: SEA[1], scale: 0.6 }),
  'example/person-2.png': emblem({ width: 600, height: 600, from: CLAY[0], to: CLAY[1], scale: 0.6 }),
  'example/person-3.png': emblem({ width: 600, height: 600, from: DUSK[0], to: DUSK[1], scale: 0.6 }),

  'example/wide-1.png': emblem({ width: 1600, height: 900, from: DUSK[0], to: DUSK[1], scale: 0.7 }),
  'example/wide-2.png': emblem({ width: 1600, height: 900, from: SLATE[0], to: SLATE[1], scale: 0.7 }),
  'example/poster.png': emblem({ width: 1600, height: 900, from: INK[0], to: INK[1], scale: 0.7 }),

  /*
   * Promo tiles carry their copy over the artwork, so the emblem is pushed to
   * one side and scaled down. Centred artwork behind centred copy is what the
   * first attempt looked like, and neither was readable.
   */
  'example/promo-wide.png': emblem({
    width: 2000,
    height: 900,
    from: INK[0],
    to: INK[1],
    scale: 0.42,
    align: 0.95,
  }),
  // `count: 0` leaves the field bare. These tiles are close to square, so the
  // centred copy reaches every part of them and there is nowhere an emblem can
  // sit without landing under a word.
  'example/promo-1.png': emblem({ width: 1000, height: 900, from: DUSK[0], to: DUSK[1], count: 0, angle: 0.3 }),
  'example/promo-2.png': emblem({ width: 1000, height: 900, from: SEA[0], to: SEA[1], count: 0, angle: 0.7 }),

  /* Stand-in customer wordmarks for the logo strip. */
  'example/mark-1.png': emblem({ width: 480, height: 200, from: SLATE[0], to: SLATE[0], scale: 0.7 }),
  'example/mark-2.png': emblem({ width: 480, height: 200, from: SLATE[0], to: SLATE[0], scale: 0.6 }),
  'example/mark-3.png': emblem({ width: 480, height: 200, from: SLATE[0], to: SLATE[0], scale: 0.8 }),
  'example/mark-4.png': emblem({ width: 480, height: 200, from: SLATE[0], to: SLATE[0], scale: 0.5 }),
};

await mkdir(path.join(root, 'example'), { recursive: true });

for (const [name, image] of Object.entries(IMAGES)) {
  encodePng(image, path.join(root, name));
}

/*
 * The nav mark, at four times the 28px it renders at so it stays sharp on a
 * retina display. One file for both colour modes: it is a full-colour tile on a
 * transparent ground, and reads on a light or a dark bar.
 *
 * Square, from a square source. Deriving the height from the width the way the
 * wordmark did would let a one-pixel difference in the source through as a
 * visibly oval circle.
 */
encodePng(resize(mark, 112, 112), path.join(root, 'logo.png'));

console.log(`Derived ${Object.keys(IMAGES).length} images and 1 mark from the brand artwork.`);
