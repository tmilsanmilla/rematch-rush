import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { NATIVE_SOURCE_FILES, nativePreparationPlan } from './native-first-profile-contract.mjs';

const root = new URL('../', import.meta.url);
/** Filesystem-only source pin. No pg import, SQL, socket, environment or child tool. */
export async function nativeSourcePin() {
  const entries = await Promise.all(NATIVE_SOURCE_FILES.map(async file => [file,
    createHash('sha256').update(await readFile(new URL(file, root))).digest('hex')]));
  return Object.fromEntries(entries);
}
export async function completeNativePreparationPlan() {
  return { ...nativePreparationPlan(), sourcePin: await nativeSourcePin() };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2 && !(process.argv.length === 3 && process.argv[2] === '--plan')) throw new Error('Only --plan is supported; native execution uses its separate reviewed runner.');
  process.stdout.write(JSON.stringify(await completeNativePreparationPlan(), null, 2) + '\n');
}
