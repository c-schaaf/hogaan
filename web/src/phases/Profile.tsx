import { useEffect, useState, type ReactNode } from 'react';
import { HogaanWordmark } from '../components/HogaanWordmark';
import { PrIconEdit } from '../components/Icons';
import { BottomNav, DesktopSidebar, type Tab } from '../components/Nav';
import { api } from '../lib/api';
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

function InlineButton({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <button type="button" className="pr-inline">
      {icon}
      {children}
    </button>
  );
}

interface RadioOpt<T extends string> {
  id: T;
  title: string;
  sub?: string;
}

function Radio<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: RadioOpt<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="pr-radio" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`pr-radio-opt ${value === o.id ? 'is-on' : ''}`}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
        >
          <span className="pr-radio-title">{o.title}</span>
          {o.sub && <span className="pr-radio-sub">{o.sub}</span>}
        </button>
      ))}
    </div>
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

type CommStyle = 'direct' | 'warm';
type Depth = 'quick' | 'standard' | 'deep';

interface Props {
  user: { name: string; email: string };
  practices?: string[];
  onSignOut: () => void;
  onNav: (t: Tab) => void;
}

export function Profile({ user, practices = [], onSignOut, onNav }: Props) {
  const [style, setStyle] = useState<CommStyle>('warm');
  const [depth, setDepth] = useState<Depth>('standard');
  const [fullName, setFullName] = useState(user.name || '');
  const [email, setEmail] = useState(user.email || '');
  const [livePractices, setLivePractices] = useState<string[]>(practices);
  const [editingPractices, setEditingPractices] = useState(false);
  const [draftPractices, setDraftPractices] = useState<string[]>(practices);
  const [savingPractices, setSavingPractices] = useState(false);

  // Hydrate from /api/profile on mount so the page reflects what the
  // server actually has (in case the in-memory `me` from Shell is stale).
  useEffect(() => {
    void (async () => {
      try {
        const p = await api.profile.get();
        if (p.fullName) setFullName(p.fullName);
        if (p.email) setEmail(p.email);
        if (p.commStyle) setStyle(p.commStyle);
        if (p.responseDepth) setDepth(p.responseDepth);
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
    setDraftPractices((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const savePractices = async () => {
    setSavingPractices(true);
    try {
      await api.profile.patch({ mappedPractices: draftPractices });
      setLivePractices(draftPractices);
      setEditingPractices(false);
    } catch (err) {
      console.error('save practices failed', err);
    } finally {
      setSavingPractices(false);
    }
  };

  const cancelEditingPractices = () => {
    setDraftPractices(livePractices);
    setEditingPractices(false);
  };

  const updateStyle = async (v: CommStyle) => {
    setStyle(v);
    try {
      await api.profile.patch({ commStyle: v });
    } catch (err) {
      console.error('patch commStyle failed', err);
    }
  };
  const updateDepth = async (v: Depth) => {
    setDepth(v);
    try {
      await api.profile.patch({ responseDepth: v });
    } catch (err) {
      console.error('patch responseDepth failed', err);
    }
  };

  // Privacy & data card was removed per 2026-05-12 feedback. The
  // handleDeleteAccount / handleDownload handlers used to live here; the
  // backend endpoints (DELETE /api/profile, /api/sessions list as JSON)
  // remain in case a Settings page surfaces them later.

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
                  <FieldRow
                    label="Full name"
                    value={fullName}
                    action={<InlineButton icon={<PrIconEdit />}>Edit</InlineButton>}
                  />
                  <FieldRow
                    label="Email"
                    value={email}
                    action={<InlineButton icon={<PrIconEdit />}>Change</InlineButton>}
                  />
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
                </ProfileCard>

                <ProfileCard title="How we talk">
                  <div className="pr-subsec">
                    <div className="pr-subsec-h">Communication style</div>
                    <Radio<CommStyle>
                      value={style}
                      onChange={updateStyle}
                      options={[
                        { id: 'direct', title: 'Direct & challenging', sub: 'Push me when I need it.' },
                        { id: 'warm', title: 'Warm & considered', sub: 'Lead with care.' },
                      ]}
                    />
                  </div>
                  <div className="pr-subsec">
                    <div className="pr-subsec-h">Default response depth</div>
                    <Radio<Depth>
                      value={depth}
                      onChange={updateDepth}
                      options={[
                        { id: 'quick', title: 'Quick' },
                        { id: 'standard', title: 'Standard' },
                        { id: 'deep', title: 'Deep' },
                      ]}
                    />
                  </div>
                </ProfileCard>
              </div>

              <div className="pr-col pr-col--side">
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

                <footer className="pr-foot">
                  <div className="pr-foot-hw">
                    A <span>Hamse Warfa</span> product
                  </div>
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
