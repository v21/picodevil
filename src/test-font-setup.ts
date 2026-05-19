// globalSetup: runs in Node.js. Reads pre-converted TTF files and injects
// into browser tests as base64 strings.
import { readFileSync } from 'fs';
import { join } from 'path';

// Map of font family → primary (non-italic) TTF stem, derived from style.css @font-face rules.
const VARIABLE_FONT_FILES: Record<string, string> = {
  'Anybody':        'Anybody-VF',
  'EB Garamond':    'EBGaramond-VF',
  'Epilogue':       'Epilogue-VF',
  'Gluten':         'GlutenVariable',
  'Handjet':        'Handjet-VF',
  'Hepta Slab':     'HeptaSlab-VF',
  'Inter Tight':    'InterTight-VF',
  'Nunito':         'Nunito-VF',
  'Oswald':         'Oswald-VF',
  'Public Sans':    'PublicSans-VF',
  'Recursive':      'Recursive_VF_1.085',
  'Shantell Sans':  'ShantellSans',
  'Sono':           'Sono-VF',
  'Source Serif 4': 'SourceSerif4Variable-Roman',
};

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const fontsDir = join(process.cwd(), 'public/fonts');

  // Hepta Slab TTF for the single-font rendering test.
  const heptaBuf = readFileSync(join(fontsDir, 'HeptaSlab-VF.ttf'));
  provide('heptaSlabTTF', heptaBuf.toString('base64'));

  // All variable font TTFs for the comprehensive axes test.
  const variableFonts: Record<string, string> = {};
  for (const [family, stem] of Object.entries(VARIABLE_FONT_FILES)) {
    const buf = readFileSync(join(fontsDir, `${stem}.ttf`));
    variableFonts[family] = buf.toString('base64');
  }
  provide('variableFontTTFs', variableFonts);
}
