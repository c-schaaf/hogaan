import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChatIconBack,
  ChatIconBookmark,
  ChatIconClose,
  ChatIconMenu,
  ChatIconMic,
  ChatIconMoon,
  ChatIconSend,
  CrisisShield,
} from '../components/Icons';
import { api, type SessionSummary } from '../lib/api';

const DISTRESS_PHRASES = [
  'kill myself',
  'killing myself',
  'end my life',
  'end it all',
  'want to die',
  'hurt myself',
  'harm myself',
  'suicide',
  'suicidal',
  'being abused',
  'abusing me',
  'hits me',
  'beats me',
  'rape',
  'unsafe at home',
];

function detectDistress(text: string): boolean {
  const t = text.toLowerCase();
  return DISTRESS_PHRASES.some((p) => t.includes(p));
}

interface CrisisResource {
  id: string;
  name: string;
  sub: string;
  actions: { kind: 'call' | 'text'; label: string; href: string; primary?: boolean }[];
}

const RESOURCES: CrisisResource[] = [
  {
    id: '988',
    name: '988 Suicide & Crisis Lifeline',
    sub: 'Call or text 988 — 24/7, free, confidential',
    actions: [
      { kind: 'call', label: 'Call 988', href: 'tel:988', primary: true },
      { kind: 'text', label: 'Text 988', href: 'sms:988' },
    ],
  },
  {
    id: 'ctl',
    name: 'Crisis Text Line',
    sub: 'Text HOME to 741741 — free crisis support',
    actions: [{ kind: 'text', label: 'Text HOME', href: 'sms:741741&body=HOME' }],
  },
  {
    id: 'dv',
    name: 'National Domestic Violence Hotline',
    sub: 'Call 1-800-799-7233 or text START to 88788',
    actions: [
      { kind: 'call', label: 'Call', href: 'tel:18007997233' },
      { kind: 'text', label: 'Text START', href: 'sms:88788&body=START' },
    ],
  },
  {
    id: 'samhsa',
    name: 'SAMHSA National Helpline',
    sub: '1-800-662-4357 — mental health & substance use referrals',
    actions: [{ kind: 'call', label: 'Call', href: 'tel:18006624357' }],
  },
];

