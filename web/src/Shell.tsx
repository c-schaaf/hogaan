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
import { supabase } from './lib/supabase';
import { Chat } from './phases/Chat';
import { EmailVerify } from './phases/EmailVerify';
import { Forgot } from './phases/Forgot';
import { Home } from './phases/Home';
import { Login } from './phases/Login';
import { Onboarding, type OnboardingAnswers } from './phases/Onboarding';
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

export function Shell() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [verifyMode, setVerifyMode] = useState<'signup' | 'login'>('signup');
  const [pendingEmail, setPendingEmail] = useState<{ name?: string; email: string } | null>(null);
  const [chatSeed, setChatSeed] = useState<string | null>(null);
  const initialUrl = useRef(new URL(window.location.href));
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (AUTHED_PHASES.has(phase)) sessionStorage.setItem('shell-phase', phase);
  }, [phase]);

  const routeAuthed = useCallback(async () => {
    try {
      console.log('[shell] routeAuthed: fetching /api/profile');
      const p = await api.profile.get();
      console.log('[shell] /api/profile returned', { onboarded: p.onboarded, email: p.email });
      setMe(p);
      // Recovery flow: ?reset=1 lands here in a signed-in session because
      // Supabase signs the user in to apply the new password. Route to Reset.
      if (initialUrl.current.searchParams.get('reset') === '1') {
        console.log('[shell] routing to reset (URL had ?reset=1)');
        setPhase('reset');
        return;
      }
      const stored = sessionStorage.getItem('shell-phase') as Phase | null;
      const next: Phase = p.onboarded
        ? (stored !== null && AUTHED_PHASES.has(stored) ? stored : 'home')
        : 'onboarding';
      console.log('[shell] routing to', next);
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
    }
  }, []);

  // Boot: read session, route once, then subscribe to changes.
  useEffect(() => {
    // Supabase redirects back with ?error=...&error_code=... on failed
    // magic-link clicks (expired, invalid, etc). Show a banner on the
    // login screen instead of silently landing on signup.
    const urlErr = readAuthErrorFromUrl();
    if (urlErr !== null) {
      console.log('[shell] URL error param detected', urlErr);
      const msg =
        urlErr.code === 'otp_expired'
          ? 'That sign-in link expired. Sign in with your password below.'
          : urlErr.description || 'That sign-in link did not work.';
      setLinkError(msg);
      const clean = new URL(window.location.href);
      clean.search = '';
      clean.hash = '';
      window.history.replaceState({}, '', clean.toString());
    }

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session === null) {
        setMe(null);
        // Default unauthed landing = login. Signup is reachable via the
        // "Create an account" link.
        setPhase('login');
        return;
      }
      await routeAuthed();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[shell] auth event:', event, 'session?', !!session);
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
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        void routeAuthed();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [routeAuthed]);

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
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setMe(null);
    setPhase('login');
  };

  const handleOnboardingComplete = async (answers: OnboardingAnswers) => {
    try {
      await api.profile.patch({
        fullName: answers.name || me?.fullName || '',
        mappedPractices: answers.practices,
        finishOnboarding: true,
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
      body = (
        <Reset onSuccess={() => void routeAuthed()} goForgot={() => setPhase('forgot')} />
      );
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
            setPhase('chat');
          }}
          onNav={onNav}
        />
      );
      break;
    case 'sessions':
      body = <Sessions onBack={() => setPhase('home')} onOpen={() => setPhase('chat')} onNav={onNav} />;
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
          onBack={() => setPhase('home')}
        />
      );
      break;
    default:
      body = <div>Unknown phase</div>;
  }

  return (
    <div className="stage" data-bg="tinted">
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
