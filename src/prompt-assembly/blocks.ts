import type { InputPayload } from './types.js';

/**
 * Process #9 §8 — memory block. Most-recent-first list capped by N entries.
 * Each entry is summarized to one line; the LLM has the raw context, no need
 * for verbatim memory dumps.
 */
const MEMORY_DEFAULT_CAP = 10;

export function buildMemoryBlock(
  retrievedMemories: InputPayload['retrievedMemories'],
  cap: number = MEMORY_DEFAULT_CAP,
): string {
  if (retrievedMemories.length === 0) {
    return '## Memory\n(no prior memories retrieved)';
  }
  // Sort by createdAt desc (most recent first), then take up to `cap`.
  const sorted = [...retrievedMemories].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const limited = sorted.slice(0, cap);
  const lines: string[] = ['## Memory'];
  for (const m of limited) {
    const date = m.createdAt.toISOString().slice(0, 10);
    lines.push(`- (${date}) ${oneLine(m.content)}`);
  }
  return lines.join('\n');
}

/**
 * Process #9 §9 — session context. Last 3–5 turns rendered as a User/Assistant
 * transcript so the LLM has continuity. Caller provides them oldest-first.
 */
export function buildSessionContext(sessionTurns: InputPayload['sessionTurns']): string {
  if (sessionTurns.length === 0) {
    return '## Recent session context\n(this is the first turn of the session)';
  }
  const lines: string[] = ['## Recent session context'];
  for (const t of sessionTurns) {
    lines.push(`User: ${oneLine(t.userMessage)}`);
    if (t.responseText !== null && t.responseText !== '') {
      lines.push(`Assistant: ${oneLine(t.responseText)}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/**
 * Process #9 §10 — user profile block. **PII discipline**: only first name
 * (no phone), no encrypted columns. Goals + role + city + diaspora flag are
 * the LLM-relevant slice. `profile.firstName` is omitted from the prompt
 * altogether per CLAUDE.md hard rule #4 — even first names are kept out of
 * provider logs in v1; revisit when we have provider redaction guarantees.
 */
export function buildUserProfileBlock(profile: InputPayload['userProfile']): string {
  const lines: string[] = ['## User profile'];
  if (profile.role !== undefined) {
    lines.push(`Role: ${profile.role}`);
  }
  if (profile.location !== undefined) {
    lines.push(`Location: ${profile.location}`);
  }
  if (profile.timezone !== undefined) {
    lines.push(`Timezone: ${profile.timezone}`);
  }
  if (profile.isDiaspora !== undefined) {
    lines.push(`Diaspora: ${profile.isDiaspora ? 'yes' : 'no'}`);
  }
  if (Array.isArray(profile.goals) && profile.goals.length > 0) {
    lines.push(`Goals: ${profile.goals.join(', ')}`);
  }
  if (Array.isArray(profile.mappedPractices) && profile.mappedPractices.length > 0) {
    lines.push(`Practices in focus: ${profile.mappedPractices.join(', ')}`);
  }
  if (lines.length === 1) {
    lines.push('(profile is sparse — proceed without strong personalization)');
  }
  return lines.join('\n');
}

/**
 * Process #9 §11 — current user message. Unicode-NFC normalized + trimmed,
 * never modified beyond that.
 */
export function buildUserMessageBlock(userMessage: string): string {
  const normalized = userMessage.normalize('NFC').trim();
  return `## Current user message\n${normalized}`;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Step 12 helpers — half-truncate memory, last-1-or-2-only session, drop framing. */
export function truncateMemoryHalf(block: string): string {
  if (!block.startsWith('## Memory\n')) {
    return block;
  }
  const lines = block.split('\n');
  const header = lines[0]!;
  const items = lines.slice(1);
  if (items.length <= 1) {
    return block;
  }
  const keep = Math.max(1, Math.floor(items.length / 2));
  return [header, ...items.slice(0, keep)].join('\n');
}

export function truncateSessionToLastTurns(block: string, keepTurns: number = 1): string {
  if (!block.startsWith('## Recent session context\n')) {
    return block;
  }
  const lines = block.split('\n');
  // Each turn is "User: ..." + (optional "Assistant: ...") + blank line, but we
  // preserved trimEnd, so blank lines may be missing. Walk from the end finding
  // `keepTurns` "User:" entries.
  const userIndices: number[] = [];
  for (let i = lines.length - 1; i >= 1; i--) {
    if (lines[i]!.startsWith('User:')) {
      userIndices.unshift(i);
      if (userIndices.length === keepTurns) {
        break;
      }
    }
  }
  if (userIndices.length === 0) {
    return block;
  }
  const startIdx = userIndices[0]!;
  return ['## Recent session context (truncated)', ...lines.slice(startIdx)].join('\n');
}
