// P1.3 — "What Hogaan knows about you". Shows the leader brief in plain
// language and lets the leader edit or delete any line, or everything.
import { useEffect, useState } from 'react';
import { Card, ErrorLine, PageFrame } from '../components/PageFrame';
import type { Tab } from '../components/Nav';
import {
  api,
  type BriefDoc,
  type BriefLine,
  type LeaderBrief,
  type ProfileFields,
} from '../lib/api';

const FIELD_LABELS: [keyof ProfileFields, string, string][] = [
  ['title', 'Your role', 'e.g. Program director'],
  ['industry', 'Industry', 'e.g. Housing, public health'],
  ['orgType', 'Organization type', 'e.g. Nonprofit, startup, city agency'],
  ['orgSize', 'Organization size', 'e.g. 40 people'],
  ['teamShape', 'Your team', 'e.g. 6 direct reports, 2 remote'],
  ['coachingPreference', 'How you like to be coached', 'e.g. Direct, with questions first'],
];

const DOC_INFO: Record<BriefDoc, { title: string; blurb: string; add: string }> = {
  profile: {
    title: 'About your work',
    blurb: 'What Hogaan has picked up about your context.',
    add: 'Add something about your work',
  },
  goals: {
    title: 'What you are working on',
    blurb: 'Your current goals and the practices they connect to.',
    add: 'Add a goal',
  },
  notes: {
    title: 'Notes from our conversations',
    blurb: 'What has worked, what has not, and things to come back to.',
    add: 'Add a note',
  },
};

const SOURCE_LABEL: Record<BriefLine['source'], string> = {
  conversation: 'from a conversation',
  leader: 'written by you',
  reflection: 'from a reflection',
  assistant: 'from your AI assistant',
};

function LineRow({
  line,
  onSave,
  onDelete,
}: {
  line: BriefLine;
  onSave: (text: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.text);
  const [busy, setBusy] = useState(false);
  return (
    <li className="ctx-line">
      {editing ? (
        <div className="ctx-line-edit">
          <input
            className="pr-name-input"
            value={draft}
            maxLength={240}
            aria-label="Edit line"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            className="pr-card-action"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onSave(draft).finally(() => {
                setBusy(false);
                setEditing(false);
              });
            }}
          >
            Save
          </button>
          <button type="button" className="pr-inline" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <span className="ctx-line-text">{line.text}</span>
          <span className="ctx-line-meta">{SOURCE_LABEL[line.source]}</span>
          <span className="ctx-line-actions">
            <button type="button" className="pr-inline" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="pr-inline"
              aria-label={`Delete: ${line.text}`}
              onClick={() => void onDelete()}
            >
              Delete
            </button>
          </span>
        </>
      )}
    </li>
  );
}

