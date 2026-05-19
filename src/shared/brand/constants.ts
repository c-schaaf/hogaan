/**
 * Phase 11 R36 — canonical brand strings.
 *
 * The audit found the framework was being rendered three different ways
 * across the codebase: "twelve-practice framework", "12 practices", "twelve
 * practices of leadership". Inconsistency leaks into LLM responses
 * (prompt-templates.ts) AND user-facing copy (onboarding welcome,
 * meta-question reply). Sponsors and users see different language for the
 * same thing.
 *
 * From this point on, every user-facing rendition must reach for these
 * constants. Internal docs (CLAUDE.md, PRD, BPMN) remain unchanged — those
 * are author-owned source material.
 */

/** Canonical short-form name for the framework. Use in body copy. */
export const BRAND_FRAMEWORK_NAME = '12 Practices of Transformational Leadership';

/** Canonical short tagline for the product. Use in headers, footers, and
 *  the onboarding welcome message. NOT in coaching responses (would feel
 *  like marketing copy in a one-on-one). */
export const BRAND_TAGLINE = 'Transforming Leadership for Impact';

/** The framework owner's full name as it should appear in user copy. */
export const BRAND_AUTHOR_NAME = 'Hamse Warfa';

/**
 * Convenience phrase: how Hogaan describes its own grounding when asked
 * who/what it is (MetaQuestion reply, About surfaces). Combines
 * author + framework so callers don't have to compose it ad hoc.
 */
export const BRAND_FRAMEWORK_ATTRIBUTION = `${BRAND_AUTHOR_NAME}'s ${BRAND_FRAMEWORK_NAME}`;
