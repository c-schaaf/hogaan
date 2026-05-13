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

export const api = {
  turn: (body: ChatTurnRequest) =>
    call<ChatTurnResponse>('/api/chat/turn', { method: 'POST', body }),
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
