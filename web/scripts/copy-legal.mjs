// Copies the root license files into public/legal so Vite ships them with the web build.
// Runs automatically before `npm run build` (see "prebuild" in package.json). No dependencies.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const repoRoot = resolve(webRoot, '..');
const outDir = resolve(webRoot, 'public', 'legal');

const files = [
  { from: resolve(repoRoot, 'LICENSE'), to: 'LICENSE.txt' },
  { from: resolve(repoRoot, 'THIRD_PARTY_NOTICES.txt'), to: 'THIRD_PARTY_NOTICES.txt' },
];

const missing = files.filter((f) => !existsSync(f.from));
if (missing.length > 0) {
  const list = missing.map((f) => `  - ${f.from}`).join('\n');
  console.error(`copy-legal: source file(s) not found:\n${list}\nRestore them at the repository root before building.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const f of files) {
  copyFileSync(f.from, resolve(outDir, f.to));
  console.log(`copy-legal: ${f.from} -> public/legal/${f.to}`);
}
