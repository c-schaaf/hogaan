import { EnterHint, Eyebrow, Option } from '../../components/Primitives';
import { DEPTHS, type DepthOption } from './data';

interface Props {
  value: DepthOption['id'] | null;
  onPick: (i: number, id: DepthOption['id']) => void;
  confirming: boolean;
  confirmingIndex: number | null;
}

export function Screen7Depth({ value, onPick, confirming, confirmingIndex }: Props) {
  return (
    <>
      <Eyebrow n={7} total={7} />
      <h1 className="q-headline">How much do you want in a typical response?</h1>
      <p className="q-helper">
        You can ask for more or less in any session — this is just the default.
      </p>
      <div className="option-list">
        {DEPTHS.map((d, i) => (
          <Option
            key={d.id}
            index={i}
            selected={value === d.id}
            confirming={confirming && confirmingIndex === i}
            onPick={() => onPick(i, d.id)}
            badge={d.rec ? 'Recommended' : null}
            gloss={d.gloss}
          >
            {d.label}
          </Option>
        ))}
      </div>
      <div className="screen-footer">
        <EnterHint label="continue" />
      </div>
    </>
  );
}
