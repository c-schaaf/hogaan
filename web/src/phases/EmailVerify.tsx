import { useEffect, useState } from 'react';
import { IconCheck, IconEnvelope } from '../components/Icons';
import { supabase } from '../lib/supabase';
import { AuthCard } from './auth/AuthShell';

interface Props {
  email: string;
  name?: string;
  mode?: 'signup' | 'login';
  onContinue: () => void;
  goSignup: () => void;
}

export function EmailVerify({ email, mode = 'signup', onContinue, goSignup }: Props) {
  const isLogin = mode === 'login';
  const [resent, setResent] = useState(false);
  const [counter, setCounter] = useState(0);

  const onResend = async () => {
    if (counter > 0) return;
    setResent(true);
    setCounter(30);
    if (isLogin) {
      await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: false,
        },
      });
    } else {
      await supabase.auth.resend({ type: 'signup', email });
    }
    setTimeout(() => setResent(false), 2600);
  };

  useEffect(() => {
    if (counter <= 0) return;
    const t = setTimeout(() => setCounter((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [counter]);

  return (
    <AuthCard>
      <div className="auth-glyph">
        <IconEnvelope size={28} />
      </div>
      <h1 className="auth-h">Check your inbox.</h1>
      <p className="auth-sub">
        {isLogin ? (
          <>
            We sent a one-tap sign-in link to{' '}
            <strong className="auth-strong">{email || 'your email'}</strong>. Open it on this device
            and you're in.
          </>
        ) : (
          <>
            We sent a confirmation link to <strong className="auth-strong">{email || 'your email'}</strong>.
            Click it to verify your account and start onboarding.
          </>
        )}
      </p>

      <div className="auth-form">
        <button className="auth-cta" onClick={onContinue}>
          {isLogin ? 'I clicked the link — take me in' : "I've verified — continue"}
        </button>
        <div className="auth-help-row">
          <span>Link expires in 60 minutes. Don't see it? Check spam, or </span>
          <button type="button" className="auth-link" onClick={() => void onResend()} disabled={counter > 0}>
            {counter > 0 ? `resend (${counter}s)` : 'resend'}
          </button>
          <span>.</span>
        </div>
        {resent && (
          <div className="auth-toast-inline">
            <IconCheck /> Sent — check your inbox.
          </div>
        )}
        <div className="auth-row">
          <button type="button" className="auth-link muted" onClick={goSignup}>
            Use a different email
          </button>
        </div>
      </div>
      <div className="auth-foot-legal">
        Trouble? Email <a href="mailto:hamse24@gmail.com">hamse24@gmail.com</a>
      </div>
    </AuthCard>
  );
}
