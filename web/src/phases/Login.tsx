import { useState } from 'react';
import { IconSpinner } from '../components/Icons';
import { humanizeAuthError } from '../lib/auth-errors';
import { supabase } from '../lib/supabase';
import { AuthCard, FloatingField, PasswordField } from './auth/AuthShell';

interface Props {
  prefill?: { email?: string };
  /**
   * Fired after a successful sign-in. The supabase-js session is already
   * persisted at this point; Shell's onAuthStateChange listener will
   * route the user to /home or /onboarding based on profile state.
   */
  onSignedIn: () => void;
  goSignup: () => void;
  goForgot: () => void;
  /** Banner shown when the user lands here after an expired magic link. */
  banner?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Login({ prefill = {}, onSignedIn, goSignup, goForgot, banner }: Props) {
  const [email, setEmail] = useState(prefill.email ?? '');
  const [pw, setPw] = useState('');
  const [errs, setErrs] = useState<{ email?: string; pw?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const e: typeof errs = {};
    if (!EMAIL.test(email)) e.email = "That email doesn't look right.";
    if (pw.length === 0) e.pw = 'Enter your password.';
    setErrs(e);
    if (Object.keys(e).length) return;

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: pw,
    });
    setLoading(false);
    if (error) {
      const lower = (error.message ?? '').toLowerCase();
      // Most common: wrong password OR unconfirmed email.
      if (lower.includes('invalid login credentials')) {
        setErrs({ form: "Email or password didn't match. Try again, or use 'Forgot password.'" });
        return;
      }
      if (lower.includes('not confirmed') || lower.includes('confirm')) {
        setErrs({
          form: "You haven't confirmed your email yet. Check your inbox for the confirmation link, or sign up again to resend it.",
        });
        return;
      }
      setErrs({ form: humanizeAuthError(error) });
      return;
    }
    // Session is set; Shell's onAuthStateChange will pick it up and route.
    onSignedIn();
  };

  return (
    <AuthCard>
      <h1 className="auth-h">Welcome back.</h1>
      <p className="auth-sub">Sign in with your email and password.</p>

      <div className="auth-form">
        {banner && <div className="auth-form-error">{banner}</div>}

        <FloatingField
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          autoComplete="email"
          autoFocus
          error={errs.email}
          name="email"
        />
        <PasswordField
          label="Password"
          value={pw}
          onChange={setPw}
          autoComplete="current-password"
          error={errs.pw}
          onSubmit={submit}
        />

        {errs.form && <div className="auth-form-error">{errs.form}</div>}

        <button className="auth-cta" onClick={submit} disabled={loading}>
          {loading ? (
            <>
              <IconSpinner /> Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </button>

        <div className="auth-row">
          <button type="button" className="auth-link muted" onClick={goForgot}>
            Forgot your password?
          </button>
        </div>

        <p className="auth-alt">
          New to Hogaan?{' '}
          <button type="button" className="auth-link" onClick={goSignup}>
            Create an account
          </button>
        </p>
      </div>
    </AuthCard>
  );
}
