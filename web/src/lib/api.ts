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
  commStyle: 'direct' | 'warm' | null;
  responseDepth: 'quick' | 'standard' | 'deep' | null;
}

export interface ChatTurnRequest {
  message: string;
  sessionId?: string;
  private?: boolean;
}

export interface ChatTurnResponse {
  responseText: string;
  sessionId: string;
  turnId: string | null;
  crisis: boolean;
  endEvent: string;
}

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
  }[];
}

export interface ProfilePatchBody {
  fullName?: string;
  mappedPractices?: string[];
  commStyle?: 'direct' | 'warm';
  responseDepth?: 'quick' | 'standard' | 'deep';
  finishOnboarding?: boolean;
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
  | { type: 'error'; message: string };

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
    throw new ApiError(resp.status, `stream open failed: ${resp.status}`);
  }

  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
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

export const api = {
  turn: (body: ChatTurnRequest) =>
    call<ChatTurnResponse>('/api/chat/turn', { method: 'POST', body }),
  turnStream,
  sessions: {
    list: () => call<{ sessions: SessionSummary[] }>('/api/sessions'),
    get: (id: string) => call<SessionDetail>(`/api/sessions/${id}`),
    del: (id: string) =>
      call<{ ok: true }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  },
  profile: {
    get: () => call<MeResponse>('/api/profile'),
    patch: (body: ProfilePatchBody) =>
      call<{ ok: true }>('/api/profile', { method: 'PATCH', body }),
    del: () => call<{ ok: true }>('/api/profile', { method: 'DELETE' }),
  },
};
