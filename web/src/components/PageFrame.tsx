// Shared page chrome for the newer pages (same layout classes as Profile).
import type { ReactNode } from 'react';
import { HogaanWordmark } from './HogaanWordmark';
import { BottomNav, DesktopSidebar, type Tab } from './Nav';

interface Props {
  title: string;
  subtitle?: string;
  active: Tab;
  onNav: (t: Tab) => void;
  onBack?: () => void;
  backLabel?: string;
  children: ReactNode;
}

export function PageFrame({ title, subtitle, active, onNav, onBack, backLabel, children }: Props) {
  return (
    <div className="pr-page">
      <DesktopSidebar active={active} onNav={onNav} />
      <main className="pr-shell">
        <div className="pr-topbar">
          <HogaanWordmark small />
        </div>
        <div className="pr-scroll">
          <div className="pr-inner">
            {onBack !== undefined && (
              <button type="button" className="pr-inline" onClick={onBack}>
                ← {backLabel ?? 'Back'}
              </button>
            )}
            <header className="pr-head">
              <h1 className="pr-h">{title}</h1>
              {subtitle !== undefined && <p className="pr-sub">{subtitle}</p>}
            </header>
            {children}
            <div className="pr-foot-space" />
          </div>
        </div>
        <BottomNav active={active} onNav={onNav} />
      </main>
    </div>
  );
}

export function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="pr-card" style={{ marginBottom: 16 }}>
      <header className="pr-card-head">
        <h2 className="pr-card-h">{title}</h2>
        {action}
      </header>
      <div className="pr-card-body">{children}</div>
    </section>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <div role="alert" style={{ marginTop: 8, fontSize: 12, color: '#c0392b' }}>
      {message}
    </div>
  );
}
