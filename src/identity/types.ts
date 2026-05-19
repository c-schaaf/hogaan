/**
 * Identity trigger source. The 'whatsapp' Postgres enum value is preserved
 * for append-only audit compliance (CLAUDE.md hard rule #3 — no rewriting
 * audit history), but no live writer should pass it going forward.
 */
export type TriggerSource = 'web_session' | 'web_signup';
