/**
 * Scripted stand-in coach for DEMO MODE ONLY.
 *
 * Used when `config.demoMode === true` and no ANTHROPIC_API_KEY is set, so
 * the owner can click through the real app without a model account. It is
 * NOT coaching content and not Hamse's voice: every reply starts with a
 * visible marker so nobody mistakes it for the real coach. It reads the
 * same assembled prompt the real model would get, so features like the
 * leader brief and moments are visibly "used" in demo conversations.
 *
 * Never reachable outside demo mode — see `useScriptedModel` in chat.ts.
 */

export const SCRIPTED_MARKER = '(Demo coach: scripted reply, no AI model connected.)';

const PRACTICE_KEYWORDS: [string, RegExp][] = [
  ['Peace', /conflict|tension|argu|fight|disagree|clash/i],
  ['Inclusion', /hire|hiring|onboard|belong|left out|inclusion|diverse/i],
  ['Integrity', /feedback|honest|truth|promise|trust/i],
  ['Accountability', /decision|decide|stuck|deadline|own|missed/i],
  ['Empathy', /listen|feel|upset|stress|burn|tired|frustrat/i],
  ['Innovation', /idea|new|change|experiment|pivot/i],
  ['Purpose', /purpose|why|meaning|mission|vision/i],
  ['Humility', /mistake|wrong|apolog|learn/i],
];

function pickPractice(text: string): string {
  for (const [p, re] of PRACTICE_KEYWORDS) if (re.test(text)) return p;
  return 'Dignity';
}

/** Lines under a "## What you know about this leader" heading, if present. */
export function readContextLines(systemText: string): string[] {
  const idx = systemText.indexOf('## What you know about this leader');
  if (idx < 0) return [];
  const after = systemText.slice(idx).split('\n').slice(1);
  const lines: string[] = [];
  for (const l of after) {
    if (l.startsWith('## ')) break;
    const t = l.replace(/^[-*]\s*/, '').trim();
    if (t.length > 0) lines.push(t);
  }
  return lines;
}

function paraphrase(message: string): string {
  const words = message.replace(/\s+/g, ' ').trim().split(' ');
  const head = words.slice(0, 14).join(' ');
  return words.length > 14 ? `${head}…` : head;
}

export function scriptedCoachReply(
  systemText: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const practice = pickPractice(last);
  const ctx = readContextLines(systemText);
  const openLoop = ctx.find((l) => /open loop|follow.?up|upcoming|reflection|went/i.test(l));
  const role = ctx.find((l) => /^role|^title|^team/i.test(l));

  const parts: string[] = [SCRIPTED_MARKER];
  if (messages.filter((m) => m.role === 'user').length === 1 && (openLoop ?? role) !== undefined) {
    parts.push(
      `Good to see you again. Last time we left this open: ${(openLoop ?? role ?? '').replace(/^open loop:\s*/i, '')}. Let's keep that in view.`,
    );
  }
  parts.push(`What I'm hearing: "${paraphrase(last)}"`);
  parts.push(
    `One lens that may help here is ${practice}. Leaders who are already asking this kind of question usually have more capacity than they give themselves credit for.`,
  );
  const upcoming = /meeting|conversation|talk|1:1|one-on-one|presentation|review/i.test(last);
  const hasWhen =
    /monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next week|\d{1,2}(:\d{2})?\s*(am|pm)/i.test(
      last,
    );
  if (upcoming && !hasWhen) {
    parts.push(
      'When is this conversation happening? Knowing that helps me check in with you after.',
    );
  } else {
    parts.push('What outcome would make you proud of how you handled it?');
  }
  return parts.join('\n\n');
}

export async function* scriptedStream(
  text: string,
  delayMs = 12,
): AsyncGenerator<string, void, void> {
  const tokens = text.match(/\S+\s*|\s+/g) ?? [text];
  for (const t of tokens) {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    yield t;
  }
}
