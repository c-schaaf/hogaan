import { Arrow, CheckGlyph, Eyebrow } from '../../components/Primitives';
import { PRACTICES, PRACTICE_GROUPS } from './data';

interface Props {
  values: string[];
  onToggle: (name: string) => void;
  onContinue: () => void;
}

// Deferred onboarding edit: no cap on selections. Pick 1-12.
export function Screen5Practices({ values, onToggle, onContinue }: Props) {
  const count = values.length;
  const canContinue = count >= 1;

  return (
    <>
      <Eyebrow n={3} total={3} />
      <h1 className="q-headline">Which of these practices do you want to develop?</h1>
      <p className="q-helper">Pick as many as you'd like — you can change them anytime.</p>

      {PRACTICE_GROUPS.map((g) => (
        <div key={g} className="practice-group">
          <div className="practice-label">{g}</div>
          <div className="practice-grid">
            {PRACTICES.filter((p) => p.group === g).map((p) => {
              const sel = values.includes(p.name);
              return (
                <button
                  key={p.name}
                  type="button"
                  className={['practice', sel ? 'selected' : ''].filter(Boolean).join(' ')}
                  onClick={() => onToggle(p.name)}
                >
                  <span className="practice-name">{p.name}</span>
                  <span className="practice-gloss">{p.gloss}</span>
                  <span className="practice-check">
                    <CheckGlyph size={11} stroke={2.8} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="practice-count">
        <span>
          <strong style={{ color: 'var(--ink-1)', fontWeight: 600 }}>{count}</strong> selected
        </span>
      </div>

      <div className="screen-footer">
        <button type="button" className="cta" disabled={!canContinue} onClick={onContinue}>
          Continue <Arrow />
        </button>
      </div>
    </>
  );
}
