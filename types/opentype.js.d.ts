declare module 'opentype.js' {
  interface Path {
    commands: Array<{ type: string; x?: number; y?: number }>;
    fill: string | null;
    stroke: string | null;
    draw(ctx: CanvasRenderingContext2D): void;
    toSVG(decimalPlaces?: number): string;
  }

  interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    tables: Record<string, any>;
    getPath(text: string, x: number, y: number, fontSize: number, options?: Record<string, any>): Path;
    getAdvanceWidth(text: string, fontSize: number, options?: Record<string, any>): number;
  }

  function parse(buffer: ArrayBuffer): Font;
  export { Font, Path, parse };
  export default { parse };
}

declare module 'wawoff2' {
  function decompress(data: Uint8Array): Promise<Uint8Array>;
  export { decompress };
}
