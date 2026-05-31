import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChatIconBack,
  ChatIconBookmark,
  ChatIconClose,
  ChatIconMenu,
  ChatIconMic,
  ChatIconMoon,
  ChatIconSend,
} from '../components/Icons';
import { api, ApiError, type SessionSummary } from '../lib/api';

interface BotParagraph {
  paras: ReactNode[];
  chips: string[];
}

// Render the orchestrator's plain-text response into the paragraph + em-
// emphasis structure the chat bubble expects. The Hamse-arc template
// tends to lead paragraphs with "An insight:" or "A first move:" /
// "Here's a first move:". Highlight those leads in gold-deep italics so
// the bubble reads as designed.
//
// SCRUM (PR C / launch-readiness 9) — also parse inline markdown emphasis
// the LLM emits today (e.g. `*you*` italic, `**bold**` bold) so the chat
// bubble doesn't show literal asterisks. The Layer-2 prompt change tells
// the LLM to stop using emphasis at all, but rendering is the defense-in-
// depth that keeps stale prompts or fallback-model output from leaking
// asterisks to the user. Streaming-safe: unpaired trailing asterisks
// (incomplete mid-stream) are rendered as literal text rather than
// swallowed.
function parseInlineEmphasis(text: string): ReactNode[] {
  // Match **strong** first (greedy) then *emphasis*. Both are word-tight
  // (no whitespace immediately inside the markers) so URLs and casual
  // asterisks-with-spaces survive untouched.
  const pattern = /\*\*([^*\n][^*\n]*?)\*\*|\*([^*\n][^*\n]*?)\*/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > cursor) {
      nodes.push(<Fragment key={key++}>{text.slice(cursor, m.index)}</Fragment>);
    }
    if (m[1] !== undefined) {
      nodes.push(<strong key={key++}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      nodes.push(<em key={key++}>{m[2]}</em>);
    }
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) {
    nodes.push(<Fragment key={key++}>{text.slice(cursor)}</Fragment>);
  }
  return nodes;
}

