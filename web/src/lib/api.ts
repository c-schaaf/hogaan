// Typed fetch wrappers around the /api/* backend.
//
// Authentication is via Supabase Auth (see lib/supabase.ts). On every
// request we attach Authorization: Bearer <access_token> from the current
// Supabase session. The backend's supabase-session middleware validates
// the token and JIT-creates a public.users row on first call.

import { supabase } from './supabase';

export interface MeResponse {
  id: string;
  fullName: string;
  email: string;
  onboarded: boolean;
  mappedPractices: string[];
}

export interface ChatTurnRequest {
  message: string;
  sessionId?: string;
  private?: boolean;
}

// SCRUM — ChatTurnResponse used to type the dead /api/chat/turn route. The
// server route was removed in SCRUM-43; the client wrapper went with it in
// PR 4 to keep the SDK from declaring a contract the backend doesn't honor.

export interface SessionSummary {
  id: string;
  title: string;
  msgs: number;
  when: string;
  group: 'This week' | 'Earlier this month' | 'Older';
}

export interface SessionDetail {
  session: { id: string; title: string | null; isPrivate: boolean };
  turns: {
    id: string;
    userMessage: string;
    responseText: string | null;
    createdAt: string;
    rating?: 'helpful' | 'not_helpful';
  }[];
}

export interface ProfilePatchBody {
  fullName?: string;
  mappedPractices?: string[];
  finishOnboarding?: boolean;
  /** Canonical experience band — used by the coach prompt assembler. */
  experienceBand?: '<5' | '5-10' | '10+';
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

interface FetchOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

async function call<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  // Attach Supabase access token if we have a session.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const resp = await fetch(path, init);
  if (!resp.ok) {
    let code: string | undefined;
    try {
      const json = (await resp.json()) as { error?: string };
      code = json.error;
    } catch {
      // ignore
    }
    throw new ApiError(resp.status, `request failed: ${resp.status}`, code);
  }
  if (resp.status === 204) return undefined as unknown as T;
  return (await resp.json()) as T;
}

/**
 * Streaming coaching-turn event. The /api/chat/turn/stream endpoint emits
 * named SSE events; this is the typed union the client consumes.
 */
export type TurnStreamEvent =
  | { type: 'start'; sessionId: string }
  | { type: 'delta'; text: string }
  | { type: 'crisis'; reason: string; resources: Record<string, string> }
  | { type: 'end'; turnId: string | null; sessionId: string | null; latencyMs: number }
  | { type: 'error'; message: string }
  // SCRUM — emitted by the server when the reply rendered but the turn
  // failed to persist (e.g., DB transaction rollback). The client should
  // surface "not saved" UI on the just-rendered bubble rather than treat
  // the stream as failed.
  | {
      type: 'warning';
      code: string;
      correlationId?: string;
      message?: string;
    };

/**
 * POST /api/chat/turn/stream as an async generator. Yields TurnStreamEvent
 * for each parsed SSE event. Throws ApiError on HTTP-level failure
 * (auth, 4xx/5xx before the stream opens). Mid-stream errors arrive as
 * `{ type: 'error' }` events, not thrown.
 */
export async function* turnStream(body: ChatTurnRequest): AsyncGenerator<TurnStreamEvent> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch('/api/chat/turn/stream', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok || resp.body === null) {
    // SCRUM-F2: on 429 (and any future user-actionable error), parse the
    // JSON body so the UI can render the server's `message` field instead
    // of a generic "stream open failed". For non-JSON or unexpected
    // shapes, fall back to the generic copy — the catch block in the chat
    // UI surfaces its own friendly fallback already.
    let friendlyMessage: string | undefined;
    try {
      const body = (await resp.json()) as { message?: unknown };
      if (typeof body.message === 'string' && body.message.length > 0) {
        friendlyMessage = body.message;
      }
    } catch {
      /* not JSON or already consumed — use the default copy */
    }
    throw new ApiError(resp.status, friendlyMessage ?? `stream open failed: ${resp.status}`);
  }

  // Manual TextDecoder (more reliable across browsers / dev proxies than
  // pipeThrough(new TextDecoderStream())).
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are separated by a blank line ("\n\n"). Parse complete
    // events out of the buffer and leave any incomplete tail for the
    // next chunk.
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const parsed = parseSseBlock(raw);
      if (parsed !== null) yield parsed;
    }
  }
}

function parseSseBlock(block: string): TurnStreamEvent | null {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  try {
    const payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
    return { type: eventName, ...payload } as TurnStreamEvent;
  } catch {
    return null;
  }
}

// ---- P1 leader brief ("What Hogaan knows about you") -------------------
export type BriefDoc = 'profile' | 'goals' | 'notes';
export interface BriefLine {
  id: string;
  text: string;
  source: 'conversation' | 'leader' | 'reflection' | 'assistant';
  updatedAt: string;
}
export interface ProfileFields {
  title?: string;
  industry?: string;
  orgType?: string;
  orgSize?: string;
  teamShape?: string;
  coachingPreference?: string;
}
export interface LeaderBrief {
  profileFields: ProfileFields;
  profile: BriefLine[];
  goals: BriefLine[];
  notes: BriefLine[];
  version: number;
  updatedAt: string | null;
  updatedBy: string;
}

