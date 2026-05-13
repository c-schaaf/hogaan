import { EnterHint, Eyebrow, Option } from '../../components/Primitives';
import { YEARS } from './data';

interface Props {
  value: string | null;
  onPick: (i: number, v: string) => void;
  confirming: boolean;
  confirmingIndex: number | null;
}

export function Screen3Years({ value, onPick, confirming, confirmingIndex }: Props) {
  return (
    <>
      <Eyebrow n={3} total={7} />
      <h1 className="q-headline">How long have you been leading other people?</h1>
      <p className="q-helper">Formally or informally — a team, a project, a group you organize.</p>
      <div className="option-list">
        {YEARS.map((label, i) => (
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