export function Context({ onNav, onBack }: { onNav: (t: Tab) => void; onBack: () => void }) {
  const [brief, setBrief] = useState<LeaderBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState<ProfileFields>({});
  const [editingFields, setEditingFields] = useState(false);
  const [adding, setAdding] = useState<Record<BriefDoc, string>>({
    profile: '',
    goals: '',
    notes: '',
  });
  const [confirmAll, setConfirmAll] = useState(false);

  const apply = (b: LeaderBrief) => {
    setBrief(b);
    setFieldDraft(b.profileFields);
  };

  useEffect(() => {
    api.brief
      .get()
      .then(apply)
      .catch(() => setError("We couldn't load this right now. Please try again."));
  }, []);

  const run = async (fn: () => Promise<LeaderBrief>) => {
    setError(null);
    try {
      apply(await fn());
    } catch {
      setError("That didn't save. Please try again.");
    }
  };

  const empty =
    brief !== null &&
    Object.keys(brief.profileFields).length === 0 &&
    brief.profile.length + brief.goals.length + brief.notes.length === 0;

  return (
    <PageFrame
      title="What Hogaan knows about you"
      subtitle="This is everything Hogaan keeps about you between conversations. It is only ever used to coach you. Change or delete anything."
      active="profile"
      onNav={onNav}
      onBack={onBack}
      backLabel="Profile"
    >
      <ErrorLine message={error} />
      <p className="pr-card-note">
        Hogaan keeps short notes in its own words, not your messages. Private sessions are never
        used here. Surnames, email addresses and phone numbers are removed before anything is saved
        or sent to the AI model.
      </p>
      {brief === null ? (
        <p className="pr-card-note">Loading…</p>
      ) : (
        <>
          {empty && (
            <p className="pr-card-note">
              Nothing yet. As you talk with Hogaan, short notes will appear here.
            </p>
          )}
          <Card
            title="Your work context"
            action={
              editingFields ? (
                <button
                  type="button"
                  className="pr-card-action"
                  onClick={() => {
                    setEditingFields(false);
                    const body: Partial<Record<keyof ProfileFields, string>> = {};
                    for (const [k] of FIELD_LABELS) body[k] = fieldDraft[k] ?? '';
                    void run(() => api.brief.setFields(body));
                  }}
                >
                  Save
                </button>
              ) : (
                <button
                  type="button"
                  className="pr-card-action"
                  onClick={() => setEditingFields(true)}
                >
                  Edit
                </button>
              )
            }
          >
            {FIELD_LABELS.map(([k, label, hint]) => (
              <div className="pr-field" key={k}>
                <div className="pr-field-label">{label}</div>
                <div className="pr-field-value">
                  {editingFields ? (
                    <input
                      className="pr-name-input"
                      aria-label={label}
                      placeholder={hint}
                      maxLength={120}
                      value={fieldDraft[k] ?? ''}
                      onChange={(e) => setFieldDraft({ ...fieldDraft, [k]: e.target.value })}
                    />
                  ) : (
                    <span>
                      {brief.profileFields[k] ?? <em className="ctx-empty">Not yet known</em>}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </Card>
          {(['profile', 'goals', 'notes'] as BriefDoc[]).map((doc) => (
            <Card key={doc} title={DOC_INFO[doc].title}>
              <p className="pr-card-note">{DOC_INFO[doc].blurb}</p>
              <ul className="ctx-lines">
                {brief[doc].map((line) => (
                  <LineRow
                    key={line.id}
                    line={line}
                    onSave={(text) => run(() => api.brief.editLine(line.id, text))}
                    onDelete={() => run(() => api.brief.deleteLine(line.id))}
                  />
                ))}
              </ul>
              <div className="ctx-line-edit">
                <input
                  className="pr-name-input"
                  aria-label={DOC_INFO[doc].add}
                  placeholder={DOC_INFO[doc].add}
                  maxLength={240}
                  value={adding[doc]}
                  onChange={(e) => setAdding({ ...adding, [doc]: e.target.value })}
                />
                <button
                  type="button"
                  className="pr-card-action"
                  disabled={adding[doc].trim().length === 0}
                  onClick={() => {
                    const text = adding[doc];
                    setAdding({ ...adding, [doc]: '' });
                    void run(() => api.brief.addLine(doc, text));
                  }}
                >
                  Add
                </button>
              </div>
            </Card>
          ))}
          <Card title="Delete everything">
            <p className="pr-card-note">
              This removes every note above. Your past sessions stay in Sessions until you delete
              them there.
            </p>
            {confirmAll ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="pr-signout"
                  onClick={() => {
                    setConfirmAll(false);
                    void api.brief
                      .deleteAll()
                      .then(() => api.brief.get())
                      .then(apply)
                      .catch(() => setError("That didn't work. Please try again."));
                  }}
                >
                  Yes, delete everything
                </button>
                <button type="button" className="pr-inline" onClick={() => setConfirmAll(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="pr-signout" onClick={() => setConfirmAll(true)}>
                Delete everything Hogaan knows
              </button>
            )}
          </Card>
        </>
      )}
    </PageFrame>
  );
}
