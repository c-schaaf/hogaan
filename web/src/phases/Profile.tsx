import { useEffect, useState, type ReactNode } from 'react';
import { HogaanWordmark } from '../components/HogaanWordmark';
import { PrIconEdit } from '../components/Icons';
import { BottomNav, DesktopSidebar, type Tab } from '../components/Nav';
import { api, type Billing, type Prefs } from '../lib/api';
import { BillingCard } from '../components/BillingCard';
import { useFeatures } from '../lib/features';
import { AssistantConnect } from '../components/AssistantConnect';
import { TWELVE_PRACTICES } from './onboarding/data';

interface CardProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

function ProfileCard({ title, children, action }: CardProps) {
  return (
    <section className="pr-card">
      <header className="pr-card-head">
        <h2 className="pr-card-h">{title}</h2>
        {action}
      </header>
      <div className="pr-card-body">{children}</div>
    </section>
  );
}

function FieldRow({ label, value, action }: { label: string; value: string; action?: ReactNode }) {
  return (
    <div className="pr-field">
      <div className="pr-field-label">{label}</div>
      <div className="pr-field-value">
        <span>{value}</span>
        {action}
      </div>
    </div>
  );
}

function InlineButton({
  children,
  icon,
  onClick,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="pr-inline" onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

function PracticesView({
  selected,
  editing,
  onToggle,
}: {
  selected: string[];
  editing: boolean;
  onToggle?: (p: string) => void;
}) {
  const set = new Set(selected);
  return (
    <div className="pr-prac">
      {TWELVE_PRACTICES.map((g) => (
        <div key={g.level} className="pr-prac-row">
          <div className="pr-prac-level">{g.level}</div>
          <div className="pr-prac-items">
            {g.items.map((p) => {
              const isOn = set.has(p);
              if (editing) {
                return (
                  <button
                    key={p}
                    type="button"
                    className={`pr-prac-pill ${isOn ? 'is-on' : ''}`}
                    onClick={() => onToggle?.(p)}
                    style={{ cursor: 'pointer', font: 'inherit' }}
                  >
                    {isOn && <span className="pr-prac-dot" />}
                    {p}
                  </button>
                );
              }
              return (
                <span key={p} className={`pr-prac-pill ${isOn ? 'is-on' : ''}`}>
                  {isOn && <span className="pr-prac-dot" />}
                  {p}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// P2.2 / P2.6 — explicit opt-in for proactive email (D4).
function EmailCheckIns({
  followUp,
  nudge,
  followUpsIncluded,
}: {
  followUp: boolean;
  nudge: boolean;
  followUpsIncluded: boolean;
}) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.preferences
      .get()
      .then(setPrefs)
      .catch(() => setError("We couldn't load your email settings."));
  }, []);
  const toggle = (key: 'followupEmailOptIn' | 'weeklyNudgeOptIn', value: boolean) => {
    api.preferences
      .patch({ [key]: value })
      .then(setPrefs)
      .catch(() => setError("That didn't save. Please try again."));
  };
  return (
    <ProfileCard title="Email check-ins">
      <p className="pr-card-note">
        Off unless you turn them on. At most two emails a week, never at night in your timezone, and
        every email has a one-click unsubscribe.
      </p>
      {prefs !== null && followUp && (
        <label className="pr-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={prefs.followupEmailOptIn}
            onChange={(e) => toggle('followupEmailOptIn', e.target.checked)}
          />
          <span>After a conversation you prepared for, ask me how it went</span>
        </label>
      )}
      {prefs !== null && followUp && !followUpsIncluded && (
        <p className="pr-card-note">
          Follow-up check-ins are part of the Personal plan. You can turn this on now; emails start
          when you upgrade (see Plan).
        </p>
      )}
      {prefs !== null && nudge && (
        <label className="pr-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={prefs.weeklyNudgeOptIn}
            onChange={(e) => toggle('weeklyNudgeOptIn', e.target.checked)}
          />
          <span>Send me one reflection question each week</span>
        </label>
      )}
      {error !== null && (
        <div role="alert" style={{ marginTop: 6, fontSize: 12, color: '#c0392b' }}>
          {error}
        </div>
      )}
    </ProfileCard>
  );
}

interface Props {
  user: { name: string; email: string };
  practices?: string[];
  onSignOut: () => void;
  onNav: (t: Tab) => void;
  /** P1.3 — open "What Hogaan knows about you". */
  onOpenContext?: () => void;
  /** P2.1 — open Moments. */
  onOpenMoments?: () => void;
}

export function Profile({
  user,
  practices = [],
  onSignOut,
  onNav,
  onOpenContext,
  onOpenMoments,
}: Props) {
  const features = useFeatures();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [fullName, setFullName] = useState(user.name || '');
  const [email, setEmail] = useState(user.email || '');
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(user.name || '');
  const [savingName, setSavingName] = useState(false);
  const [livePractices, setLivePractices] = useState<string[]>(practices);
  const [editingPractices, setEditingPractices] = useState(false);
  const [draftPractices, setDraftPractices] = useState<string[]>(practices);
  const [savingPractices, setSavingPractices] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [practicesError, setPracticesError] = useState<string | null>(null);

  // Hydrate from /api/profile on mount so the page reflects what the
  // server actually has (in case the in-memory `me` from Shell is stale).
  useEffect(() => {
    void (async () => {
      try {
        const p = await api.profile.get();
        if (p.fullName) setFullName(p.fullName);
        if (p.email) setEmail(p.email);
        if (p.mappedPractices.length > 0) {
          setLivePractices(p.mappedPractices);
          setDraftPractices(p.mappedPractices);
        }
      } catch (err) {
        console.error('profile fetch failed', err);
      }
    })();
  }, []);

  const togglePracticeDraft = (p: string) => {
    setDraftPractices((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const savePractices = async () => {
    setSavingPractices(true);
    setPracticesError(null);
    try {
      await api.profile.patch({ mappedPractices: draftPractices });
      setLivePractices(draftPractices);
      setEditingPractices(false);
    } catch (err) {
      console.error('save practices failed', err);
      setPracticesError("We couldn't save your practices. Please try again.");
    } finally {
      setSavingPractices(false);
    }
  };

  const cancelEditingPractices = () => {
    setDraftPractices(livePractices);
    setPracticesError(null);
    setEditingPractices(false);
  };

  const saveName = async () => {
    setSavingName(true);
    setNameError(null);
    try {
      await api.profile.patch({ fullName: draftName });
      setFullName(draftName);
      setEditingName(false);
    } catch (err) {
      console.error('save name failed', err);
      setNameError("We couldn't save your name. Please try again.");
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="pr-page">
      <DesktopSidebar active="profile" onNav={onNav} />
      <main className="pr-shell">
        <div className="pr-topbar">
          <HogaanWordmark small />
        </div>

        <div className="pr-scroll">
          <div className="pr-inner">
            <header className="pr-head">
              <h1 className="pr-h">Profile</h1>
              <p className="pr-sub">Your account, your practices, how Hogaan shows up.</p>
            </header>

            <div className="pr-grid">
              <div className="pr-col pr-col--main">
                <ProfileCard title="Account">
                  {editingName ? (
                    <div className="pr-field">
                      <div className="pr-field-label">Full name</div>
                      <div className="pr-field-value" style={{ gap: 8 }}>
                        <input
                          className="pr-name-input"
                          value={draftName}
                          maxLength={200}
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveName();
                            if (e.key === 'Escape') {
                              setDraftName(fullName);
                              setNameError(null);
                              setEditingName(false);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="pr-card-action"
                          onClick={() => void saveName()}
                          disabled={savingName}
                        >
                          {savingName ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="pr-card-action"
                          style={{ background: 'transparent', color: 'var(--ink-2)' }}
                          onClick={() => {
                            setDraftName(fullName);
                            setNameError(null);
                            setEditingName(false);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                      {nameError !== null && (
                        <div
                          role="alert"
                          style={{
                            marginTop: 6,
                            fontSize: 12,
                            color: '#c0392b',
                          }}
                        >
                          {nameError}
                        </div>
                      )}
                    </div>
                  ) : (
                    <FieldRow
                      label="Full name"
                      value={fullName}
                      action={
                        <InlineButton
                          icon={<PrIconEdit />}
                          onClick={() => {
                            setDraftName(fullName);
                            setEditingName(true);
                          }}
                        >
                          Edit
                        </InlineButton>
                      }
                    />
                  )}
                  {/* SCRUM — Email change flow is not yet wired (no Supabase
                      updateUser call) so the previous "Change" button was a
                      dead control. Removed until the flow ships. */}
                  <FieldRow label="Email" value={email} />
                  <div className="pr-account-out">
                    <button type="button" className="pr-signout" onClick={onSignOut}>
                      Sign out
                    </button>
                  </div>
                </ProfileCard>

                <ProfileCard
                  title="Your practices"
                  action={
                    editingPractices ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="pr-card-action"
                          onClick={cancelEditingPractices}
                          disabled={savingPractices}
                          style={{ background: 'transparent', color: 'var(--ink-2)' }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="pr-card-action"
                          onClick={() => void savePractices()}
                          disabled={savingPractices}
                        >
                          {savingPractices ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="pr-card-action"
                        onClick={() => {
                          setDraftPractices(livePractices);
                          setEditingPractices(true);
                        }}
                      >
                        Update practices
                      </button>
                    )
                  }
                >
                  <p className="pr-card-note">
                    {editingPractices
                      ? 'Tap any practice to add or remove it. Pick as many as resonate.'
                      : 'Hogaan listens through these first. Your current focus:'}
                  </p>
                  <PracticesView
                    selected={editingPractices ? draftPractices : livePractices}
                    editing={editingPractices}
                    onToggle={togglePracticeDraft}
                  />
                  {practicesError !== null && (
                    <div
                      role="alert"
                      style={{
                        marginTop: 8,
                        fontSize: 12,
                        color: '#c0392b',
                      }}
                    >
                      {practicesError}
                    </div>
                  )}
                </ProfileCard>

                {features.leaderBrief && onOpenContext !== undefined && (
                  <ProfileCard
                    title="What Hogaan knows about you"
                    action={
                      <button type="button" className="pr-card-action" onClick={onOpenContext}>
                        View and edit
                      </button>
                    }
                  >
                    <p className="pr-card-note">
                      Your role, team, goals and notes from past conversations. Only used to coach
                      you. You can change or delete any of it.
                    </p>
                  </ProfileCard>
                )}

                {features.moments && onOpenMoments !== undefined && (
                  <ProfileCard
                    title="Moments"
                    action={
                      <button type="button" className="pr-card-action" onClick={onOpenMoments}>
                        Open
                      </button>
                    }
                  >
                    <p className="pr-card-note">
                      Conversations you are preparing for, and your reflections afterwards.
                    </p>
                  </ProfileCard>
                )}

                {(features.followUpEmail || features.weeklyNudge) && (
                  <EmailCheckIns
                    followUp={features.followUpEmail}
                    nudge={features.weeklyNudge}
                    followUpsIncluded={billing === null || billing.capabilities.followUps}
                  />
                )}

                {features.billing && <BillingCard onChange={setBilling} />}

                {features.mcp && <AssistantConnect key={billing?.plan ?? 'none'} />}

                <ProfileCard title="Support">
                  <div className="pr-sup">
                    <div className="pr-sup-row">
                      <span className="pr-sup-label">Contact</span>
                      <a className="pr-sup-link" href="mailto:hamse24@gmail.com">
                        hamse24@gmail.com
                      </a>
                    </div>
                    <div className="pr-sup-row">
                      <span className="pr-sup-label">Legal</span>
                      <span className="pr-sup-legal">
                        <a className="pr-sup-link" href="#" onClick={(e) => e.preventDefault()}>
                          Terms
                        </a>
                        <span className="pr-sup-sep">·</span>
                        <a className="pr-sup-link" href="#" onClick={(e) => e.preventDefault()}>
                          Privacy Policy
                        </a>
                      </span>
                    </div>
                  </div>
                </ProfileCard>
              </div>

              <div className="pr-col pr-col--side">
                <ProfileCard title="About Hogaan">
                  <p className="pr-about-body">
                    Leadership coaching grounded in the 12 Practices of Transformational Leadership
                    — built to meet you in the moments that matter, not the ones you've already
                    figured out.
                  </p>
                  <div className="pr-about-stat">
                    <div className="pr-about-stat-num">{livePractices.length}</div>
                    <div className="pr-about-stat-label">
                      {livePractices.length === 1 ? 'practice in focus' : 'practices in focus'}
                    </div>
                  </div>
                </ProfileCard>

                <footer className="pr-foot">
                  <div className="pr-foot-ver">Hogaan · v0.4.0</div>
                </footer>
              </div>
            </div>

            <div className="pr-foot-space" />
          </div>
        </div>

        <BottomNav active="profile" onNav={onNav} />
      </main>
    </div>
  );
}
