// Shared bottom nav (mobile) + desktop sidebar.

import { useFeatures } from '../lib/features';
import { HogaanWordmark } from './HogaanWordmark';
import { NavIcon } from './Icons';

export type Tab = 'home' | 'sessions' | 'moments' | 'profile';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'moments', label: 'Moments' },
  { id: 'profile', label: 'Profile' },
];

/** Moments only appears in the nav when that feature is switched on. */
function useTabs(): { id: Tab; label: string }[] {
  const { moments } = useFeatures();
  return moments ? TABS : TABS.filter((t) => t.id !== 'moments');
}

interface NavProps {
  active: Tab;
  onNav: (t: Tab) => void;
}

export function BottomNav({ active, onNav }: NavProps) {
  const tabs = useTabs();
  return (
    <nav className="hm-nav" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
      {tabs.map((t) => (
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
  const tabs = useTabs();
  return (
    <aside className="hm-side" aria-label="Primary navigation">
      <div className="hm-side-top">
        <HogaanWordmark small />
      </div>
      <nav className="hm-side-nav">
        {tabs.map((t) => (
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
