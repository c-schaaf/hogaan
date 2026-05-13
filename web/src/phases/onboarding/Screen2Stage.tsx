import { EnterHint, Eyebrow, Option } from '../../components/Primitives';
import { LIFE_STAGES } from './data';

interface Props {
  value: string | null;
  onPick: (i: number, v: string) => void;
  confirming: boolean;
  confirmingIndex: number | null;
}

export function Screen2Stage({ value, onPick, confirming, confirmingIndex }: Props) {
  return (
    <>
      <Eyebrow n={2} total={7} />
      <h1 className="q-headline">Where are you right now?</h1>
      <p className="q-helper">Pick what fits closest — you can always change this later.</p>
      <div className="option-list cols-2">
        {LIFE_STAGES.map((label, i) => (
          <Option
            key={label}
            index={i}
            selected={value === label}
            confirming={confirming && confirmingIndex === i}
            onPick={() => onPick(i, label)}
          >
            {label}
          </Option>
        ))}
      </div>
      <div className="screen-footer">
        <EnterHint label="continue" />
      </div>
    </>
  );
}