function renderResponse(text: string): BotParagraph {
  const trimmed = text.replace(/\r\n/g, '\n').trim();
  const paragraphs = trimmed.split(/\n{2,}|\n(?=[A-Z])/).filter((p) => p.trim().length > 0);
  const leadRegex =
    /^(An insight|A first move|Here's a first move|First move|Insight|Action|Story|Reflection)\s*:\s*/i;
  const nodes: ReactNode[] = paragraphs.map((p, i) => {
    const m = leadRegex.exec(p);
    if (m === null) {
      return <Fragment key={i}>{parseInlineEmphasis(p)}</Fragment>;
    }
    const rest = p.slice(m[0].length);
    return (
      <Fragment key={i}>
        <em className="chat-em">{m[1]}:</em> {parseInlineEmphasis(rest)}
      </Fragment>
    );
  });
  return { paras: nodes, chips: [] };
}

interface ChatItem {
  /**
   * SCRUM — stable per-item id. Pre-fix, list rows were keyed by array
   * index, which collides on role changes (e.g., the streaming bubble's
   * replace-vs-append flip in `upsertStreamingBot`) and causes React to
   * reuse the wrong DOM node + state across renders. Generated locally
   * via a monotonic counter so server round-trips aren't required.
   */
  id: string;
  kind: 'divider' | 'user' | 'bot';
  label?: string;
  text?: string;
  paras?: ReactNode[];
  chips?: string[];
  // SCRUM — when a turn fails before any reply was streamed, the optimistic
  // user bubble is marked unsent and offered for retry. retryText is the
  // original prompt so the user can resend with one click.
  unsent?: boolean;
  retryText?: string;
}

let nextItemId = 0;
function newItemId(): string {
  nextItemId += 1;
  return `ci-${nextItemId.toString(36)}`;
}

function SessionsRail({
  hidden,
  past,
  currentTitle,
  onOpen,
}: {
  hidden: boolean;
  past: SessionSummary[];
  currentTitle: string;
  onOpen: (id: string) => void;
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
        <button key={s.id} type="button" className="ch-rail-row" onClick={() => onOpen(s.id)}>
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
  openSessionId?: string | null;
  /**
   * Switch to a different session while the chat view is mounted.
   * Shell.tsx owns openSessionId; the in-chat sidebar/drawer calls this so
   * a row click navigates without leaving the chat phase.
   */
  onOpenSession?: (id: string) => void;
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
  openSessionId,
  onOpenSession,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>(() => [
    { id: newItemId(), kind: 'divider', label: dividerLabel() },
  ]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState('Tonight’s session');
  const [pastSessions, setPastSessions] = useState<SessionSummary[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [privateMode, setPrivateMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seedRef = useRef(seed);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // SCRUM — persist the active session id across page refreshes so reloading
  // mid-conversation rehydrates the transcript rather than landing in an
  // empty new chat. Shell reads ACTIVE_SESSION_KEY in routeAuthed.
  useEffect(() => {
    if (sessionId === null) {
      sessionStorage.removeItem('hogaan.activeSessionId');
    } else {
      sessionStorage.setItem('hogaan.activeSessionId', sessionId);
    }
  }, [sessionId]);

  // Pull real past sessions for the sidebar/drawer; refresh after each turn
  // so a freshly-generated session title appears without a page reload.
  const reloadPast = async () => {
    try {
      // Sidebar/drawer: pull a generous page so the recent-sessions list
      // stays populated. Pagination (Sessions phase) uses the default 20.
      const resp = await api.sessions.list({ limit: 100 });
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
    if (!openSessionId) return;
    void (async () => {
      try {
        const detail = await api.sessions.get(openSessionId);
        setSessionId(detail.session.id);
        if (detail.session.title) setCurrentTitle(detail.session.title);
        const hydrated: ChatItem[] = [{ id: newItemId(), kind: 'divider', label: dividerLabel() }];
        for (const t of detail.turns) {
          // Use the persisted turn id as a stable key for the user bubble;
          // the assistant bubble keys off a derived suffix so each pair has
          // distinct ids without collisions across turns.
          hydrated.push({ id: `turn-${t.id}-u`, kind: 'user', text: t.userMessage });
          if (t.responseText) {
            const r = renderResponse(t.responseText);
            hydrated.push({
              id: `turn-${t.id}-b`,
              kind: 'bot',
              paras: r.paras,
              chips: r.chips,
            });
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
    const userItemId = newItemId();
    setItems((prev) => [...prev, { id: userItemId, kind: 'user', text: t }]);
    setDraft('');
    setThinking(true);

    // Streaming bot bubble. The upsert reads the items array to decide
    // append vs. replace — no closure boolean (StrictMode double-invokes
    // setState updaters in dev, which mutates closure state out from
    // under us). Append iff the last item is not the bot bubble we're
    // streaming into; otherwise replace.
    let streamingText = '';
    let receivedDeltas = false;
    // Stable id for the streaming bot bubble — so the replace-in-place
    // path uses the same React key as the original append, and so a
    // mid-stream error that replaces this bubble with the error copy
    // doesn't change the row's identity.
    const botItemId = newItemId();
    const upsertStreamingBot = (text: string) => {
      const r = renderResponse(text);
      setItems((prev) => {
        const lastIdx = prev.length - 1;
        if (lastIdx >= 0 && prev[lastIdx].kind === 'bot') {
          const next = prev.slice();
          next[lastIdx] = {
            ...prev[lastIdx],
            id: prev[lastIdx].id,
            kind: 'bot',
            paras: r.paras,
            chips: r.chips,
          };
          return next;
        }
        return [...prev, { id: botItemId, kind: 'bot', paras: r.paras, chips: r.chips }];
      });
    };

    try {
      for await (const ev of api.turnStream({
        message: t,
        ...(sessionId !== null ? { sessionId } : {}),
        private: privateMode,
      })) {
        if (ev.type === 'start') {
          // SSE stream is OPEN but no tokens have arrived yet. The
          // pre-fix code dropped the thinking spinner here, opening a
          // visible gap between the spinner vanishing and the first
          // `delta` arriving — the chat-bubble-disappears bug. Keep the
          // spinner up until the first real token streams in.
          setSessionId(ev.sessionId);
        } else if (ev.type === 'delta') {
          if (!receivedDeltas) {
            setThinking(false); // first real byte — now safe to drop spinner
          }
          receivedDeltas = true;
          streamingText += ev.text;
          upsertStreamingBot(streamingText);
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        } else if (ev.type === 'end') {
          void reloadPast();
        }
      }
    } catch (err) {
      setThinking(false);
      console.error('stream turn failed', err);
      // SCRUM-F2: when the server provides a friendly message (e.g. 429
      // rate-limit "You've hit today's limit"), surface that verbatim
      // instead of the generic catch-all copy. ApiError carries the
      // message field; any other thrown shape falls back to generic.
      const friendlyMessage =
        err instanceof ApiError && !err.message.startsWith('stream open failed')
          ? err.message
          : "Something went wrong on my side just now. Take a breath and try again - I'm still here.";
      const errorBubbleParas = [<>{friendlyMessage}</>];
      if (receivedDeltas) {
        // Mid-stream failure: replace the partial reply bubble in place
        // rather than appending a second bubble. Preserve its id so React
        // reuses the same DOM node.
        setItems((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx >= 0 && prev[lastIdx].kind === 'bot') {
            const next = prev.slice();
            next[lastIdx] = {
              ...prev[lastIdx],
              kind: 'bot',
              paras: errorBubbleParas,
              chips: [],
            };
            return next;
          }
          return [...prev, { id: newItemId(), kind: 'bot', paras: errorBubbleParas, chips: [] }];
        });
      } else {
        // Pre-first-byte failure: no bot bubble exists yet. Mark the
        // optimistic user bubble as unsent so the user can retry without
        // re-typing, and append the error copy.
        setItems((prev) => {
          const next = prev.slice();
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].kind === 'user' && next[i].text === t) {
              next[i] = { ...next[i], unsent: true, retryText: t };
              break;
            }
          }
          next.push({ id: newItemId(), kind: 'bot', paras: errorBubbleParas, chips: [] });
          return next;
        });
      }
    }
  };

  // SCRUM-54 — explicit "New Chat" reset. Clears the conversation state so
  // the next send carries no sessionId; the server (post-SCRUM-54) treats
  // a missing sessionId as "create a fresh session", which matches the
  // ChatGPT mental model users now expect.
  const startNewChat = () => {
    setSessionId(null);
    setItems([{ id: newItemId(), kind: 'divider', label: dividerLabel() }]);
    setCurrentTitle('Tonight’s session');
    setDraft('');
    setThinking(false);
    setDrawerOpen(false);
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

  return (
    <div className={`ch-page ${privateMode ? 'is-private' : ''}`}>
      <SessionsRail
        hidden={privateMode}
        past={pastSessions}
        currentTitle={currentTitle}
        onOpen={(id) => {
          if (onOpenSession !== undefined) onOpenSession(id);
        }}
      />

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
          <button type="button" className="ch-back" onClick={onBack} aria-label="Back to home">
            <ChatIconBack />
          </button>
          <div className="ch-title-wrap">
            <div className="ch-title">{currentTitle}</div>
            <div className="ch-sub">Practices in focus · {practices.join(', ')}</div>
          </div>
          <button
            type="button"
            className="ch-new-chat"
            onClick={startNewChat}
            aria-label="Start a new chat"
          >
            New Chat
          </button>
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
            {items.map((it) => {
              if (it.kind === 'divider')
                return (
                  <div key={it.id} className="chat-divider">
                    <span>{it.label}</span>
                  </div>
                );
              if (it.kind === 'user')
                return (
                  <div key={it.id} className="chat-row user">
                    <div className={`chat-bubble user ${it.unsent === true ? 'is-unsent' : ''}`}>
                      {it.text}
                    </div>
                    {it.unsent === true && it.retryText !== undefined && (
                      <button
                        type="button"
                        className="chat-retry"
                        onClick={() => void sendText(it.retryText!)}
                        aria-label="Retry sending message"
                      >
                        Not sent · Retry
                      </button>
                    )}
                  </div>
                );
              if (it.kind === 'bot') {
                return (
                  <Fragment key={it.id}>
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
          <textarea
            ref={composerRef}
            className="ch-input"
            placeholder="Type your message…"
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              // Auto-grow up to a 6-line cap; let .ch-input max-height
              // CSS clip beyond that with overflow:auto.
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              // Enter submits; Shift+Enter (and IME composition Enter)
              // inserts a newline. Guard against alt/meta variants too.
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.altKey &&
                !e.metaKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void sendText(draft);
              }
            }}
          />
          <button
            type="button"
            className="ch-send"
            onClick={() => sendText(draft)}
            aria-label="Send"
          >
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
                onClick={() => {
                  setDrawerOpen(false);
                  if (onOpenSession !== undefined) onOpenSession(s.id);
                }}
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
