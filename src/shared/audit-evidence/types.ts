/**
 * Phase 10 audit evidence framework.
 *
 * Every Phase 10 readiness test produces TWO artifacts:
 *   (a) the standard pass/fail signal that CI checks
 *   (b) a structured JSON evidence row written to
 *       audit-evidence/phase-10/<date>-<test-id>.json
 *
 * The evidence rows feed an external audit binder that maps controls
 * to operational reality. Each row is self-describing so an auditor
 * reading just the row (without the test source) can tell what was
 * tested, what passed/failed, and which control objective is satisfied.
 *
 * 5-tier control framework (synthesized from prior tagging cues —
 * confirm with audit lead at Phase A launch):
 *
 *   T1 — Operational integrity: backup + DR, access control,
 *        magic-link expiry, secret rotation
 *   T2 — Process integrity: every BPMN process reaching its declared
 *        terminal end events on the correct inputs
 *   T3 — Privacy + safety controls: crisis routing, PII redaction,
 *        deletion cascade, tenant isolation, ≥30-user floor
 *   T4 — Performance: p99 turn latency, throughput under load
 *   T5 — Voice + framework fidelity (Hamse-anchored, deferred until
 *        scoping session — see SUMMARY.md 10.2)
 */

export type Tier = 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

/**
 * Dotted control identifier. Format: <Tier>.<Domain>.<Specifier>
 *
 * Examples:
 *   T1.BackupAndDR.SupabasePITRDrill
 *   T2.Process2.E1_TurnCompleted
 *   T3.CrisisHandling.SuicidalIdeation_Direct
 *   T4.Latency.SteadyState_p99
 */
export type ControlId = string;

export type EvidenceOutcome = 'pass' | 'fail' | 'skipped' | 'deferred';

export interface EvidenceRow {
  /** ISO-8601 timestamp at row write time. */
  recordedAt: string;
  /** Stable identifier of the test producing this row. Use the test file path + test name slug. */
  testId: string;
  /** Which audit control this test substantiates. */
  controlId: ControlId;
  tier: Tier;
  outcome: EvidenceOutcome;
  /** Short description of what was tested. */
  description: string;
  /** Optional structured details — assertion values, latency numbers, sampled inputs. NO PII. */
  details?: Record<string, unknown>;
  /** Phase that produced this row. */
  phase: 'phase-10' | 'phase-12';
  /** Hash of the relevant code under test, when applicable. */
  artifactHash?: string;
}
