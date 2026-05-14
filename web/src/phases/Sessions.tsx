import { useEffect, useMemo, useState } from 'react';
import { HogaanWordmark } from '../components/HogaanWordmark';
import { SesIconArrow, SesIconSearch } from '../components/Icons';
import { BottomNav, DesktopSidebar, type Tab } from '../components/Nav';
import { api, type SessionSummary as ApiSessionSummary } from '../lib/api';

// Local shape lets the row component stay structurally identical to the
// design - practices is empty for now (Phase B+C don't propagate it onto
// session rows yet; a follow-up will derive practices from the most
// recent turn's practice_tag).
interface SessionSummary {
  id: string;
  title: string;
  practices: string[];
  when: string;
  msgs: number;
  group: 'This week' | 'Earlier this month' | 'Older';
}

function fromApi(rows: ApiSessionSummary[]): SessionSummary[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    msgs: r.msgs,
    when: r.when,
    group: r.group,
    practices: [],
  }));
}

function SessionRow({ s, onOpen }: { s: SessionSummary; onOpen: () => void }) {
  return (
    <button type="button" className="ses-row" onClick={onOpen}>
      <div className="ses-row-main">
        <div className="ses-row-title">{s.title}</div>
        <div className="ses-row-chips">
          {s.practices.map((p) => (
            <span key={p} className="ses-chip">
              {p}
            </span>
          ))}
        </div>
      </div>
      <div className="ses-row-side">
        <div className="ses-row-meta">
          {s.when} · {s.msgs} messages
        </div>
        <span className="ses-row-arrow">
          <SesIconArrow />
        </span>
      </div>
    </button>
  );
}

function SessionsEmpty({ onHome }: { onHome: () => void }) {
  return (
    <div className="ses-empty">
      <div className="ses-empty-mark" aria-hidden="true">
        <svg viewBox="0 0 96 96" width="96" height="96" fill="none">
          <rect x="14" y="22" width="68" height="56" rx="10" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M22 36h52M22 46h36M22 56h44"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.5"
          />
          <circle cx="76" cy="22" r="9" fill="var(--gold)" />
        </svg>
      </div>
      <h2 className="ses-empty-h">Your saved conversations will live here.</h2>
      <p className="ses-empty-sub">
        When you talk with Hogaan, sessions get a title and the practices you worked through — so you
        can pick up where you left off.
      </p>
      <button type="button" className="ses-empty-cta" onClick={onHome}>
        ← Back to Home
      </button>
    </div>
  );
}

interface Props {
  onBack: () => void;
  onOpen: (id: string) => void;
  onNav: (t: Tab) => void;
}

const ORDER: SessionSummary['group'][] = ['This week', 'Earlier this month', 'Older'];

export function Sessions({ onBack, onOpen, onNav }: Props) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const resp = await api.sessions.list();
        setRows(fromApi(resp.sessions));
      } catch (err) {
        console.error('sessions list failed', err);
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filter = (s: SessionSummary) =>
      !q ||
      s.title.toLowerCase().includes(q) ||
      s.practices.some((p) => p.toLowerCase().includes(q));
    const out: Partial<Record<SessionSummary['group'], SessionSummary[]>> = {};
    for (const s of rows ?? []) {
      if (!filter(s)) continue;
      const list = out[s.group] ?? [];
      list.push(s);
      out[s.group] = list;
    }
    return out;
  }, [query, rows]);

  const empty = !loading && (rows?.length ?? 0) === 0;
  const hasAny = ORDER.some((g) => (groups[g]?.length ?? 0) > 0);

  return (
    <div className="ses-page">
      <DesktopSidebar active="sessions" onNav={onNav} />
      <main className="ses-shell">
        <div className="ses-topbar">
          <HogaanWordmark small />
        </div>

        <div className="ses-scroll">
          <div className="ses-inner">
            <header className="ses-head">
              <h1 className="ses-h">Sessions</h1>
              <p className="ses-sub">Private sessions aren't shown here.</p>
            </header>

            {!empty && (
              <div className="ses-search">
                <span className="ses-search-ico">
                  <SesIconSearch />
                </span>
                <input
                  className="ses-search-input"
                  placeholder="Search sessions…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}

            {empty ? (
              <SessionsEmpty onHome={onBack} />
            ) : !hasAny ? (
              <div className="ses-noresults">
                {query.trim().length > 0 ? `No sessions match "${query}".` : 'No sessions yet.'}
              </div>
            ) : (
              <div className="ses-groups">
                {ORDER.map((g) => {
                  const rows = groups[g] ?? [];
                  if (rows.length === 0) return null;
                  return (
                    <section key={g} className="ses-group">
                      <h2 className="ses-group-h">{g}</h2>
                      <div className="ses-list">
                        {rows.map((s) => (
                          <SessionRow key={s.id} s={s} onOpen={() => onOpen(s.id)} />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}

            <div className="ses-foot-space" />
          </div>
        </div>

        <BottomNav active="sessions" onNav={onNav} />
      </main>
    </div>
  );
}
