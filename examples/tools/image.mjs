/**
 * A tiny RGBA PNG toolkit for build scripts: decode, trim, scale, composite,
 * encode.
 *
 * It exists so the apps can derive their imagery from the real brand artwork
 * — sizing a wordmark for a nav bar, laying a rosette onto a themed field —
 * without adding an image dependency to a project that otherwise has none.
 *
 * Scope is deliberately narrow: 8-bit non-interlaced RGBA, which is what the
 * source art is. Anything else throws rather than guessing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

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

/** An RGBA raster: `{ width, height, data }` with 4 bytes per pixel. */
export function createImage(width, height, fill = [0, 0, 0, 0]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return { width, height, data };
}

export function decodePng(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24];
  const colourType = buf[25];
  const interlace = buf[28];

  if (depth !== 8 || colourType !== 6 || interlace !== 0) {
    throw new Error(
      `${file}: expected 8-bit non-interlaced RGBA (depth 8, type 6, interlace 0), ` +
        `got depth ${depth}, type ${colourType}, interlace ${interlace}`,
    );
  }

  const parts = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') parts.push(buf.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const data = Buffer.alloc(height * stride);

  // Undo the per-scanline filters (PNG spec §9).
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const row = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? row[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let value = src[i];

      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }

      row[i] = value & 0xff;
    }
  }

  return { width, height, data };
}

export function encodePng({ width, height, data }, file) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha

  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/**
 * Crops to the bounding box of pixels above `threshold` alpha, plus `pad`.
 *
 * Artwork exported from a design tool usually carries a lot of empty canvas.
 * Left in, it shrinks the visible mark to nothing once the image is scaled to
 * a nav bar's height.
 */
export function trim(image, { threshold = 8, pad = 0 } = {}) {
  const { width, height, data } = image;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0) return image; // nothing above the threshold; leave it alone

  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);

  const out = createImage(right - left + 1, bottom - top + 1);
  for (let y = 0; y < out.height; y += 1) {
    data.copy(
      out.data,
      y * out.width * 4,
      ((top + y) * width + left) * 4,
      ((top + y) * width + left + out.width) * 4,
    );
  }
  return out;
}

/**
 * Area-averaged resample. Slower than nearest-neighbour and much better on a
 * downscale, which is all this is used for — a nav logo goes from ~1500px to
 * ~40px, where point sampling turns fine detail into noise.
 *
 * Averaging happens in premultiplied alpha, so transparent pixels do not drag
 * their (meaningless) colour into the edges of the mark.
 */
export function resize(image, width, height) {
  const out = createImage(width, height);
  const scaleX = image.width / width;
  const scaleY = image.height / height;

  /*
   * Enlarging needs interpolation, not averaging.
   *
   * The loop below averages every source pixel falling inside an output pixel,
   * which is right for shrinking and degenerates when growing: with less than
   * one source pixel per output pixel the range is a single pixel, and box
   * averaging becomes nearest-neighbour. That is why the rosette had hard
   * stepped edges everywhere it was drawn larger than the 366px it is authored
   * at — which is most places, since a card medallion is 444px and a hero one
   * was 738px.
   *
   * Bilinear cannot invent detail the source does not have, so an enlarged
   * rosette is softer than a native one. Soft is what enlargement looks like;
   * stepped is what a bug looks like.
   */
  if (scaleX < 1 || scaleY < 1) return enlarge(image, width, height, scaleX, scaleY);

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));

    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;

      for (let sy = y0; sy < y1 && sy < image.height; sy += 1) {
        for (let sx = x0; sx < x1 && sx < image.width; sx += 1) {
          const i = (sy * image.width + sx) * 4;
          const alpha = image.data[i + 3] / 255;
          r += image.data[i] * alpha;
          g += image.data[i + 1] * alpha;
          b += image.data[i + 2] * alpha;
          a += image.data[i + 3];
          n += 1;
        }
      }

      const o = (y * width + x) * 4;
      const alpha = n > 0 ? a / n : 0;
      const unpremultiply = alpha > 0 ? 255 / alpha : 0;
      out.data[o] = Math.min(255, Math.round((r / n) * unpremultiply));
      out.data[o + 1] = Math.min(255, Math.round((g / n) * unpremultiply));
      out.data[o + 2] = Math.min(255, Math.round((b / n) * unpremultiply));
      out.data[o + 3] = Math.round(alpha);
    }
  }

  return out;
}

/**
 * Bilinear enlargement, sampling in premultiplied alpha.
 *
 * Premultiplied because a transparent pixel still carries a colour, and on a
 * cut-out like the rosette that colour is arbitrary. Blending it straight would
 * pull whatever is stored outside the shape into the edge and leave a halo all
 * the way round.
 */
