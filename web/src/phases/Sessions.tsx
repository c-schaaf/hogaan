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

function SessionRow({
  s,
  onOpen,
  onDelete,
}: {
  s: SessionSummary;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="ses-row-wrap">
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
      <button
        type="button"
        className="ses-row-del"
        onClick={onDelete}
        aria-label={`Delete session: ${s.title}`}
        title="Delete"
      >
        ×
      </button>
    </div>
  );
}

function SessionsEmpty({ onHome }: { onHome: () => void }) {
  return (
    <div className="ses-empty">
      <div className="ses-empty-mark" aria-hidden="true">
        <svg viewBox="0 0 96 96" width="96" height="96" fill="none">
          <rect
            x="14"
            y="22"
            width="68"
            height="56"
            rx="10"
            stroke="currentColor"
            strokeWidth="1.5"
          />
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
        When you talk with Hogaan, sessions get a title and the practices you worked through — so
        you can pick up where you left off.
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

const PAGE_SIZE = 20;

export function Sessions({ onBack, onOpen, onNav }: Props) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SessionSummary[] | null>(null);
  const [searchResults, setSearchResults] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (s: SessionSummary) => {
    const ok = window.confirm(
      `Delete "${s.title}"? This conversation and its messages will be removed permanently.`,
    );
    if (!ok) return;
    setDeletingId(s.id);
    try {
      await api.sessions.del(s.id);
      setRows((prev) => (prev ?? []).filter((r) => r.id !== s.id));
      setSearchResults((prev) => (prev === null ? null : prev.filter((r) => r.id !== s.id)));
    } catch (err) {
      console.error('delete session failed', err);
      window.alert("Couldn't delete that session — please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const resp = await api.sessions.list({ limit: PAGE_SIZE });
        setRows(fromApi(resp.sessions));
        setHasMore(resp.hasMore);
      } catch (err) {
        console.error('sessions list failed', err);
        setRows([]);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // SCRUM — server-side search. Debounce 300 ms; empty query clears
  // results and falls back to the paginated list above.
  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setSearchResults(null);
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const resp = await api.sessions.search({ q, limit: PAGE_SIZE });
          setSearchResults(fromApi(resp.sessions));
        } catch (err) {
          console.error('sessions search failed', err);
          setSearchResults([]);
        }
      })();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query]);

  const onLoadMore = async () => {
    if (loadingMore || !hasMore || rows === null || rows.length === 0) return;
    const last = rows[rows.length - 1];
    if (last === undefined) return;
    setLoadingMore(true);
    try {
      const resp = await api.sessions.list({ before: last.id, limit: PAGE_SIZE });
      setRows((prev) => [...(prev ?? []), ...fromApi(resp.sessions)]);
      setHasMore(resp.hasMore);
    } catch (err) {
      console.error('sessions load-more failed', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const groups = useMemo(() => {
    const source = query.trim().length > 0 ? (searchResults ?? []) : (rows ?? []);
    const out: Partial<Record<SessionSummary['group'], SessionSummary[]>> = {};
    for (const s of source) {
      const list = out[s.group] ?? [];
      list.push(s);
      out[s.group] = list;
    }
    return out;
  }, [query, rows, searchResults]);

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
            ) : loading ? null : !hasAny ? (
              <div className="ses-noresults">
                {query.trim().length > 0 ? (
                  <>
                    No session titles match "{query}".
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: 'var(--ink-3)',
                      }}
                    >
                      Search currently matches titles only — body search is coming soon.
                    </div>
                  </>
                ) : (
                  'No sessions yet.'
                )}
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
                          <SessionRow
                            key={s.id}
                            s={s}
                            onOpen={() => onOpen(s.id)}
                            onDelete={() => {
                              if (deletingId === null) void handleDelete(s);
                            }}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
                {hasMore && query.trim().length === 0 && (
                  <div className="ses-loadmore">
                    <button
                      type="button"
                      className="ses-loadmore-btn"
                      onClick={() => void onLoadMore()}
                      disabled={loadingMore}
                    >
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
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
