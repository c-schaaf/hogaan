// P5.4 — the leader's view: cohorts they belong to, and exactly what a
// sponsor can and cannot see. Joining requires reading and accepting it.
import { useEffect, useState } from 'react';
import { ApiError, api, type Sponsorship } from '../lib/api';

const JOIN_ERRORS: Record<string, string> = {
  invalid_code: 'That code did not work. Check it with your program.',
  cohort_full: 'That cohort is full.',
  cohort_ended: 'That cohort has ended.',
  sponsor_cannot_join: "Sponsors can't join their own cohorts.",
};

export function SponsorshipCard({ onOpenSponsor }: { onOpenSponsor: () => void }) {
  const [sp, setSp] = useState<Sponsorship | null>(null);
  const [code, setCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () =>
    api.orgs
      .sponsorship()
      .then(setSp)
      .catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  if (sp === null) return null;
  return (
    <section className="pr-card">
      <header className="pr-card-head">
        <h2 className="pr-card-h">Sponsored programs</h2>
      </header>
      <div className="pr-card-body">
        {sp.memberships.map((m) => (
          <div className="pr-field" key={m.cohortId}>
            <div className="pr-field-label">{m.orgName}</div>
            <div className="pr-field-value" style={{ gap: 8 }}>
              <span>{m.cohortName}</span>
              <button
                type="button"
                className="pr-inline"
                onClick={() => void api.orgs.leave(m.cohortId).then(load)}
              >
                Leave
              </button>
            </div>
          </div>
        ))}
        <p className="pr-card-note">
          <strong>What a sponsor can see:</strong>
        </p>
        <ul className="ctx-lines">
          {sp.statement.canSee.map((t) => (
            <li key={t} className="ctx-line">
              {t}
            </li>
          ))}
        </ul>
        <p className="pr-card-note">
          <strong>What a sponsor can never see:</strong>
        </p>
        <ul className="ctx-lines">
          {sp.statement.cannotSee.map((t) => (
            <li key={t} className="ctx-line">
              {t}
            </li>
          ))}
        </ul>
        <div className="ctx-line-edit">
          <input
            className="pr-name-input"
            aria-label="Invite code"
            placeholder="Invite code, e.g. HGN-ABCD-1234"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            I have read what my sponsor can and cannot see
          </label>
          <button
            type="button"
            className="pr-card-action"
            disabled={!agreed || code.trim() === ''}
            onClick={() =>
              void api.orgs
                .join(code)
                .then((r) => {
                  setMsg(`You joined ${r.cohortName} (${r.orgName}).`);
                  setCode('');
                  return load();
                })
                .catch((e: unknown) =>
                  setMsg(
                    e instanceof ApiError && e.code !== undefined
                      ? (JOIN_ERRORS[e.code] ?? 'That did not work.')
                      : 'That did not work.',
                  ),
                )
            }
          >
            Join
          </button>
        </div>
        {msg !== null && <p className="pr-card-note">{msg}</p>}
        <button type="button" className="pr-inline" onClick={onOpenSponsor}>
          I fund or run a program → sponsor reports
        </button>
      </div>
    </section>
  );
}
