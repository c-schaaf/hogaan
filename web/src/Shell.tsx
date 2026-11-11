// Top-level phase orchestrator wired to Supabase Auth.
//
// On mount we read supabase.auth.getSession() (sync, from localStorage)
// and route accordingly. We also subscribe to onAuthStateChange so a
// magic-link click that lands in the same tab updates the UI without a
// hard refresh.
//
// When the user is authed we fetch /api/profile - that endpoint's
// middleware JIT-creates our public.users row keyed by supabase_user_id
// so subsequent /api/* calls have a real userId.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Tab } from './components/Nav';
import { ApiError, api, type MeResponse } from './lib/api';
import { readAuthErrorFromUrl } from './lib/auth-errors';
import { devLog } from './lib/log';
import { isDemoMode } from './lib/demo';
import { supabase } from './lib/supabase';
import { Chat } from './phases/Chat';
import { EmailVerify } from './phases/EmailVerify';
import { Forgot } from './phases/Forgot';
import { Home } from './phases/Home';
import { Login } from './phases/Login';
import { Onboarding, type OnboardingAnswers } from './phases/Onboarding';
import { yearsToBand } from './phases/onboarding/data';
import { Profile } from './phases/Profile';
import { Reset } from './phases/Reset';
import { Sessions } from './phases/Sessions';
import { Signup } from './phases/Signup';

type Phase =
  | 'boot'
  | 'signup'
  | 'verify'
  | 'login'
  | 'forgot'
  | 'reset'
  | 'onboarding'
  | 'home'
  | 'chat'
  | 'sessions'
  | 'profile';

const AUTHED_PHASES = new Set<Phase>(['home', 'chat', 'sessions', 'profile']);

const URL_PATH_TO_PHASE: Partial<Record<string, Phase>> = {
  '/sessions': 'sessions',
  '/profile': 'profile',
};

// Phases that own their own URL path. Home/chat live at '/'.
const PHASE_TO_URL_PATH: Partial<Record<Phase, string>> = {
  sessions: '/sessions',
  profile: '/profile',
  home: '/',
  chat: '/',
};

function readPhaseFromUrl(): Phase | null {
  const path = window.location.pathname;
  const mapped = URL_PATH_TO_PHASE[path];
  return mapped ?? null;
}

