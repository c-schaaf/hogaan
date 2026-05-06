import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ControlId, EvidenceOutcome, EvidenceRow, Tier } from './types.js';

/**
 * Append-only writer for Phase 10 audit-evidence rows.
 *
 * One file per (date, testId) tuple under audit-evidence/phase-10/.
 * Multiple invocations within the same test run append to a JSON-array
 * file; rerunning the test on a later day creates a new dated file so
 * historical evidence is preserved.
 *
 * The writer is fail-open at the test layer: if the file system is
 * unavailable the test still passes/fails on its own merits. Audit
 * coverage is reported separately in the SUMMARY.md aggregation step.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'audit-evidence', 'phase-10');
const EVIDENCE_DIR_PHASE_12 = path.join(REPO_ROOT, 'audit-evidence', 'phase-12');

function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export interface RecordEvidenceInput {
  testId: string;
  controlId: ControlId;
  tier: Tier;
  outcome: EvidenceOutcome;
  description: string;
  details?: Record<string, unknown>;
  artifactHash?: string;
  phase?: 'phase-10' | 'phase-12';
}

/**
 * Write a single audit evidence row to disk. Idempotent on the file path
 * level: re-running the same test on the same day overwrites the prior
 * row for that test (you get the latest result).
 */
export async function recordEvidence(input: RecordEvidenceInput): Promise<void> {
  const phase = input.phase ?? 'phase-10';
  const row: EvidenceRow = {
    recordedAt: new Date().toISOString(),
    testId: input.testId,
    controlId: input.controlId,
    tier: input.tier,
    outcome: input.outcome,
    description: input.description,
    phase,
    ...(input.details !== undefined ? { details: input.details } : {}),
    ...(input.artifactHash !== undefined ? { artifactHash: input.artifactHash } : {}),
  };

  const dir = phase === 'phase-12' ? EVIDENCE_DIR_PHASE_12 : EVIDENCE_DIR;
  const filename = `${isoDate()}-${slug(input.testId)}.json`;
  const filepath = path.join(dir, filename);

  try {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(filepath, JSON.stringify(row, null, 2) + '\n', 'utf8');
  } catch (err) {
    // Fail-open at the test layer — surface a warning but don't fail the test.
    // SUMMARY.md aggregation will catch missing rows.
    process.stderr.write(
      `[audit-evidence] failed to write ${filepath}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

export const _internal = { EVIDENCE_DIR, slug, isoDate };
