import { useState } from 'react';
import { IconEnvelope, IconSpinner } from '../components/Icons';
import { supabase } from '../lib/supabase';
import { AuthCard, FloatingField } from './auth/AuthShell';

interface Props {
  prefill?: { email?: string };
  goLogin: () => void;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Forgot({ prefill = {}, goLogin }: Props) {
  const [email, setEmail] = useState(prefill.email ?? '');
  const [errs, setErrs] = useState<{ email?: string }>({});
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const e: typeof errs = {};
    if (!EMAIL.test(email)) e.email = "That email doesn't look right.";
    setErrs(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/?reset=1`,
    });
    // We don't surface Supabase errors here - enumeration defence: same
    // confirmation regardless of whether the email matched.
    setLoading(false);
    setSent(true);
  };

  if (sent) {
    return (
      <AuthCard back={goLogin}>
        <div className="auth-glyph">
          <IconEnvelope />
        </div>
        <h1 className="auth-h">Check your inbox.</h1>
        <p className="auth-sub">
          If an account exists for <strong className="auth-strong">{email}</strong>, we sent a reset
          link. It expires in 60 minutes.
        </p>
        <div className="auth-form">
          <div className="auth-row">
            <button type="button" className="auth-link" onClick={() => setSent(false)}>
              Resend
            </button>
            <span className="auth-row-sep" />
            <button type="button" className="auth-link muted" onClick={goLogin}>
              ← Back to sign in
            </button>
          </div>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard back={goLogin}>
      <h1 className="auth-h">Reset your password.</h1>
      <p className="auth-sub">
        Enter the email you signed up with. We'll send you a link to set a new one.
      </p>
      <div className="auth-form">
        <FloatingField
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          autoComplete="email"
          autoFocus
          error={errs.email}
          onSubmit={submit}
          name="email"
        />
        <button className="auth-cta" onClick={submit} disabled={loading}>
          {loading ? (
            <>
              <IconSpinner /> Sending link…
            </>
          ) : (
            'Send reset link'
          )}
        </button>
      </div>
    </AuthCard>
  );
}
