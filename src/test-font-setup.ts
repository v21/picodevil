// globalSetup: runs in Node.js. Reads the pre-converted TTF and injects into browser tests.
import { readFileSync } from 'fs';
import { join } from 'path';

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const buf = readFileSync(join(process.cwd(), 'public/fonts/HeptaSlab-VF.ttf'));
  // Serialize as base64 so it survives the Node→browser boundary.
  provide('heptaSlabTTF', buf.toString('base64'));
}