function enlarge(image, width, height, scaleX, scaleY) {
  const out = createImage(width, height);
  const maxX = image.width - 1;
  const maxY = image.height - 1;

  for (let y = 0; y < height; y += 1) {
    // Pixel centres, so the sampled grid stays aligned with the source's.
    const sy = Math.min(maxY, Math.max(0, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(maxY, y0 + 1);
    const wy = sy - y0;

    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(maxX, Math.max(0, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(maxX, x0 + 1);
      const wx = sx - x0;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (const [px, py, weight] of [
        [x0, y0, (1 - wx) * (1 - wy)],
        [x1, y0, wx * (1 - wy)],
        [x0, y1, (1 - wx) * wy],
        [x1, y1, wx * wy],
      ]) {
        const i = (py * image.width + px) * 4;
        const alpha = image.data[i + 3] / 255;
        r += image.data[i] * alpha * weight;
        g += image.data[i + 1] * alpha * weight;
        b += image.data[i + 2] * alpha * weight;
        a += image.data[i + 3] * weight;
      }

      const o = (y * width + x) * 4;
      const alpha = a / 255;
      const unpremultiply = alpha > 0 ? 1 / alpha : 0;
      out.data[o] = Math.min(255, Math.round(r * unpremultiply));
      out.data[o + 1] = Math.min(255, Math.round(g * unpremultiply));
      out.data[o + 2] = Math.min(255, Math.round(b * unpremultiply));
      out.data[o + 3] = Math.round(a);
    }
  }

  return out;
}

/** Source-over composite of `src` onto `dst` at (x, y), scaled by `opacity`. */
export function drawOver(dst, src, x, y, opacity = 1) {
  for (let sy = 0; sy < src.height; sy += 1) {
    const dy = y + sy;
    if (dy < 0 || dy >= dst.height) continue;

    for (let sx = 0; sx < src.width; sx += 1) {
      const dx = x + sx;
      if (dx < 0 || dx >= dst.width) continue;

      const s = (sy * src.width + sx) * 4;
      const alpha = (src.data[s + 3] / 255) * opacity;
      if (alpha <= 0) continue;

      const d = (dy * dst.width + dx) * 4;
      const inverse = 1 - alpha;
      dst.data[d] = Math.round(src.data[s] * alpha + dst.data[d] * inverse);
      dst.data[d + 1] = Math.round(src.data[s + 1] * alpha + dst.data[d + 1] * inverse);
      dst.data[d + 2] = Math.round(src.data[s + 2] * alpha + dst.data[d + 2] * inverse);
      dst.data[d + 3] = Math.max(dst.data[d + 3], Math.round(alpha * 255));
    }
  }
  return dst;
}

/** Fills with a linear gradient, `stops` being `[[r,g,b], …]` corner to corner. */
export function gradientFill(image, from, to, angle = 0.5) {
  const { width, height, data } = image;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = Math.min(1, Math.max(0, (x / width) * angle + (y / height) * (1 - angle)));
      const i = (y * width + x) * 4;
      data[i] = Math.round(from[0] + (to[0] - from[0]) * t);
      data[i + 1] = Math.round(from[1] + (to[1] - from[1]) * t);
      data[i + 2] = Math.round(from[2] + (to[2] - from[2]) * t);
      data[i + 3] = 255;
    }
  }
  return image;
}

/**
 * Lifts near-black pixels toward `target`, leaving coloured ones alone.
 *
 * For deriving a dark-mode variant of a mark whose artwork mixes saturated
 * colours with near-black letterforms: the colours read fine on a dark bar, the
 * black ones vanish. Blending proportionally rather than switching at the
 * threshold keeps antialiased edges smooth.
 *
 * Pick `threshold` from the artwork's own luminance histogram — it must sit
 * below the darkest colour you want to keep, or that colour is washed out too.
 */
export function lightenDark(image, { threshold = 90, target = [245, 245, 247] } = {}) {
  const out = createImage(image.width, image.height);
  image.data.copy(out.data);

  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] === 0) continue;

    const luminance = 0.2126 * out.data[i] + 0.7152 * out.data[i + 1] + 0.0722 * out.data[i + 2];
    if (luminance >= threshold) continue;

    const t = 1 - luminance / threshold;
    out.data[i] = Math.round(out.data[i] + (target[0] - out.data[i]) * t);
    out.data[i + 1] = Math.round(out.data[i + 1] + (target[1] - out.data[i + 1]) * t);
    out.data[i + 2] = Math.round(out.data[i + 2] + (target[2] - out.data[i + 2]) * t);
  }

  return out;
}
