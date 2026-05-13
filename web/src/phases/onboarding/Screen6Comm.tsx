import { EnterHint, Eyebrow } from '../../components/Primitives';
import { COMM, type CommOption } from './data';

interface Props {
  value: CommOption['id'] | null;
  onPick: (i: number, id: CommOption['id']) => void;
  confirming: boolean;
  confirmingIndex: number | null;
}

export function Screen6Comm({ value, onPick, confirming, confirmingIndex }: Props) {
  return (
    <>
      <Eyebrow n={6} total={7} />
      <h1 className="q-headline">How do you want me to talk to you?</h1>
      <p className="q-helper">There's no wrong answer — this helps me get the register right.</p>
      <div className="comm-grid">
        {COMM.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={[
              'comm',
              value === c.id ? 'selected' : '',
              confirming && confirmingIndex === i ? 'confirming' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onPick(i, c.id)}
          >
            <div className="comm-title">{c.title}</div>
            <div className="comm-body">{c.body}</div>
          </button>
        ))}
      </div>
      <div className="screen-footer">
        <EnterHint label="continue" />
      </div>
    </>
  );
}
