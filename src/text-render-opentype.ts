import { parse, type Font } from 'opentype.js';
import { decompress } from 'wawoff2';
import { PAD, LINE_HEIGHT_FACTOR } from './text-render';
import { FONT_AXES } from './font-list';

const fontCache = new Map<string, Font>();
const fontLoading = new Set<string>();

/**
 * Returns the loaded opentype.js Font for srcUrl, or null if not yet available.
 * Triggers an async load on first call for a given URL.
 */
export function getOpentypeFont(srcUrl: string): Font | null {
  const f = fontCache.get(srcUrl);
  if (f) return f;
  if (!fontLoading.has(srcUrl)) {
    fontLoading.add(srcUrl);
    fetch(srcUrl)
      .then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
      .then(async buf => {
        const raw = await decompress(new Uint8Array(buf));
        const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
        fontCache.set(srcUrl, parse(ab as ArrayBuffer));
      })
      .catch(err => console.warn('[uzu] opentype font load failed:', srcUrl, err));
  }
  return null;
}

/**
 * Recover the correct-case axis tag from a lowercase key.
 * fontAxis() normalises all tags to lowercase; custom axes need uppercase for opentype.js.
 */
export function resolveAxisTag(family: string, lowTag: string): string {
  return FONT_AXES[family]?.find(a => a.tag.toLowerCase() === lowTag)?.tag ?? lowTag;
}

/**
 * Render text using opentype.js glyph path operations.
 * Drawing bezier paths to Canvas 2D never taints the canvas, so the result
 * can be uploaded to WebGL via texImage2D.
 *
 * @param text — may contain \n for multi-line
 * @param font — loaded opentype.js Font object
 * @param size — font size in px
 * @param variation — axis values keyed by correct-case tag (e.g. { wght: 700, MONO: 0.5 })
 * @param fontColor — CSS color string for glyph fill
 * @param fontBGColor — CSS color string for background (default: transparent)
 */
export function renderTextOpentype(
  text: string,
  font: Font,
  size: number,
  variation: Record<string, number>,
  fontColor: string,
  fontBGColor?: string,
): HTMLCanvasElement {
  const lines = text.split('\n');
  const lh = size * LINE_HEIGHT_FACTOR;
  const opts = { variation };

  const maxW = Math.max(1, ...lines.map(l => l ? font.getAdvanceWidth(l, size, opts) : 0));

  const canvas = document.createElement('canvas');
  canvas.width  = Math.ceil(maxW + PAD * 2);
  canvas.height = Math.ceil(lh * lines.length + PAD * 2);

  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (fontBGColor) {
    ctx.fillStyle = fontBGColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Compute baseline offset from line-slot centre to font baseline.
  // Matches Canvas 2D textBaseline='middle' positioning used by renderTextToCanvas.
  const ascPx = font.ascender / font.unitsPerEm * size;
  const emPx  = (font.ascender - font.descender) / font.unitsPerEm * size;

  ctx.fillStyle = fontColor;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    const baseline = PAD + i * lh + lh / 2 + ascPx - emPx / 2;
    const path = font.getPath(lines[i], PAD, baseline, size, opts);
    path.draw(ctx);
  }
  return canvas;
}