function CrisisCard({ onReturn }: { onReturn: () => void }) {
  return (
    <div className="cr-wrap">
      <div className="cr-card">
        <div className="cr-icon">
          <CrisisShield />
        </div>
        <h2 className="cr-h">I want to pause coaching and make sure you have what you need.</h2>
        <p className="cr-body">
          What you wrote sounds heavier than something I can help with as a coach. There are people
          trained for exactly this — please reach out to one of them.
        </p>
        <div className="cr-resources">
          {RESOURCES.map((r) => (
            <div key={r.id} className="cr-row">
              <div className="cr-row-head">
                <div className="cr-row-title">{r.name}</div>
                <div className="cr-row-sub">{r.sub}</div>
              </div>
              <div className="cr-row-actions">
                {r.actions.map((a, i) => (
                  <a key={i} className={`cr-btn ${a.primary ? 'is-primary' : ''}`} href={a.href}>
                    {a.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="cr-note">
          These services are free and confidential. They won't tell anyone you called unless you're
          in immediate danger or asking them to.
        </p>
        <button type="button" className="cr-return" onClick={onReturn}>
          If this wasn't right and you'd like to keep talking with me,{' '}
          <span className="cr-return-link">return to coaching</span>.
        </button>
      </div>
    </div>
  );
}

interface BotParagraph {
  paras: ReactNode[];
  chips: string[];
}

// Render the orchestrator's plain-text response into the paragraph + em-
// emphasis structure the chat bubble expects. The Hamse-arc template
// tends to lead paragraphs with "An insight:" or "A first move:" /
// "Here's a first move:". Highlight those leads in gold-deep italics so
// the bubble reads as designed.
function renderResponse(text: string): BotParagraph {
  const trimmed = text.replace(/\r\n/g, '\n').trim();
  const paragraphs = trimmed.split(/\n{2,}|\n(?=[A-Z])/).filter((p) => p.trim().length > 0);
  const leadRegex = /^(An insight|A first move|Here's a first move|First move|Insight|Action|Story|Reflection)\s*:\s*/i;
  const nodes: ReactNode[] = paragraphs.map((p, i) => {
    const m = leadRegex.exec(p);
    if (m === null) return <Fragment key={i}>{p}</Fragment>;
    const rest = p.slice(m[0].length);
    return (
      <Fragment key={i}>
        <em className="chat-em">{m[1]}:</em> {rest}
      </Fragment>
    );
  });
  return { paras: nodes, chips: [] };
}

interface ChatItem {
  kind: 'divider' | 'user' | 'bot' | 'crisis';
  label?: string;
  text?: string;
  paras?: ReactNode[];
  chips?: string[];
}

function SessionsRail({
  hidden,
  past,
  currentTitle,
}: {
  hidden: boolean;
  past: SessionSummary[];
  currentTitle: string;
}) {
  if (hidden) return null;
  return (
    <aside className="ch-rail ch-rail--left" aria-label="Past sessions">
      <div className="ch-rail-head">
        <span className="ch-rail-h">Sessions</span>
      </div>
      <div className="ch-rail-row is-current">
        <span className="ch-rail-dot" />
        <span className="ch-rail-row-body">
          <span className="ch-rail-row-title">{currentTitle}</span>
          <span className="ch-rail-row-when">Now · in progress</span>
        </span>
      </div>
      {past.length > 0 && <div className="ch-rail-divider">Earlier</div>}
      {past.map((s) => (
        <button key={s.id} type="button" className="ch-rail-row">
          <span className="ch-rail-row-body">
            <span className="ch-rail-row-title">{s.title}</span>
            <span className="ch-rail-row-when">{s.when}</span>
          </span>
        </button>
      ))}
    </aside>
  );
}

function PracticesRail({ practices }: { practices: string[] }) {
  return (
    <aside className="ch-rail ch-rail--right" aria-label="Practices in focus">
      <div className="ch-rail-head">
        <span className="ch-rail-h">Practices in focus</span>
      </div>
      <div className="ch-prac-list">
        {practices.map((p, i) => (
          <div key={i} className="ch-prac-item">
            <span className="ch-prac-bullet">·</span>
            <span className="ch-prac-name">{p}</span>
          </div>
        ))}
      </div>
      <div className="ch-rail-note">
        Hogaan listens through these practices first. You can change them anytime in Profile.
      </div>
    </aside>
  );
}

function PrivacyToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      className={`ch-priv ${on ? 'is-on' : ''}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={
        on
          ? "Private session on — this conversation won't be saved"
          : 'Saved session — turn private mode on to keep this off your history'
      }
    >
      <span className="ch-priv-ico">{on ? <ChatIconMoon /> : <ChatIconBookmark />}</span>
      <span className="ch-priv-text">
        <span className="ch-priv-label">{on ? 'Private session' : 'Saved session'}</span>
        <span className="ch-priv-sub">{on ? "Won't be remembered" : 'Remembered for later'}</span>
      </span>
      <span className="ch-priv-switch" aria-hidden="true">
        <span className="ch-priv-knob" />
      </span>
    </button>
  );
}

interface Props {
  practices?: string[];
  seed?: string | null;
  onBack: () => void;
  forceCrisis?: boolean;
  openSessionId?: string | null;
}

function dividerLabel(): string {
  const now = new Date();
  const hh = now.getHours();
  const mm = now.getMinutes().toString().padStart(2, '0');
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `Today, ${h12}:${mm} ${suffix}`;
}

export function Chat({
  practices = ['Integrity', 'Empathy', 'Peace'],
  seed,
  onBack,
  forceCrisis,
  openSessionId,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>(() => [
    { kind: 'divider', label: dividerLabel() },
  ]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState('Tonight’s session');
  const [pastSessions, setPastSessions] = useState<SessionSummary[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [privateMode, setPrivateMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seedRef = useRef(seed);

  // Pull real past sessions for the sidebar/drawer; refresh after each turn
  // so a freshly-generated session title appears without a page reload.
  const reloadPast = async () => {
    try {
      const resp = await api.sessions.list();
      const others = resp.sessions.filter((s) => s.id !== sessionId);
      setPastSessions(others);
      if (sessionId !== null) {
        const me = resp.sessions.find((s) => s.id === sessionId);
        if (me?.title) setCurrentTitle(me.title);
      }
    } catch (err) {
      console.error('sessions list failed', err);
    }
  };
  useEffect(() => {
    void reloadPast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [items, thinking]);

  useEffect(() => {
    if (forceCrisis) {
      setItems((prev) => [...prev, { kind: 'crisis' }]);
    }
  }, [forceCrisis]);

  useEffect(() => {
    if (!openSessionId) return;
    void (async () => {
      try {
        const detail = await api.sessions.get(openSessionId);
        setSessionId(detail.session.id);
        if (detail.session.title) setCurrentTitle(detail.session.title);
        const hydrated: ChatItem[] = [{ kind: 'divider', label: dividerLabel() }];
        for (const t of detail.turns) {
          hydrated.push({ kind: 'user', text: t.userMessage });
          if (t.responseText) {
            const r = renderResponse(t.responseText);
            hydrated.push({ kind: 'bot', paras: r.paras, chips: r.chips });
          }
        }
        setItems(hydrated);
      } catch (err) {
        console.error('failed to load session', err);
      }
    })();
  }, [openSessionId]);

  const sendText = async (text: string) => {
    const t = text.trim();
    if (t.length === 0) return;
    // Client-side distress preview: render the crisis card immediately so
    // the user sees resources without waiting for the backend round-trip.
    // The server-side triage is the source of truth - it'll also fire if
    // the client preview missed something.
    const clientCrisis = detectDistress(t);
    setItems((prev) => [...prev, { kind: 'user', text: t }]);
    setDraft('');
    if (clientCrisis) {
      setItems((prev) => [...prev, { kind: 'crisis' }]);
      return;
    }
    setThinking(true);

    // Streaming bot bubble. The upsert reads the items array to decide
    // append vs. replace — no closure boolean (StrictMode double-invokes
    // setState updaters in dev, which mutates closure state out from
    // under us). Append iff the last item is not the bot bubble we're
    // streaming into; otherwise replace.
    let streamingText = '';
    const upsertStreamingBot = (text: string) => {
      const r = renderResponse(text);
      setItems((prev) => {
        const lastIdx = prev.length - 1;
        if (lastIdx >= 0 && prev[lastIdx].kind === 'bot') {
          const next = prev.slice();
          next[lastIdx] = { kind: 'bot', paras: r.paras, chips: r.chips };
          return next;
        }
        return [...prev, { kind: 'bot', paras: r.paras, chips: r.chips }];
      });
    };

    try {
      let gotCrisis = false;
      for await (const ev of api.turnStream({
        message: t,
        ...(sessionId !== null ? { sessionId } : {}),
        private: privateMode,
      })) {
        if (ev.type === 'start') {
          setSessionId(ev.sessionId);
          setThinking(false); // first byte received — drop the spinner
        } else if (ev.type === 'delta') {
          streamingText += ev.text;
          upsertStreamingBot(streamingText);
        } else if (ev.type === 'crisis') {
          gotCrisis = true;
          setThinking(false);
          setItems((prev) => [...prev, { kind: 'crisis' }]);
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        } else if (ev.type === 'end') {
          // Stream complete — refresh the rail so the new session/title
          // shows up.
          if (!gotCrisis) void reloadPast();
        }
      }
    } catch (err) {
      setThinking(false);
      console.error('stream turn failed', err);
      setItems((prev) => [
        ...prev,
        {
          kind: 'bot',
          paras: [
            <>
              Something went wrong on my side just now. Take a breath and try again - I'm still
              here.
            </>,
          ],
          chips: [],
        },
      ]);
    }
  };

  // Auto-send the seed (when Home composed a topic) after first paint.
  useEffect(() => {
    if (seedRef.current !== null && seedRef.current !== undefined && seedRef.current.length > 0) {
      const s = seedRef.current;
      seedRef.current = null;
      void sendText(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeCrisis = () => {
    setItems((prev) => prev.filter((i) => i.kind !== 'crisis'));
  };

  return (
    <div className={`ch-page ${privateMode ? 'is-private' : ''}`}>
      <SessionsRail hidden={privateMode} past={pastSessions} currentTitle={currentTitle} />

      <main className="ch-shell">
        <div className="ch-topbar">
          <button
            type="button"
            className="ch-menu"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open sessions menu"
          >
            <ChatIconMenu />
          </button>
          <button
            type="button"
            className="ch-back"
            onClick={onBack}
            aria-label="Back to home"
          >
            <ChatIconBack />
          </button>
          <div className="ch-title-wrap">
            <div className="ch-title">Coaching session</div>
            <div className="ch-sub">Practices in focus · {practices.join(', ')}</div>
          </div>
          <PrivacyToggle on={privateMode} onChange={setPrivateMode} />
        </div>

        {privateMode && (
          <div className="ch-priv-banner">
            <ChatIconMoon />
            <span>
              Private session — nothing here is saved to your history. Close the tab and it's gone.
            </span>
          </div>
        )}

        <div className="ch-scroll" ref={scrollRef}>
          <div className="ch-stream">
            {items.map((it, i) => {
              if (it.kind === 'divider')
                return (
                  <div key={i} className="chat-divider">
                    <span>{it.label}</span>
                  </div>
                );
              if (it.kind === 'user')
                return (
                  <div key={i} className="chat-row user">
                    <div className="chat-bubble user">{it.text}</div>
                  </div>
                );
              if (it.kind === 'crisis') return <CrisisCard key={i} onReturn={removeCrisis} />;
              if (it.kind === 'bot') {
                return (
                  <Fragment key={i}>
                    <div className="chat-row bot">
                      <div className="chat-avatar">
                        <span>H</span>
                      </div>
                      <div className="chat-bubble bot">
                        {it.paras?.map((p, j) => (
                          <p key={j} className="chat-p">
                            {p}
                          </p>
                        ))}
                      </div>
                    </div>
                    {it.chips && (
                      <div className="chat-quick-wrap">
                        <div className="chat-quick">
                          {it.chips.map((c, k) => (
                            <button
                              key={k}
                              type="button"
                              className="chat-chip"
                              onClick={() => sendText(c)}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              }
              return null;
            })}
            {thinking && (
              <div className="chat-row bot">
                <div className="chat-avatar">
                  <span>H</span>
                </div>
                <div className="chat-bubble bot thinking">
                  <span className="chat-dot" />
                  <span className="chat-dot" />
                  <span className="chat-dot" />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="ch-composer">
          <button type="button" className="ch-mic" aria-label="Voice">
            <ChatIconMic />
          </button>
          <input
            className="ch-input"
            placeholder="Type your message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendText(draft);
            }}
          />
          <button type="button" className="ch-send" onClick={() => sendText(draft)} aria-label="Send">
            <ChatIconSend />
          </button>
        </div>
        <div className="ch-foot">
          {privateMode
            ? "Private session · this conversation won't be saved or remembered."
            : `Saved by default · Practices: ${practices.join(' · ')}`}
        </div>
      </main>

      <PracticesRail practices={practices} />

      {drawerOpen && (
        <div className="ch-drawer-wrap" onClick={() => setDrawerOpen(false)}>
          <aside
            className="ch-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Past sessions"
          >
            <div className="ch-drawer-head">
              <span className="ch-drawer-h">Sessions</span>
              <button
                type="button"
                className="ch-drawer-close"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close"
              >
                <ChatIconClose />
              </button>
            </div>
            <div className="ch-drawer-row is-current">
              <span className="ch-rail-dot" />
              <span className="ch-rail-row-body">
                <span className="ch-rail-row-title">{currentTitle}</span>
                <span className="ch-rail-row-when">Now · in progress</span>
              </span>
            </div>
            {pastSessions.length > 0 && <div className="ch-rail-divider">Earlier</div>}
            {pastSessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="ch-drawer-row"
                onClick={() => setDrawerOpen(false)}
              >
                <span className="ch-rail-row-body">
                  <span className="ch-rail-row-title">{s.title}</span>
                  <span className="ch-rail-row-when">{s.when}</span>
                </span>
              </button>
            ))}
            {pastSessions.length === 0 && (
              <div
                style={{
                  fontFamily: 'var(--font-b)',
                  fontSize: 12.5,
                  color: 'var(--ink-3)',
                  padding: '14px 10px',
                  lineHeight: 1.5,
                }}
              >
                No past sessions yet. Future conversations will appear here.
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