export function Shell() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [verifyMode, setVerifyMode] = useState<'signup' | 'login'>('signup');
  const [pendingEmail, setPendingEmail] = useState<{ name?: string; email: string } | null>(null);
  const [chatSeed, setChatSeed] = useState<string | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const initialUrl = useRef(new URL(window.location.href));
  // SCRUM (PR B / launch-readiness 8e) — persist the magic-link error to
  // sessionStorage so a refresh on the login screen doesn't wipe the banner
  // and leave the user with no idea why they're on signup. Cleared explicitly
  // when the user dismisses (clicked the resend link, signed in, etc.).
  const [linkError, setLinkError] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('hogaan.linkError');
    } catch {
      return null;
    }
  });
  const lastAuthedTokenRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>('boot');
  const routeAuthedInFlight = useRef(false);
  const [chatOrigin, setChatOrigin] = useState<Phase>('home');

  useEffect(() => {
    phaseRef.current = phase;
    if (AUTHED_PHASES.has(phase)) {
      sessionStorage.setItem('shell-phase', phase);
      const desiredPath = PHASE_TO_URL_PATH[phase];
      if (desiredPath !== undefined && window.location.pathname !== desiredPath) {
        window.history.replaceState(
          {},
          '',
          desiredPath + window.location.search + window.location.hash,
        );
      }
    }
  }, [phase]);

  const routeAuthed = useCallback(async () => {
    if (routeAuthedInFlight.current) return;
    routeAuthedInFlight.current = true;
    try {
      devLog('[shell] routeAuthed: fetching /api/profile');
      const p = await api.profile.get();
      devLog('[shell] /api/profile returned', { onboarded: p.onboarded, email: p.email });
      setMe(p);
      // Recovery flow: ?reset=1 lands here in a signed-in session because
      // Supabase signs the user in to apply the new password. Route to Reset.
      if (initialUrl.current.searchParams.get('reset') === '1') {
        devLog('[shell] routing to reset (URL had ?reset=1)');
        setPhase('reset');
        return;
      }
      // URL is authoritative — read fresh on every routeAuthed call so a refresh
      // on /sessions or /profile lands the user back where they were. Fall back
      // to sessionStorage only when the URL is something we don't recognise.
      const urlPhase = readPhaseFromUrl();
      const stored = sessionStorage.getItem('shell-phase') as Phase | null;
      let next: Phase;
      if (!p.onboarded) {
        next = 'onboarding';
      } else if (urlPhase !== null && AUTHED_PHASES.has(urlPhase)) {
        next = urlPhase;
      } else if (stored !== null && AUTHED_PHASES.has(stored)) {
        next = stored;
      } else {
        next = 'home';
      }
      // SCRUM — if we're landing back in chat, rehydrate the active
      // session id so a mid-conversation refresh reopens the transcript.
      // Chat.tsx writes this on every sessionId change.
      if (next === 'chat') {
        const activeId = sessionStorage.getItem('hogaan.activeSessionId');
        if (activeId !== null && activeId.length > 0) {
          setOpenSessionId(activeId);
          setChatOrigin('home');
        }
      }
      devLog('[shell] routing to', next, '(urlPhase:', urlPhase, 'stored:', stored, ')');
      setPhase(next);
    } catch (err) {
      console.error('[shell] profile fetch failed', err);
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        setPhase('signup');
        return;
      }
      // Treat network/5xx as unauthed - user can retry.
      setMe(null);
      setPhase('signup');
    } finally {
      routeAuthedInFlight.current = false;
    }
  }, []);

  // Boot: subscribe to auth state changes. INITIAL_SESSION always fires
  // immediately on subscription with the current session (or null) — it is
  // the sole trigger for the initial route. Using a separate getSession()
  // IIFE alongside onAuthStateChange creates an unwinnable race: the IIFE's
  // await yields before lastAuthedTokenRef is stamped, so INITIAL_SESSION
  // bypasses dedup and routeAuthed() fires twice, always landing on Home.
  useEffect(() => {
    // Supabase redirects back with ?error=...&error_code=... on failed
    // magic-link clicks (expired, invalid, etc). Show a banner on the
    // login screen instead of silently landing on signup.
    const urlErr = readAuthErrorFromUrl();
    if (urlErr !== null) {
      devLog('[shell] URL error param detected', urlErr);
      const msg =
        urlErr.code === 'otp_expired'
          ? 'That sign-in link expired. Sign in with your password below.'
          : urlErr.description || 'That sign-in link did not work.';
      setLinkError(msg);
      try {
        sessionStorage.setItem('hogaan.linkError', msg);
      } catch {
        /* sessionStorage unavailable — banner still visible until refresh */
      }
      const clean = new URL(window.location.href);
      clean.search = '';
      clean.hash = '';
      window.history.replaceState({}, '', clean.toString());
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      devLog('[shell] auth event:', event, 'session?', !!session);
      if (event === 'PASSWORD_RECOVERY') {
        setPhase('reset');
        return;
      }
      if (event === 'SIGNED_OUT' || session === null) {
        // Don't kick the user off a legitimate unauth page (login/signup/
        // forgot/reset/verify). Only force the redirect if they were on
        // an authed phase that needs a session.
        setMe(null);
        setPhase((current) =>
          current === 'login' ||
          current === 'signup' ||
          current === 'forgot' ||
          current === 'reset' ||
          current === 'verify'
            ? current
            : 'login',
        );
        return;
      }
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        const token = session?.access_token ?? null;
        if (token !== null && token === lastAuthedTokenRef.current) return;
        lastAuthedTokenRef.current = token;
        // SIGNED_IN fires for background token refreshes as well as genuine
        // sign-ins. Only route on genuine sign-ins (unauthed phase → authed).
        // If already on an authed page, or on forgot/reset, skip — re-routing
        // here causes an infinite loop (routeAuthed → getSession → SIGNED_IN).
        if (event === 'SIGNED_IN') {
          const cur = phaseRef.current;
          if (AUTHED_PHASES.has(cur) || cur === 'forgot' || cur === 'reset') return;
        }
        void routeAuthed();
      }
      // TOKEN_REFRESHED is intentionally not handled: a background token
      // renewal must never re-route a user who is already on a page.
    });
    return () => sub.subscription.unsubscribe();
  }, [routeAuthed]);

  // Browser back/forward: keep phase in sync with the URL the user navigated to.
  useEffect(() => {
    const onPopState = () => {
      const fromUrl = readPhaseFromUrl();
      if (fromUrl !== null && AUTHED_PHASES.has(fromUrl) && AUTHED_PHASES.has(phaseRef.current)) {
        setPhase(fromUrl);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const onNav = (tab: Tab) => setPhase(tab);

  const handleSignupSent = ({ name, email }: { name: string; email: string }) => {
    setVerifyMode('signup');
    setPendingEmail({ name, email });
    setPhase('verify');
  };

  const handleSignedIn = () => {
    // Session is set in localStorage by supabase-js. onAuthStateChange will
    // fire SIGNED_IN any moment - we don't need to route here, just clear
    // any stale error banner.
    setLinkError(null);
    try {
      sessionStorage.removeItem('hogaan.linkError');
    } catch {
      /* ignore */
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    // Clear cross-session state so a different user signing in on the
    // same browser doesn't inherit the previous user's active chat or
    // onboarding answers. (Shared-device privacy: User A's name + practice
    // selections must not pre-fill for User B.)
    sessionStorage.removeItem('hogaan.activeSessionId');
    sessionStorage.removeItem('shell-phase');
    sessionStorage.removeItem('hogaan.linkError');
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key !== null && (key.startsWith('hogaan_') || key.startsWith('hogaan.'))) {
          toRemove.push(key);
        }
      }
      for (const k of toRemove) localStorage.removeItem(k);
    } catch {
      /* localStorage unavailable — best-effort cleanup */
    }
    setMe(null);
    setPhase('login');
  };

  const handleOnboardingComplete = async (answers: OnboardingAnswers) => {
    try {
      // SCRUM — experienceBand was previously dropped. Map the YEARS label
      // the user picked to the canonical token before sending.
      const band = yearsToBand(answers.years);
      await api.profile.patch({
        fullName: answers.name || me?.fullName || '',
        mappedPractices: answers.practices,
        finishOnboarding: true,
        ...(band !== null ? { experienceBand: band } : {}),
      });
    } catch (err) {
      console.error('finish onboarding failed', err);
    }
    await routeAuthed();
  };

  if (phase === 'boot') {
    return (
      <div className="stage" data-bg="tinted">
        <div className="device">
          <div className="phase-stage">
            <div style={{ padding: 48, color: 'var(--ink-3)', fontFamily: 'var(--font-b)' }}>
              Loading…
            </div>
          </div>
        </div>
      </div>
    );
  }

  let body: JSX.Element;
  switch (phase) {
    case 'signup':
      body = (
        <Signup
          prefill={pendingEmail ?? undefined}
          goVerify={handleSignupSent}
          goLogin={() => setPhase('login')}
        />
      );
      break;
    case 'verify':
      body = (
        <EmailVerify
          email={pendingEmail?.email ?? 'your email'}
          name={pendingEmail?.name}
          mode={verifyMode}
          onContinue={() => void routeAuthed()}
          goSignup={() => setPhase(verifyMode === 'login' ? 'login' : 'signup')}
          goLogin={() => setPhase('login')}
        />
      );
      break;
    case 'login':
      body = (
        <Login
          prefill={pendingEmail ?? undefined}
          onSignedIn={handleSignedIn}
          goSignup={() => setPhase('signup')}
          goForgot={() => setPhase('forgot')}
          banner={linkError}
        />
      );
      break;
    case 'forgot':
      body = <Forgot prefill={pendingEmail ?? undefined} goLogin={() => setPhase('login')} />;
      break;
    case 'reset':
      body = <Reset onSuccess={() => void routeAuthed()} goForgot={() => setPhase('forgot')} />;
      break;
    case 'onboarding':
      body = (
        <Onboarding
          initialName={me?.fullName ?? pendingEmail?.name ?? ''}
          onComplete={handleOnboardingComplete}
        />
      );
      break;
    case 'home':
      body = (
        <Home
          user={{ name: firstName(me?.fullName ?? 'friend') }}
          practices={me?.mappedPractices ?? []}
          onCompose={(seed) => {
            setChatSeed(seed);
            setOpenSessionId(null);
            setChatOrigin('home');
            setPhase('chat');
          }}
          onNav={onNav}
        />
      );
      break;
    case 'sessions':
      body = (
        <Sessions
          onBack={() => setPhase('home')}
          onOpen={(id) => {
            setOpenSessionId(id);
            setChatSeed(null);
            setChatOrigin('sessions');
            setPhase('chat');
          }}
          onNav={onNav}
        />
      );
      break;
    case 'profile':
      body = (
        <Profile
          user={{ name: me?.fullName ?? '', email: me?.email ?? '' }}
          practices={me?.mappedPractices ?? []}
          onSignOut={() => void handleSignOut()}
          onNav={onNav}
        />
      );
      break;
    case 'chat':
      body = (
        <Chat
          practices={
            me?.mappedPractices && me.mappedPractices.length > 0
              ? me.mappedPractices
              : ['Integrity', 'Empathy', 'Peace']
          }
          seed={chatSeed}
          openSessionId={openSessionId}
          onOpenSession={(id) => {
            setChatSeed(null);
            setOpenSessionId(id);
          }}
          onBack={() => {
            setOpenSessionId(null);
            setPhase(chatOrigin);
          }}
        />
      );
      break;
    default:
      body = <div>Unknown phase</div>;
  }

  return (
    <div className="stage" data-bg="tinted">
      {isDemoMode && (
        <div className="demo-banner" role="note">
          Demo mode: you are the sample leader &ldquo;Amina&rdquo;. Nothing is saved after the demo
          stops.
        </div>
      )}
      <div className="device">
        <div className="phase-stage" key={phase}>
          {body}
        </div>
      </div>
    </div>
  );
}

function firstName(full: string): string {
  const trimmed = full.trim();
  if (trimmed === '') return 'friend';
  const space = trimmed.indexOf(' ');
  return space < 0 ? trimmed : trimmed.slice(0, space);
}
