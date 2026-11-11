// P6.2 — paste meeting notes, keep only the insights you choose.
import { useState } from 'react';
import { ApiError, api } from '../lib/api';

export function MeetingNotesPanel() {
  const [notes, setNotes] = useState('');
  const [insights, setInsights] = useState<string[] | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <section className="pr-card" style={{ marginBottom: 16 }}>
      <header className="pr-card-head">
        <h2 className="pr-card-h">Reflect from meeting notes</h2>
      </header>
      <div className="pr-card-body">
        <p className="pr-card-note">
          Paste notes or a transcript from a meeting you were in. Hogaan suggests a few insights
          about how you showed up. Your notes are not saved, and nothing is kept unless you choose
          it below. Other people are referred to by role, not name.
        </p>
        <textarea
          className="mo-textarea"
          aria-label="Meeting notes"
          maxLength={20000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button
          type="button"
          className="pr-card-action"
          style={{ marginTop: 8 }}
          disabled={busy || notes.trim().length < 20}
          onClick={() => {
            setBusy(true);
            setMsg(null);
            void api
              .meetingInsights(notes)
              .then((r) => {
                setInsights(r.insights);
                setKeep(new Set(r.insights.map((_, i) => i)));
                setNotes('');
              })
              .catch((e: unknown) =>
                setMsg(
                  e instanceof ApiError && e.code === 'upgrade_required'
                    ? 'This is part of the Personal plan.'
                    : "That didn't work. Please try again.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Reading…' : 'Suggest insights'}
        </button>
        {insights !== null && (
          <>
            {insights.map((t, i) => (
              <label key={i} className="ctx-line" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={keep.has(i)}
                  onChange={(e) => {
                    const next = new Set(keep);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    setKeep(next);
                  }}
                />
                <span className="ctx-line-text">{t}</span>
              </label>
            ))}
            <button
              type="button"
              className="pr-card-action"
              disabled={keep.size === 0}
              onClick={() =>
                void Promise.all(
                  insights.filter((_, i) => keep.has(i)).map((t) => api.brief.addLine('notes', t)),
                )
                  .then(() => {
                    setMsg(`Kept ${keep.size} insight${keep.size === 1 ? '' : 's'}.`);
                    setInsights(null);
                  })
                  .catch(() => setMsg("That didn't save."))
              }
            >
              Keep selected
            </button>
          </>
        )}
        {msg !== null && <p className="pr-card-note">{msg}</p>}
      </div>
    </section>
  );
}