// ---- P2 moments, reflections, ratings, email preferences ----------------
export type HowItWent = 'well' | 'mixed' | 'hard';
export interface Moment {
  id: string;
  what: string;
  withWhom: string | null;
  happensAt: string | null;
  status: 'upcoming' | 'reflected' | 'dismissed';
  source: 'conversation' | 'leader' | 'assistant';
  followupSentAt: string | null;
  createdAt: string;
  outcome: { howItWent: HowItWent; differently: string | null; createdAt: string } | null;
}
export interface Prefs {
  followupEmailOptIn: boolean;
  weeklyNudgeOptIn: boolean;
  unsubscribedAll: boolean;
  quietStartHour: number;
  quietEndHour: number;
}
export interface DemoEmail {
  to: string;
  subject: string;
  text: string;
  kind: string;
  at: string;
}

export interface McpToken {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const api = {
  // SCRUM — `api.turn` (non-streaming) and its /api/chat/turn route were
  // removed in SCRUM-43. The wrapper lingered in the client SDK and was
  // a loaded gun for any new caller. Use `turnStream` instead.
  turnStream,
  sessions: {
    list: (opts: { before?: string; limit?: number } = {}) => {
      const params = new URLSearchParams();
      if (opts.before !== undefined) params.set('before', opts.before);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      const qs = params.toString();
      const path = qs.length > 0 ? `/api/sessions?${qs}` : '/api/sessions';
      return call<{ sessions: SessionSummary[]; hasMore: boolean }>(path);
    },
    search: (opts: { q: string; before?: string; limit?: number }) => {
      const params = new URLSearchParams({ q: opts.q });
      if (opts.before !== undefined) params.set('before', opts.before);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      return call<{ sessions: SessionSummary[]; hasMore: boolean }>(
        `/api/sessions/search?${params.toString()}`,
      );
    },
    // SCRUM (PR 5) — encode the session id so a stray `/` or whitespace
    // can't change the URL shape (handler-side UUID guard backs this up).
    get: (id: string) => call<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`),
    del: (id: string) =>
      call<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  brief: {
    get: () => call<LeaderBrief>('/api/brief'),
    setFields: (fields: Partial<Record<keyof ProfileFields, string>>) =>
      call<LeaderBrief>('/api/brief/fields', { method: 'PATCH', body: fields }),
    addLine: (doc: BriefDoc, text: string) =>
      call<LeaderBrief>('/api/brief/lines', { method: 'POST', body: { doc, text } }),
    editLine: (id: string, text: string) =>
      call<LeaderBrief>(`/api/brief/lines/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { text },
      }),
    deleteLine: (id: string) =>
      call<LeaderBrief>(`/api/brief/lines/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    deleteAll: () => call<{ ok: true }>('/api/brief', { method: 'DELETE' }),
  },
  demo: {
    runJobs: () => call<{ ran: number }>('/api/demo/run-jobs', { method: 'POST' }),
    outbox: () => call<{ emails: DemoEmail[] }>('/api/demo/outbox'),
  },
  moments: {
    list: () => call<{ moments: Moment[] }>('/api/moments'),
    create: (body: { what: string; withWhom?: string; happensAt?: string | null }) =>
      call<Moment>('/api/moments', { method: 'POST', body }),
    update: (id: string, body: { happensAt?: string | null; status?: 'upcoming' | 'dismissed' }) =>
      call<Moment>(`/api/moments/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    del: (id: string) =>
      call<{ ok: true }>(`/api/moments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    reflect: (
      id: string,
      body: {
        howItWent: HowItWent;
        differently?: string;
        confidenceBefore?: number;
        confidenceAfter?: number;
      },
    ) => call<Moment>(`/api/moments/${encodeURIComponent(id)}/outcome`, { method: 'POST', body }),
  },
  mcp: {
    list: () => call<{ allowed: boolean; tokens: McpToken[] }>('/api/mcp/tokens'),
    create: (label: string) =>
      call<{ id: string; token: string; serverUrl: string }>('/api/mcp/tokens', {
        method: 'POST',
        body: { label },
      }),
    revoke: (id: string) =>
      call<{ ok: true }>(`/api/mcp/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  rateTurn: (turnId: string, rating: 'helpful' | 'not_helpful', note?: string) =>
    call<{ ok: true }>(`/api/turns/${encodeURIComponent(turnId)}/rating`, {
      method: 'POST',
      body: { rating, ...(note !== undefined ? { note } : {}) },
    }),
  preferences: {
    get: () => call<Prefs>('/api/preferences'),
    patch: (body: Partial<Pick<Prefs, 'followupEmailOptIn' | 'weeklyNudgeOptIn'>>) =>
      call<Prefs>('/api/preferences', { method: 'PATCH', body }),
  },
  profile: {
    get: () => call<MeResponse>('/api/profile'),
    patch: (body: ProfilePatchBody) =>
      call<{ ok: true }>('/api/profile', { method: 'PATCH', body }),
    del: () => call<{ ok: true }>('/api/profile', { method: 'DELETE' }),
  },
};
