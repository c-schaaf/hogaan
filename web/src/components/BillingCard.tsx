// P4 — the leader's plan: Free / Personal / Sponsored, usage, upgrade, manage.
import { useEffect, useState } from 'react';
import { api, type Billing } from '../lib/api';

const PLAN_LABEL: Record<Billing['plan'], string> = {
  free: 'Free',
  personal: 'Personal',
  sponsored: 'Sponsored seat',
};

export function BillingCard({ onChange }: { onChange?: (b: Billing) => void }) {
  const [b, setB] = useState<Billing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (x: Billing) => {
    setB(x);
    onChange?.(x);
  };
  useEffect(() => {
    api.billing
      .get()
      .then(apply)
      .catch(() => setError("We couldn't load your plan."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upgrade = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.billing.checkout();
      if (r.url !== undefined) {
        window.location.href = r.url;
        return;
      }
      apply(await api.billing.demo('subscribe'));
    } catch {
      setError("Upgrading didn't work just now. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const manage = async () => {
    setBusy(true);
    try {
      const r = await api.billing.portal();
      if (r.url !== undefined) {
        window.location.href = r.url;
        return;
      }
      apply(await api.billing.demo('cancel'));
    } catch {
      setError("That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (b === null) return null;
  return (
    <section className="pr-card">
      <header className="pr-card-head">
        <h2 className="pr-card-h">Plan</h2>
      </header>
      <div className="pr-card-body">
        <div className="pr-field">
          <div className="pr-field-label">Current plan</div>
          <div className="pr-field-value">
            <span>
              {PLAN_LABEL[b.plan]}
              {b.cancelAtPeriodEnd && b.currentPeriodEnd !== null
                ? ` · ends ${new Date(b.currentPeriodEnd).toLocaleDateString()}`
                : ''}
            </span>
          </div>
        </div>
        {b.plan === 'free' && (
          <>
            <p className="pr-card-note">
              Free includes the same coach and the same memory. You have used{' '}
              {b.sessionsUsedThisMonth} of {b.sessionLimit ?? 3} new sessions this month. Personal (
              {b.priceLabel}) adds unlimited sessions, follow-up check-ins after your conversations,
              and using Hogaan from your own AI assistant.
            </p>
            <button
              type="button"
              className="pr-card-action"
              disabled={busy}
              onClick={() => void upgrade()}
            >
              {b.demo ? 'Upgrade to Personal (demo, no payment)' : 'Upgrade to Personal'}
            </button>
          </>
        )}
        {b.plan === 'personal' && (
          <button type="button" className="pr-inline" disabled={busy} onClick={() => void manage()}>
            {b.demo ? 'Cancel plan (demo)' : 'Manage or cancel'}
          </button>
        )}
        {b.plan === 'sponsored' && (
          <p className="pr-card-note">Your seat is funded by your program sponsor.</p>
        )}
        {error !== null && (
          <div role="alert" style={{ marginTop: 6, fontSize: 12, color: '#c0392b' }}>
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
