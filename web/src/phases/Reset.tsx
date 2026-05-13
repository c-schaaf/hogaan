import { useState } from 'react';
import { IconBack, IconCheck, IconSpinner } from '../components/Icons';
import { supabase } from '../lib/supabase';
import { AuthCard, PasswordField } from './auth/AuthShell';

interface Props {
  linkState?: 'valid' | 'expired' | 'invalid';
  onSuccess: () => void;
  goForgot: () => void;
}

export function Reset({ linkState = 'valid', onSuccess, goForgot }: Props) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errs, setErrs] = useState<{ pw?: string; confirm?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (linkState === 'expired' || linkState === 'invalid') {
    const expired = linkState === 'expired';
    return (
      <AuthCard>
        <div className="auth-glyph warn">
          <IconBack />
        </div>
        <h1 className="auth-h">
          {expired ? 'This reset link expired.' : "This link isn't valid anymore."}
        </h1>
        <p className="auth-sub">
          {expired
            ? 'Reset links last 60 minutes. Send a new one to keep going.'
            : "It may have been used, replaced, or wasn't recognised."}
        </p>
        <div className="auth-form">
          <button className="auth-cta" onClick={goForgot}>
            {expired ? 'Send a new one' : 'Try again'}
          </button>
        </div>
      </AuthCard>
    );
  }

  const submit = async () => {
    const e: typeof errs = {};
    if (pw.length < 6) e.pw = 'Use 6 or more characters.';
    if (confirm && confirm !== pw) e.confirm = 'Mismatched.';
    setErrs(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setLoading(false);
    if (error) {
      setErrs({ form: error.message });
      return;
    }
    setDone(true);
    setTimeout(() => onSuccess(), 480);
  };

  return (
    <AuthCard>
      <h1 className="auth-h">Set a new password.</h1>
      <p className="auth-sub">
        Pick something strong — you won't need to remember it often if you use a password manager.
      </p>

      <div className="auth-form">
        <PasswordField
          label="New password"
          value={pw}
          onChange={setPw}
          autoComplete="new-password"
          error={errs.pw}
          showStrength
          autoFocus
        />
        <PasswordField
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          error={errs.confirm}
          onSubmit={submit}
        />
        {errs.form && <div className="auth-form-error">{errs.form}</div>}

        <button className="auth-cta" onClick={submit} disabled={loading || done}>
          {done ? (
            <>
              <IconCheck /> Updated
            </>
          ) : loading ? (
            <>
              <IconSpinner /> Updating…
            </>
          ) : (
            'Update password and sign in'
          )}
        </button>
      </div>
    </AuthCard>
  );
}
