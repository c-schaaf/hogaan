// Shared layout for all auth screens (Signup / Login / Forgot / Reset / Verify).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HogaanWordmark } from '../../components/HogaanWordmark';
import { IconBack, IconEye } from '../../components/Icons';
import { TWELVE_PRACTICES } from '../onboarding/data';

export function AuthBrand() {
  return (
    <aside className="auth-brand" aria-hidden="true">
      <div className="auth-brand-inner">
        <p className="auth-brand-quote">
          <span className="auth-brand-mark">“</span>
          Unlock Your Transformational Leadership Potential.
          <span className="auth-brand-mark close">”</span>
        </p>
        <div className="auth-brand-12grid">
          {TWELVE_PRACTICES.map((g) => (
            <div key={g.level} className="auth-brand-12row">
              <div className="auth-brand-12level">{g.level}</div>
              <div className="auth-brand-12items">
                {g.items.map((p) => (
                  <span key={p}>{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function MobileTag() {
  return (
    <div className="auth-mobile-tag" aria-hidden="true">
      <p className="auth-mobile-tag-quote">
        <span className="auth-mobile-tag-mark">“</span>
        Unlock Your Transformational Leadership Potential.
        <span className="auth-mobile-tag-mark">”</span>
      </p>
    </div>
  );
}

interface AuthCardProps {
  children: ReactNode;
  back?: () => void;
}

export function AuthCard({ children, back }: AuthCardProps) {
  return (
    <div className="auth-page">
      <div className="auth-shell">
        <div className="auth-bar">
          {back ? (
            <button className="auth-back" type="button" onClick={back}>
              <IconBack />
              <span>Back to sign in</span>
            </button>
          ) : (
            <span />
          )}
          <HogaanWordmark small />
          <span />
        </div>
        <MobileTag />
        <div className="auth-card">{children}</div>
      </div>
      <AuthBrand />
    </div>
  );
}

// Floating-label field
interface FloatingFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  error?: string;
  suffix?: ReactNode;
  onSubmit?: () => void;
  name?: string;
}

export function FloatingField({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  autoFocus,
  error,
  suffix,
  onSubmit,
  name,
}: FloatingFieldProps) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const filled = !!value;
  return (
    <div
      className={`ff ${error ? 'has-error' : ''} ${focused ? 'is-focused' : ''} ${
        filled ? 'is-filled' : ''
      }`}
    >
      <div className="ff-wrap">
        <label className="ff-label">{label}</label>
        <input
          ref={ref}
          className="ff-input"
          type={type}
          value={value}
          name={name}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        {suffix && <div className="ff-suffix">{suffix}</div>}
      </div>
      {error && <div className="ff-error">{error}</div>}
    </div>
  );
}

function pwStrength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(3, Math.max(0, Math.floor(s * 0.75)));
}

function StrengthMeter({ value }: { value: number }) {
  const labels = ['', 'Weak', 'Okay', 'Strong'];
  return (
    <div className="pwm">
      <div className="pwm-bars">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`pwm-bar ${i < value ? 'on' : ''} l${value}`} />
        ))}
      </div>
      {value > 0 && <span className={`pwm-label l${value}`}>{labels[value]}</span>}
    </div>
  );
}

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  error?: string;
  showStrength?: boolean;
  onSubmit?: () => void;
  autoFocus?: boolean;
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  error,
  showStrength,
  onSubmit,
  autoFocus,
}: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <>
      <FloatingField
        label={label}
        value={value}
        onChange={onChange}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete ?? 'new-password'}
        autoFocus={autoFocus}
        error={error}
        onSubmit={onSubmit}
        suffix={
          <button
            type="button"
            className="ff-eye"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            <IconEye open={show} />
          </button>
        }
      />
      {showStrength && <StrengthMeter value={pwStrength(value)} />}
    </>
  );
}
