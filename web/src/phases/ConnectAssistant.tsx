// P3.1b — "Sign in with Hogaan": the consent screen an AI assistant sends a
// leader to. The leader is already signed in to Hogaan (the app shell makes
// sure of that before showing this page).
//
// FOUNDER REVIEW: the wording on this screen speaks in Hogaan's name and is
// an engineering placeholder (Hard Rule 2). Marked in the build report.
import { useEffect, useState } from 'react';
import { Card, ErrorLine, PageFrame } from '../components/PageFrame';
import type { Tab } from '../components/Nav';
import { api, ApiError, type OAuthRequestView } from '../lib/api';

const STORAGE_KEY = 'hogaan.oauthRequest';

/** The signed request from the address, kept across a sign-in detour. */
export function readOAuthRequest(): string | null {
  const fromUrl = new URL(window.location.href).searchParams.get('req');
  try {
    if (fromUrl !== null) sessionStorage.setItem(STORAGE_KEY, fromUrl);
    return fromUrl ?? sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return fromUrl;
  }
}

function forget() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

const CAN = [
  'Read what Hogaan knows about you and your upcoming moments',
  'Ask Hogaan to coach you on a situation',
  'Save moments, reflections and notes to your Hogaan account',
];
const CANNOT = [
  'See your password or sign in to Hogaan as you',
  'Change your plan, profile or account settings',
];

export function ConnectAssistant({
  onNav,
  onDone,
}: {
  onNav: (t: Tab) => void;
  onDone: () => void;
}) {
  const [req] = useState<string | null>(() => readOAuthRequest());
  const [view, setView] = useState<OAuthRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (req === null) {
      setError('This link is incomplete. Go back to your assistant and connect again.');
      return;
    }
    api.oauth
      .request(req)
      .then(setView)
      .catch(() =>
        setError('This request has expired. Go back to your assistant and connect again.'),
      );
  }, [req]);

  const decide = (approve: boolean) => {
    if (req === null) return;
    setBusy(true);
    api.oauth
      .consent(req, approve)
      .then((r) => {
        forget();
        window.location.assign(r.redirectTo);
      })
      .catch((err: unknown) => {
        setBusy(false);
        setError(
          err instanceof ApiError && err.status === 402
            ? 'Using Hogaan from an AI assistant is part of the Personal plan. See Plan on your Profile.'
            : "That didn't work. Please try again.",
        );
      });
  };

  return (
    <PageFrame
      title="Connect an assistant"
      subtitle="An AI assistant is asking to use Hogaan for you."
      active="profile"
      onNav={onNav}
      onBack={() => {
        forget();
        onDone();
      }}
      backLabel="Profile"
    >
      <ErrorLine message={error} />
      {view !== null && (
        <Card title={view.clientName}>
          <p className="pr-card-note">
            <strong>{view.clientName}</strong> wants to connect to your Hogaan account. If you allow
            it, you will be sent back to <strong>{view.returnsTo}</strong>
            {view.publishedBy !== null && view.publishedBy !== view.returnsTo
              ? `, and the assistant is published by ${view.publishedBy}`
              : ''}
            .
          </p>
          {!view.nameVerified && (
            <p className="pr-card-note">
              Hogaan cannot confirm this name: the assistant chose it itself. Check the address
              above: <strong>{view.returnsTo}</strong> is where you will be sent. Only allow it if
              that is the assistant you meant to connect.
            </p>
          )}
          {view.localApp && (
            <p className="pr-card-note">
              This assistant runs on a computer, not on a website. Only allow it if you started this
              connection yourself.
            </p>
          )}
          <p className="pr-card-note">It will be able to:</p>
          <ul className="pr-card-note">
            {CAN.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="pr-card-note">It will not be able to:</p>
          <ul className="pr-card-note">
            {CANNOT.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="pr-card-note">
            You can disconnect it any time on your Profile, under “Use Hogaan from your AI
            assistant”.
          </p>
          {view.allowed ? (
            <div className="ctx-line-edit">
              <button
                type="button"
                className="pr-card-action"
                disabled={busy}
                onClick={() => decide(true)}
              >
                Allow
              </button>
              <button
                type="button"
                className="pr-inline"
                disabled={busy}
                onClick={() => decide(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <p className="pr-card-note">
                Using Hogaan from an AI assistant is part of the Personal plan. See Plan on your
                Profile.
              </p>
              <button
                type="button"
                className="pr-inline"
                disabled={busy}
                onClick={() => decide(false)}
              >
                Cancel and go back
              </button>
            </>
          )}
        </Card>
      )}
    </PageFrame>
  );
}
