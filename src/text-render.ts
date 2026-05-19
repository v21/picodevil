export const PAD = 12;
export const LINE_HEIGHT_FACTOR = 1.4;
const DEFAULT_SIZE = 128;
const DEFAULT_FAMILY = 'sans-serif';
const CSS_SIZE_RE = /\d+(\.\d+)?(px|pt|em|rem|%|vw|vh)/;

/**
 * Build a CSS font string from a font shorthand/family and an optional size override.
 *
 * - If `font` already contains a CSS size unit, it is used as-is (or size is replaced if `fontSize` is given).
 * - If `font` has no size, `fontSize` (or the 36px default) is prepended.
 *
 * @param {string} [font] CSS font shorthand (e.g. "bold 18px monospace") or family name
 * @param {number} [fontSize] px size — always overrides whatever size is in `font`
 * @returns {string} resolved CSS font string
 * @example
 * buildFontString('IBM Plex Mono')          // '36px IBM Plex Mono'
 * buildFontString('bold 18px monospace')    // 'bold 18px monospace'
 * buildFontString('bold monospace', 24)     // '24px bold monospace'
 * buildFontString('bold 32px mono', 18)     // '18px bold mono'  (size replaced)
 */
export function buildFontString(font?: string, fontSize?: number): string {
  const f = font ?? DEFAULT_FAMILY;
  if (fontSize != null) {
    return CSS_SIZE_RE.test(f)
      ? f.replace(CSS_SIZE_RE, `${fontSize}px`)
      : `${fontSize}px ${f}`;
  }
  return CSS_SIZE_RE.test(f) ? f : `${DEFAULT_SIZE}px ${f}`;
}

/**
 * Render text to an HTMLCanvasElement sized to fit the content.
 * Background is transparent unless `fontBGColor` is provided.
 * Newlines in `text` produce multi-line output.
 *
 * @param {string} text the string to render (use \n for line breaks)
 * @param {string} fontStr resolved CSS font string (from buildFontString)
 * @param {string} fontColor CSS color for the text glyphs
 * @param {string} [fontBGColor] CSS color for the canvas background (default: transparent)
 * @returns {HTMLCanvasElement} canvas sized to the text content with padding
 */
export function renderTextToCanvas(
  text: string,
  fontStr: string,
  fontColor: string,
  fontBGColor?: string,
): HTMLCanvasElement {
  const lines = text.split('\n');
  const sizeMatch = CSS_SIZE_RE.exec(fontStr);
  const size = sizeMatch ? parseFloat(sizeMatch[0]) : DEFAULT_SIZE;
  const lh = size * LINE_HEIGHT_FACTOR;

  const tmp = document.createElement('canvas');
  const tmpCtx = tmp.getContext('2d')!;
  tmpCtx.font = fontStr;
  const maxW = Math.max(1, ...lines.map(l => tmpCtx.measureText(l).width));

  const canvas = document.createElement('canvas');
  canvas.width  = Math.ceil(maxW + PAD * 2);
  canvas.height = Math.ceil(lh * lines.length + PAD * 2);

  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (fontBGColor) {
    ctx.fillStyle = fontBGColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.font = fontStr;
  ctx.fillStyle = fontColor;
  ctx.textBaseline = 'middle';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], PAD, PAD + i * lh + lh / 2);
  }
  return canvas;
}
