export type FontSource = 'websafe' | 'hosted' | 'local';

export interface FontAxisDef {
  tag: string;
  min: number;
  max: number;
}

/** Variable font axes for bundled hosted fonts, keyed by font family name.
 *  Derived from fvar tables in the actual font files. Only fonts where the
 *  loaded woff2 is a true variable font are listed here. */
export const FONT_AXES: Record<string, FontAxisDef[]> = {
  'Anybody': [
    { tag: 'wght', min: 100, max: 900 },
    { tag: 'wdth', min: 50,  max: 150 },
    { tag: 'ital', min: 0,   max: 1   },
  ],
  'EB Garamond': [{ tag: 'wght', min: 400, max: 800 }],
  'Epilogue':    [{ tag: 'wght', min: 100, max: 900 }],
  'Gluten': [
    { tag: 'wght', min: 100, max: 900 },
    { tag: 'ital', min: -1,  max: 1   },
  ],
  'Handjet': [
    { tag: 'wght', min: 100, max: 900 },
    { tag: 'ELGR', min: 1,   max: 2   },
    { tag: 'ELSH', min: 0,   max: 16  },
  ],
  'Hepta Slab':  [{ tag: 'wght', min: 1,   max: 900  }],
  'Inter Tight': [{ tag: 'wght', min: 100, max: 900  }],
  'Nunito':      [{ tag: 'wght', min: 200, max: 1000 }],
  'Oswald':      [{ tag: 'wght', min: 200, max: 700  }],
  'Public Sans': [{ tag: 'wght', min: 100, max: 900  }],
  'Recursive': [
    { tag: 'MONO', min: 0,   max: 1    },
    { tag: 'CASL', min: 0,   max: 1    },
    { tag: 'wght', min: 300, max: 1000 },
    { tag: 'slnt', min: -15, max: 0    },
    { tag: 'CRSV', min: 0,   max: 1    },
  ],
  'Shantell Sans': [
    { tag: 'wght', min: 300,  max: 800  },
    { tag: 'INFM', min: 0,    max: 100  },
    { tag: 'BNCE', min: -100, max: 100  },
    { tag: 'SPAC', min: 0,    max: 100  },
    { tag: 'ital', min: 0,    max: 1    },
  ],
  'Sono': [
    { tag: 'wght', min: 200, max: 800 },
    { tag: 'MONO', min: 0,   max: 1   },
  ],
  'Source Serif 4': [
    { tag: 'wght', min: 200, max: 900 },
    { tag: 'opsz', min: 8,   max: 60  },
  ],
};

export interface FontEntry {
  family: string;
  source: FontSource;
}

export const PRESET_FONTS: FontEntry[] = [
  // Web-safe generics
  ...([
    'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'Impact', 'Comic Sans MS', 'Helvetica',
  ] as const).map(family => ({ family, source: 'websafe' as const })),

  // Hosted fonts (self-served from /fonts/)
  ...([
    'Anybody',
    'Avara',
    'Barriecito',
    'Basteleur',
    'BIZ UDPMincho',
    'Bluu Next',
    'CirrusCumulus',
    'EB Garamond',
    'Epilogue',
    'Generale Station',
    'Gluten',
    'Handjet',
    'Hepta Slab',
    'IBM Plex Mono',
    'IBM Plex Sans',
    'Instrument Serif',
    'Inter Tight',
    'JGS',
    'Kaeru Kaeru',
    'Lithops',
    'Lobular',
    'Nunito',
    'Nyght Serif',
    'Nyght Serif Italic',
    'Old Standard TT',
    'Oswald',
    'Picaflor',
    'PicNic',
    'Pilowlava',
    'Piscolabis',
    'Public Sans',
    'Recursive',
    'Roubaix Industrielle',
    'Savate',
    'Select Mono',
    'Shantell Sans',
    'Sligoil',
    'Sono',
    'Source Serif 4',
    'Terminal Grotesque',
    'TINY',
    'Trickster',
    'Xanh Mono',
    'Zen Old Mincho',
  ] as const).map(family => ({ family, source: 'hosted' as const })),
];

/** Mutable list — local system fonts are appended after queryLocalFonts() succeeds. */
export let availableFonts: FontEntry[] = [...PRESET_FONTS];

let _onReady: ((fonts: FontEntry[]) => void) | null = null;
let _localFontsRequested = false;

/**
 * Initialise the font list. Calls onReady immediately with the preset list.
 * Local system fonts are loaded lazily via requestLocalFonts().
 */
export function initFontList(onReady: (fonts: FontEntry[]) => void): void {
  _onReady = onReady;
  onReady(availableFonts);
}

/**
 * Request local system fonts via queryLocalFonts() (Chrome only, permission-gated).
 * No-op after the first call. Triggers the browser permission prompt — call this
 * from a user gesture context (e.g. focusing the font picker input).
 */
export async function requestLocalFonts(): Promise<void> {
  if (_localFontsRequested) return;
  _localFontsRequested = true;
  if (typeof (window as any).queryLocalFonts !== 'function') return;
  try {
    const local: Array<{ family: string }> = await (window as any).queryLocalFonts();
    const presetFamilies = new Set(PRESET_FONTS.map(f => f.family));
    const localEntries: FontEntry[] = [...new Set(local.map(f => f.family))]
      .filter(f => !presetFamilies.has(f))
      .sort()
      .map(family => ({ family, source: 'local' as const }));
    availableFonts = [...PRESET_FONTS, ...localEntries];
    _onReady?.(availableFonts);
  } catch (err) {
    console.warn('[fontPicker] queryLocalFonts() failed:', err);
  }
}
