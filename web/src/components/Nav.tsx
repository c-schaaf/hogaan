// Shared bottom nav (mobile) + desktop sidebar.

import { HogaanWordmark } from './HogaanWordmark';
import { NavIcon } from './Icons';

export type Tab = 'home' | 'sessions' | 'profile';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'profile', label: 'Profile' },
];

interface NavProps {
  active: Tab;
  onNav: (t: Tab) => void;
}

export function BottomNav({ active, onNav }: NavProps) {
  return (
    <nav className="hm-nav">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`hm-nav-tab ${active === t.id ? 'is-active' : ''}`}
          onClick={() => onNav(t.id)}
        >
          <NavIcon name={t.id} active={active === t.id} />
          <span className="hm-nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function DesktopSidebar({ active, onNav }: NavProps) {
  return (
    <aside className="hm-side" aria-label="Primary navigation">
      <div className="hm-side-top">
        <HogaanWordmark small />
      </div>
      <nav className="hm-side-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`hm-side-tab ${active === t.id ? 'is-active' : ''}`}
            onClick={() => onNav(t.id)}
          >
            <NavIcon name={t.id} active={active === t.id} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="hm-side-bottom">
        <div className="hm-side-attr">Hogaan Leadership</div>
      </div>
    </aside>
  );
}
