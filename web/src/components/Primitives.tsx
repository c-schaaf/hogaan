// Shared primitives used across onboarding screens.

export function CheckGlyph({ size = 14, stroke = 2.4 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M3.2 8.4l3.1 3 6.5-6.8"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Arrow({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BackChevron({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Eyebrow({ n, total }: { n: number; total: number }) {
  return (
    <div className="q-eyebrow">
      <span className="num">{String(n).padStart(2, '0')}</span>
      <span>·</span>
      <span>
        Step {n} of {total}
      </span>
    </div>
  );
}

export function EnterHint({ label = 'continue' }: { label?: string }) {
  return (
    <div className="enter-hint">
      <span className="pulse-dot" />
      <span>Press</span>
      <kbd>Enter</kbd>
      <span>to {label}</span>
    </div>
  );
}

interface OptionProps {
  index: number;
  selected: boolean;
  confirming: boolean;
  onPick: () => void;
  children: React.ReactNode;
  gloss?: string;
  badge?: string | null;
  withKey?: boolean;
}

export function Option({
  index,
  selected,
  confirming,
  onPick,
  children,
  gloss,
  badge,
  withKey = true,
}: OptionProps) {
  const keyLabel = withKey
    ? index < 9
      ? String(index + 1)
      : index === 9
        ? '0'
        : String.fromCharCode(65 + index - 10)
    : null;
  return (
    <button
      type="button"
      className={[
        'option',
        withKey ? 'has-key' : '',
        selected ? 'selected' : '',
        confirming ? 'confirming' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onPick}
    >
      {withKey && <span className="key">{keyLabel}</span>}
      <span>{children}</span>
      {badge && <span className="badge-rec">{badge}</span>}
      {gloss && <span className="gloss">{gloss}</span>}
      <span className="check">
        <CheckGlyph />
      </span>
    </button>
  );
}
