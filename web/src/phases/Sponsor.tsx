// P5.3 — sponsor view: cohorts, invite codes, and the aggregate report.
import { useEffect, useState } from 'react';
import { Card, ErrorLine, PageFrame } from '../components/PageFrame';
import type { Tab } from '../components/Nav';
import { api, type AdminOrg, type ReportResponse } from '../lib/api';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="pr-field">
      <div className="pr-field-label">{label}</div>
      <div className="pr-field-value">
        <span style={{ fontSize: 20, fontWeight: 600 }}>{value}</span>
      </div>
    </div>
  );
}

function Report({ cohortId }: { cohortId: string }) {
  const [r, setR] = useState<ReportResponse | null>(null);
  useEffect(() => {
    api.orgs
      .report(cohortId)
      .then(setR)
      .catch(() => undefined);
  }, [cohortId]);
  if (r === null) return <p className="pr-card-note">Loading…</p>;
  if (r.suppressed) return <p className="pr-card-note">{r.reason}</p>;
  const x = r.report;
  return (
    <div className="sp-report">
      <Stat label="Leaders enrolled" value={`${x.enrolled} of ${x.seatLimit} seats`} />
      <Stat label="Active in the last 4 weeks" value={x.activeLast4Weeks} />
      <Stat label="Coaching sessions" value={x.coachingSessions} />
      <Stat label="Conversations prepared for" value={x.momentsPrepared} />
      <Stat label="Loops closed (prepared and reflected on)" value={x.loopsClosed} />
      <Stat
        label="How they went (self-reported)"
        value={`${x.outcomes.well} well · ${x.outcomes.mixed} mixed · ${x.outcomes.hard} hard`}
      />
      <Stat
        label="Average change in confidence (1–5 scale)"
        value={
          x.avgConfidenceChange === null ? 'Not enough answers' : x.avgConfidenceChange.toFixed(2)
        }
      />
      <div className="pr-field">
        <div className="pr-field-label">Practices leaders chose (number of leaders)</div>
        <div className="pr-field-value">
          <span>
            {Object.entries(x.practiceCoverage)
              .sort((a, b) => b[1] - a[1])
              .map(([p, n]) => `${p} ${n}`)
              .join(' · ') || 'None yet'}
          </span>
        </div>
      </div>
      <p className="pr-card-note">
        Totals only. No names, no individual activity, and nothing anyone said. Cohorts under 10
        leaders show no report.
      </p>
      <div style={{ display: 'flex', gap: 8 }} className="sp-noprint">
        <a className="pr-card-action" href={`/api/cohorts/${cohortId}/report.csv`} download>
          Download CSV
        </a>
        <button type="button" className="pr-card-action" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>
    </div>
  );
}

export function Sponsor({ onNav, onBack }: { onNav: (t: Tab) => void; onBack: () => void }) {
  const [orgs, setOrgs] = useState<AdminOrg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [newCohort, setNewCohort] = useState<Record<string, { name: string; seats: string }>>({});
  const load = () =>
    api.orgs
      .admin()
      .then((r) => setOrgs(r.orgs))
      .catch(() => setError("We couldn't load your programs."));
  useEffect(() => {
    void load();
  }, []);

  return (
    <PageFrame
      title="Sponsor reports"
      subtitle="For funders and programs that sponsor leaders. You see totals for each cohort, never individuals."
      active="profile"
      onNav={onNav}
      onBack={onBack}
      backLabel="Profile"
    >
      <ErrorLine message={error} />
      {orgs?.map((o) => (
        <Card key={o.id} title={o.name}>
          {!o.verified && (
            <p className="pr-card-note">
              Waiting for Hogaan to verify this program. Until then its cohorts do not give leaders
              a sponsored seat and no report is shown.
            </p>
          )}
          {o.cohorts.map((c) => (
            <div key={c.id} style={{ marginBottom: 12 }}>
              <div className="pr-field">
                <div className="pr-field-label">
                  {c.enrolled} of {c.seatLimit} seats used
                </div>
                <div className="pr-field-value" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span>{c.name}</span>
                  <button
                    type="button"
                    className="pr-inline sp-noprint"
                    onClick={() => setOpen(open === c.id ? null : c.id)}
                  >
                    {open === c.id ? 'Hide report' : 'View report'}
                  </button>
                  <button
                    type="button"
                    className="pr-inline sp-noprint"
                    onClick={() =>
                      void api.orgs.invite(c.id).then((r) => setCodes({ ...codes, [c.id]: r.code }))
                    }
                  >
                    New invite code
                  </button>
                </div>
              </div>
              {codes[c.id] !== undefined && (
                <p className="pr-card-note">
                  Share this code with your leaders: <strong>{codes[c.id]}</strong> (shown once)
                </p>
              )}
              {open === c.id && <Report cohortId={c.id} />}
            </div>
          ))}
          <div className="ctx-line-edit sp-noprint">
            <input
              className="pr-name-input"
              aria-label="New cohort name"
              placeholder="New cohort name"
              value={newCohort[o.id]?.name ?? ''}
              onChange={(e) =>
                setNewCohort({
                  ...newCohort,
                  [o.id]: { name: e.target.value, seats: newCohort[o.id]?.seats ?? '50' },
                })
              }
            />
            <input
              className="pr-name-input"
              aria-label="Seats"
              type="number"
              min={1}
              value={newCohort[o.id]?.seats ?? '50'}
              onChange={(e) =>
                setNewCohort({
                  ...newCohort,
                  [o.id]: { name: newCohort[o.id]?.name ?? '', seats: e.target.value },
                })
              }
            />
            <button
              type="button"
              className="pr-card-action"
              onClick={() => {
                const n = newCohort[o.id];
                if (n === undefined || n.name.trim() === '') return;
                void api.orgs
                  .createCohort(o.id, n.name, Number.parseInt(n.seats, 10) || 50)
                  .then(load)
                  .catch(() => setError("That didn't work."));
              }}
            >
              Add cohort
            </button>
          </div>
        </Card>
      ))}
      <Card title="Add a program or funder">
        <div className="ctx-line-edit">
          <input
            className="pr-name-input"
            aria-label="Organization name"
            placeholder="Organization name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
          />
          <button
            type="button"
            className="pr-card-action"
            disabled={orgName.trim() === ''}
            onClick={() =>
              void api.orgs
                .createOrg(orgName)
                .then(() => {
                  setOrgName('');
                  return load();
                })
                .catch(() => setError("That didn't work."))
            }
          >
            Create
          </button>
        </div>
      </Card>
    </PageFrame>
  );
}
