import { useEffect, useState } from 'react';
import { IconCheck, IconEnvelope } from '../components/Icons';
import { humanizeAuthError } from '../lib/auth-errors';
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
  const [resendError, setResendError] = useState<string | null>(null);
  const [counter, setCounter] = useState(0);

  const onResend = async () => {
    if (counter > 0) return;
    setResendError(null);
    setCounter(30);
    // SCRUM — pre-fix, this awaited the supabase call but never inspected
    // the `{ error }` field, so a quota / network / template failure still
    // flashed "Sent — check your inbox." The user thought the link was
    // coming and the support inbox filled up with "I never got the email"
    // complaints. Capture the error and surface it via humanizeAuthError;
    // only show the success toast when Supabase actually accepted the
    // request.
    const { error } = isLogin
      ? await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: window.location.origin,
            shouldCreateUser: false,
          },
        })
      : await supabase.auth.resend({ type: 'signup', email });
    if (error) {
      setResendError(humanizeAuthError(error));
      // Reset the countdown so the user can try again immediately rather
      // than waiting 30s on a failure they didn't cause.
      setCounter(0);
      return;
    }
    setResent(true);
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
            We sent a confirmation link to{' '}
            <strong className="auth-strong">{email || 'your email'}</strong>. Click it to verify
            your account and start onboarding.
          </>
        )}
      </p>

      <div className="auth-form">
        <button className="auth-cta" onClick={onContinue}>
          {isLogin ? 'I clicked the link — take me in' : "I've verified — continue"}
        </button>
        <div className="auth-help-row">
          <span>Link expires in 60 minutes. Don't see it? Check spam, or </span>
          <button
            type="button"
            className="auth-link"
            onClick={() => void onResend()}
            disabled={counter > 0}
          >
            {counter > 0 ? `resend (${counter}s)` : 'resend'}
          </button>
          <span>.</span>
        </div>
        {resent && (
          <div className="auth-toast-inline">
            <IconCheck /> Sent — check your inbox.
          </div>
        )}
        {resendError !== null && <div className="auth-form-error">{resendError}</div>}
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
