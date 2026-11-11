// P2.1 — moments: what the leader is preparing for, and when.
import { useEffect, useState } from 'react';
import { Card, ErrorLine, PageFrame } from '../components/PageFrame';
import type { Tab } from '../components/Nav';
import { api, type DemoEmail, type Moment } from '../lib/api';
import { useFeatures } from '../lib/features';

function fmt(iso: string | null): string {
  if (iso === null) return 'Date not set';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** <input type="datetime-local"> value -> ISO, in the browser's timezone. */
function localToIso(v: string): string | null {
  if (v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const HOW: Record<string, string> = { well: 'Went well', mixed: 'Mixed', hard: 'Hard' };

export function Moments({
  onNav,
  onReflect,
}: {
  onNav: (t: Tab) => void;
  onReflect: (id: string) => void;
}) {
  const features = useFeatures();
  const [list, setList] = useState<Moment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [what, setWhat] = useState('');
  const [who, setWho] = useState('');
  const [when, setWhen] = useState('');
  const [outbox, setOutbox] = useState<DemoEmail[]>([]);
  const [demoNote, setDemoNote] = useState<string | null>(null);

  const load = () =>
    api.moments
      .list()
      .then((r) => setList(r.moments))
      .catch(() => setError("We couldn't load your moments. Please try again."));
  const loadOutbox = () =>
    api.demo
      .outbox()
      .then((r) => setOutbox(r.emails))
      .catch(() => undefined);

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (features.demoMode) void loadOutbox();
  }, [features.demoMode]);

  const now = Date.now();
  const upcoming = (list ?? []).filter((m) => m.status === 'upcoming');
  const due = upcoming.filter((m) => m.happensAt !== null && Date.parse(m.happensAt) < now);
  const later = upcoming.filter((m) => m.happensAt === null || Date.parse(m.happensAt) >= now);
  const done = (list ?? []).filter((m) => m.status === 'reflected');

  return (
    <PageFrame
      title="Moments"
      subtitle="Conversations you are preparing for. After each one, Hogaan can check in so you can reflect."
      active="home"
      onNav={onNav}
    >
      <ErrorLine message={error} />
      {due.length > 0 && (
        <Card title="Ready to reflect">
          {due.map((m) => (
            <div className="pr-field" key={m.id}>
              <div className="pr-field-label">{fmt(m.happensAt)}</div>
              <div className="pr-field-value" style={{ gap: 8 }}>
                <span>
                  {m.what}
                  {m.withWhom !== null ? ` · ${m.withWhom}` : ''}
                </span>
                <button type="button" className="pr-card-action" onClick={() => onReflect(m.id)}>
                  How did it go?
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}
      <Card title="Coming up">
        {list !== null && later.length === 0 && (
          <p className="pr-card-note">
            Nothing yet. When you prepare for a conversation with Hogaan, it will appear here, or
            add one below.
          </p>
        )}
        {later.map((m) => (
          <div className="pr-field" key={m.id}>
            <div className="pr-field-label">
              {m.source === 'conversation'
                ? 'From a conversation'
                : m.source === 'assistant'
                  ? 'From your AI assistant'
                  : 'Added by you'}
            </div>
            <div className="pr-field-value" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span>
                {m.what}
                {m.withWhom !== null ? ` · ${m.withWhom}` : ''}
                <br />
                <span className="mo-when">{fmt(m.happensAt)}</span>
              </span>
              <input
                type="datetime-local"
                className="pr-name-input"
                aria-label={`When is ${m.what}?`}
                onChange={(e) => {
                  const iso = localToIso(e.target.value);
                  void api.moments
                    .update(m.id, { happensAt: iso })
                    .then(load)
                    .catch(() => setError("That didn't save."));
                }}
              />
              <button
                type="button"
                className="pr-inline"
                onClick={() => void api.moments.update(m.id, { status: 'dismissed' }).then(load)}
              >
                Not happening
              </button>
            </div>
          </div>
        ))}
        <div className="ctx-line-edit">
          <input
            className="pr-name-input"
            placeholder="What are you preparing for?"
            aria-label="What are you preparing for?"
            maxLength={160}
            value={what}
            onChange={(e) => setWhat(e.target.value)}
          />
          <input
            className="pr-name-input"
            placeholder="With whom (a role, e.g. my director)"
            aria-label="With whom"
            maxLength={60}
            value={who}
            onChange={(e) => setWho(e.target.value)}
          />
          <input
            type="datetime-local"
            className="pr-name-input"
            aria-label="When"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          <button
            type="button"
            className="pr-card-action"
            disabled={what.trim().length === 0}
            onClick={() => {
              void api.moments
                .create({
                  what,
                  ...(who.trim() !== '' ? { withWhom: who } : {}),
                  happensAt: localToIso(when),
                })
                .then(() => {
                  setWhat('');
                  setWho('');
                  setWhen('');
                  return load();
                })
                .catch(() => setError("That didn't save."));
            }}
          >
            Add moment
          </button>
        </div>
      </Card>
      {done.length > 0 && (
        <Card title="Reflected">
          {done.map((m) => (
            <div className="pr-field" key={m.id}>
              <div className="pr-field-label">{fmt(m.happensAt)}</div>
              <div className="pr-field-value">
                <span>
                  {m.what} ·{' '}
                  <span className="ctx-pill">{HOW[m.outcome?.howItWent ?? ''] ?? ''}</span>
                  {m.outcome?.differently ? (
                    <>
                      <br />
                      <span className="mo-when">Next time: {m.outcome.differently}</span>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
          ))}
        </Card>
      )}
      {features.demoMode && (
        <section className="pr-card demo-panel" style={{ marginBottom: 16 }}>
          <header className="pr-card-head">
            <h2 className="pr-card-h">Demo controls</h2>
          </header>
          <div className="pr-card-body">
            <p className="pr-card-note">
              In the real app, background work runs on its own schedule (a follow-up goes out the
              morning after a moment). In demo mode you can fast-forward it.
            </p>
            <button
              type="button"
              className="pr-card-action"
              onClick={() => {
                setDemoNote('Running…');
                void api.demo
                  .runJobs()
                  .then((r) => {
                    setDemoNote(`Ran ${r.ran} background job${r.ran === 1 ? '' : 's'}.`);
                    return Promise.all([load(), loadOutbox()]);
                  })
                  .catch(() => setDemoNote('Something went wrong.'));
              }}
            >
              Run background work now
            </button>
            {demoNote !== null && <p className="pr-card-note">{demoNote}</p>}
            <h3 className="pr-card-h" style={{ marginTop: 12 }}>
              Demo outbox (emails that would have been sent)
            </h3>
            {outbox.length === 0 ? (
              <p className="pr-card-note">No emails yet.</p>
            ) : (
              outbox.map((e, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div className="mo-when">
                    To {e.to} · {e.subject} · {fmt(e.at)}
                  </div>
                  <div className="demo-mail">{e.text}</div>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </PageFrame>
  );
}
