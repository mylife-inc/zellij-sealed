/**
 * Sizes the Shebka mark for the nav bar.
 *
 * The source export carries a large empty canvas — the mark occupies about
 * 8% of it — so scaling the file straight down would leave a wordmark a few
 * pixels tall. Trimming to the artwork's own bounds first is what makes it
 * legible at bar height.
 */
import path from 'node:path';
import { decodePng, encodePng, lightenDark, resize, trim } from '../../tools/image.mjs';

const root = path.resolve(import.meta.dirname, '..', 'content', 'assets');
const source = trim(decodePng(path.join(root, 'brand', 'shebka-logo.png')));

// Four times the 24px it renders at, so it stays sharp on a retina display.
const height = 96;
const scaled = resize(source, Math.round((height * source.width) / source.height), height);

encodePng(scaled, path.join(root, 'shebka.png'));

/*
 * A dark-mode variant. The mark's "B" and "A" are near-black in the artwork and
 * disappear on a dark bar, while its cyan, blue and yellow read fine there. The
 * threshold sits between the dark letters (luminance 26–77) and the darkest
 * colour worth keeping (the blue, at 110), so only the blacks are lifted.
 */
encodePng(lightenDark(scaled, { threshold: 90 }), path.join(root, 'shebka-dark.png'));

console.log(
  `Shebka mark: ${source.width}×${source.height} trimmed → ${scaled.width}×${scaled.height}, ` +
    `plus a lifted dark-mode variant.`,
);
