import { useState } from 'react';
import { IconCheck, IconSpinner } from '../components/Icons';
import { humanizeAuthError } from '../lib/auth-errors';
import { supabase } from '../lib/supabase';
import { AuthCard, FloatingField, PasswordField } from './auth/AuthShell';

interface Props {
  prefill?: { name?: string; email?: string };
  goVerify: (args: { name: string; email: string }) => void;
  goLogin: () => void;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Signup({ prefill = {}, goVerify, goLogin }: Props) {
  const [name, setName] = useState(prefill.name ?? '');
  const [email, setEmail] = useState(prefill.email ?? '');
  const [pw, setPw] = useState('');
  const [errs, setErrs] = useState<{ name?: string; email?: string; pw?: string }>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const validate = () => {
    const e: typeof errs = {};
    if (!name.trim()) e.name = 'What should we call you?';
    if (!EMAIL.test(email)) e.email = "That email doesn't look right.";
    if (pw.length < 6) e.pw = 'Use 6 or more characters.';
    return e;
  };

  const submit = async () => {
    setFormError(null);
    const e = validate();
    setErrs(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password: pw,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: `${window.location.origin}/?onboarding=1`,
      },
    });
    setLoading(false);
    if (error) {
      const friendly = humanizeAuthError(error);
      const lower = (error.message ?? '').toLowerCase();
      if (lower.includes('already registered') || lower.includes('user already')) {
        setErrs({ email: friendly });
        return;
      }
      if (lower.includes('password')) {
        setErrs({ pw: friendly });
        return;
      }
      // Rate-limit / network / unknown - surface as a form-level banner so
      // it's not hidden inside a single field's error slot.
      setFormError(friendly);
      return;
    }
    setDone(true);
    setTimeout(() => goVerify({ name, email }), 420);
  };

  return (
    <AuthCard>
      <h1 className="auth-h">Welcome to Hogaan.</h1>
      <p className="auth-sub">Create an account. We'll have you in a conversation in 90 seconds.</p>

      <div className="auth-form">
        <FloatingField
          label="Full name"
          value={name}
          onChange={setName}
          autoComplete="name"
          autoFocus
          error={errs.name}
          name="name"
        />
        <FloatingField
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          autoComplete="email"
          error={errs.email}
          name="email"
        />
        <PasswordField
          label="Password"
          value={pw}
          onChange={setPw}
          autoComplete="new-password"
          error={errs.pw}
          showStrength
          onSubmit={submit}
        />
        {formError && <div className="auth-form-error">{formError}</div>}
        <button className="auth-cta" onClick={submit} disabled={loading || done}>
          {done ? (
            <>
              <IconCheck /> Confirmation link sent
            </>
          ) : loading ? (
            <>
              <IconSpinner /> Setting up your account…
            </>
          ) : (
            'Create my account'
          )}
        </button>
        <p className="auth-alt">
          Already have an account?{' '}
          <button type="button" className="auth-link" onClick={goLogin}>
            Sign in
          </button>
        </p>
      </div>
      <div className="auth-foot-legal">
        By signing up you agree to our{' '}
        <a href="#" onClick={(e) => e.preventDefault()}>
          Terms
        </a>{' '}
        and{' '}
        <a href="#" onClick={(e) => e.preventDefault()}>
          Privacy Policy
        </a>
        .
      </div>
    </AuthCard>
  );
}
