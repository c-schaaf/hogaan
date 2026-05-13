import { Arrow, CheckGlyph } from '../../components/Primitives';

interface Props {
  checked: boolean;
  onToggle: () => void;
  onStart: () => void;
  starting: boolean;
}

export function ScreenConsent({ checked, onToggle, onStart, starting }: Props) {
  return (
    <>
      <div className="q-eyebrow">
        <span>Almost there</span>
      </div>
      <h1 className="q-headline">Two quick things before we start.</h1>

      <div style={{ marginTop: 8 }}>
        <div className="disclosure">
          <div className="glyph">
            <svg viewBox="0 0 24 24" fill="none">
              <rect x="4" y="6" width="16" height="13" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 3v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="9" cy="12" r="1.2" fill="currentColor" />
              <circle cx="15" cy="12" r="1.2" fill="currentColor" />
              <path d="M9 16h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="disclosure-title">I'm an AI, not a therapist.</div>
            <p className="disclosure-body">
              For crises, I'll point you to specific resources — quickly, not gently.
            </p>
          </div>
        </div>

        <div className="disclosure">
          <div className="glyph">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M14 4l-1 8h6l-7 8 1-7H7l7-9z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className="disclosure-title">You can leave anytime.</div>
            <p className="disclosure-body">
              Delete your account at any time from Profile. Your data leaves with you.
            </p>
          </div>
        </div>
      </div>

      <div
        className={`checkbox-row ${checked ? 'on' : ''}`}
        onClick={onToggle}
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="checkbox">
          <CheckGlyph />
        </span>
        <span className="checkbox-label">I'm good with these — let's begin.</span>
      </div>

      <div className="screen-footer">
        <button type="button" className="cta" disabled={!checked || starting} onClick={onStart}>
          {starting ? 'Starting…' : 'Start coaching'} {!starting && <Arrow />}
        </button>
      </div>
    </>
  );
}
