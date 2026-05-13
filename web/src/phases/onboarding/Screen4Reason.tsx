import { EnterHint, Eyebrow, Option } from '../../components/Primitives';
import { REASONS, type Reason } from './data';

interface Props {
  value: string | null;
  onPick: (i: number, r: Reason) => void;
  confirming: boolean;
  confirmingIndex: number | null;
}

export function Screen4Reason({ value, onPick, confirming, confirmingIndex }: Props) {
  return (
    <>
      <Eyebrow n={4} total={7} />
      <h1 className="q-headline">What brings you here today?</h1>
      <p className="q-helper">We'll point you in the right direction next.</p>
      <div className="option-list">
        {REASONS.map((r, i) => (
          <Option
            key={r.label}
            index={i}
            selected={value === r.label}
            confirming={confirming && confirmingIndex === i}
            onPick={() => onPick(i, r)}
          >
            {r.label}
          </Option>
        ))}
      </div>
      <div className="branch-tag">
        <span className="dot" />
        <span>This shapes where you land next — not which questions you'll see.</span>
      </div>
      <div className="screen-footer">
        <EnterHint label="continue" />
      </div>
    </>
  );
}
