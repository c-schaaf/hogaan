// P2.3 — the two-minute reflection after a moment.
import { useEffect, useState } from 'react';
import { Card, ErrorLine, PageFrame } from '../components/PageFrame';
import type { Tab } from '../components/Nav';
import { api, type HowItWent, type Moment } from '../lib/api';
import { useFeatures } from '../lib/features';
import { MeetingNotesPanel } from '../components/MeetingNotesPanel';

const OPTIONS: [HowItWent, string][] = [
  ['well', 'It went well'],
  ['mixed', 'It was mixed'],
  ['hard', 'It was hard'],
];

export function Reflect({
  momentId,
  onNav,
  onDone,
  onTalk,
}: {
  momentId: string;
  onNav: (t: Tab) => void;
  onDone: () => void;
  onTalk: (seed: string) => void;
}) {
  const [moment, setMoment] = useState<Moment | null>(null);
  const [how, setHow] = useState<HowItWent | null>(null);
  const [differently, setDifferently] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const features = useFeatures();

  useEffect(() => {
    api.moments
      .list()
      .then((r) => {
        const m = r.moments.find((x) => x.id === momentId) ?? null;
        setMoment(m);
        if (m === null) setError('We could not find that moment.');
        if (m?.outcome) setSaved(true);
      })
      .catch(() => setError('We could not load this right now.'));
  }, [momentId]);

  return (
    <PageFrame
      title="How did it go?"
      subtitle="Two minutes. Hogaan will remember what you learned for next time."
      active="home"
      onNav={onNav}
      onBack={onDone}
      backLabel="Moments"
    >
      <ErrorLine message={error} />
      {moment !== null && (
        <Card title={moment.what + (moment.withWhom !== null ? ` · ${moment.withWhom}` : '')}>
          {saved ? (
            <>
              <p className="pr-card-note">
                Thank you. This is now part of what Hogaan knows, and you can change it any time.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="pr-card-action"
                  onClick={() => onTalk(`I want to reflect on how "${moment.what}" went.`)}
                >
                  Talk it through with Hogaan
                </button>
                <button type="button" className="pr-inline" onClick={onDone}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mo-how" role="radiogroup" aria-label="How did it go?">
                {OPTIONS.map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={how === v}
                    className={`pr-card-action ${how === v ? 'is-on' : ''}`}
                    onClick={() => setHow(v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="pr-field-label" htmlFor="mo-diff">
                What would you do differently next time? (optional)
              </label>
              <textarea
                id="mo-diff"
                className="mo-textarea"
                maxLength={500}
                value={differently}
                onChange={(e) => setDifferently(e.target.value)}
              />
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="pr-card-action"
                  disabled={how === null}
                  onClick={() => {
                    if (how === null) return;
                    void api.moments
                      .reflect(momentId, {
                        howItWent: how,
                        ...(differently.trim() !== '' ? { differently } : {}),
                      })
                      .then(() => setSaved(true))
                      .catch(() => setError("That didn't save. Please try again."));
                  }}
                >
                  Save reflection
                </button>
              </div>
            </>
          )}
        </Card>
      )}
      {saved && features.meetingNotes && <MeetingNotesPanel />}
    </PageFrame>
  );
}
