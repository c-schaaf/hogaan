import { useEffect, useRef, useState } from 'react';
import { Arrow, Eyebrow } from '../../components/Primitives';

const TOTAL = 7;

interface Props {
  value: string;
  onChange: (v: string) => void;
  onContinue: () => void;
}

export function Screen1Name({ value, onChange, onContinue }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = () => {
    if (!value.trim()) {
      setError(true);
      return;
    }
    onContinue();
  };

  return (
    <>
      <Eyebrow n={1} total={TOTAL} />
      <h1 className="q-headline">What should we call you?</h1>
      <p className="q-helper">Just your first name is fine.</p>
      <input
        ref={ref}
        className={`text-input ${error ? 'error' : ''}`}
        type="text"
        value={value}
        onChange={(e) => {
          setError(false);
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Type your name…"
        autoComplete="given-name"
        spellCheck={false}
      />
      {error && <div className="field-error">We'd love to know what to call you.</div>}
      <div className="screen-footer">
        <button type="button" className="cta" onClick={submit}>
          Continue <Arrow />
        </button>
        <div className="enter-hint">
          <span>Press</span>
          <kbd>Enter</kbd>
          <span>to continue</span>
        </div>
      </div>
    </>
  );
}
