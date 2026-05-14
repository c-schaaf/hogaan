/**
 * Copy non-TypeScript assets from src/ into dist/ after `tsc` runs.
 *
 * The sponsor portal (the only consumer of .eta templates) was removed,
 * leaving no runtime assets to copy. This script is kept as a no-op so the
 * `pnpm build` pipeline doesn't need editing, and so it's a one-liner to
 * re-enable if a new asset dir is added in the future.
 */

async function main(): Promise<void> {
  // No runtime assets to copy.
}

main().catch((err: unknown) => {
  console.error('copy-assets fatal:', err);
  process.exit(1);
});
