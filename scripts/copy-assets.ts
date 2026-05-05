import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Copy non-TypeScript assets from src/ into dist/ after `tsc` runs.
 *
 * `tsc` only emits the .js/.d.ts/.js.map artifacts of the .ts inputs —
 * static assets the runtime needs (eta templates, etc.) have to be moved
 * separately or the production server crashes when the file isn't there.
 *
 * Audit (2026-05-05): only `.eta` templates exist as runtime assets,
 * all under `src/sponsor-portal/views/`. If new asset dirs are added
 * (CSS, JSON config, fonts, etc.) extend the ASSET_DIRS list here.
 *
 * Cross-platform: uses node:fs/promises `cp` with recursive: true.
 * Works on Windows + Linux + Render without a new npm dep.
 */

interface AssetDir {
  /** Source path relative to repo root. */
  from: string;
  /** Destination path relative to repo root. */
  to: string;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ASSET_DIRS: AssetDir[] = [
  { from: 'src/sponsor-portal/views', to: 'dist/sponsor-portal/views' },
];

async function main(): Promise<void> {
  for (const dir of ASSET_DIRS) {
    const src = path.join(REPO_ROOT, dir.from);
    const dst = path.join(REPO_ROOT, dir.to);
    await cp(src, dst, { recursive: true });
    console.log(`copied ${dir.from} -> ${dir.to}`);
  }
}

main().catch((err: unknown) => {
  console.error('copy-assets fatal:', err);
  process.exit(1);
});
