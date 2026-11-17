// P3.1 — connect the leader's own AI assistant to Hogaan (MCP).
//
// The instructions on this card speak in Hogaan's name and describe another
// company's product (Claude). Wording pending founder review (Hard Rule 2);
// re-check the Claude steps whenever Claude changes its connector screens.
import { useEffect, useState } from 'react';
import { api, type McpConnection, type McpToken } from '../lib/api';
import { useFeatures } from '../lib/features';

/**
 * Claude's "Add custom connector" dialog can be opened with the name and
 * address already filled in. The leader still reviews and confirms it there.
 */
export function claudeAddConnectorUrl(name: string, serverAddress: string): string {
  // encodeURIComponent, not URLSearchParams: a space must be %20, the form
  // Claude's own links use, rather than "+".
  return (
    'https://claude.ai/customize/connectors?modal=add-custom-connector' +
    `&connectorName=${encodeURIComponent(name)}` +
    `&connectorUrl=${encodeURIComponent(serverAddress)}`
  );
}

export function AssistantConnect() {
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const features = useFeatures();
  const [allowed, setAllowed] = useState(true);
  const [fresh, setFresh] = useState<{ token: string; serverUrl: string } | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () =>
    api.mcp
      .list()
      .then((r) => {
        setTokens(r.tokens);
        setAllowed(r.allowed);
      })
      .catch(() => setError("We couldn't load your connections."));
  const loadConnections = () =>
    api.mcp
      .connections()
      .then((r) => setConnections(r.connections))
      .catch(() => setError("We couldn't load your connections."));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (features.mcpOAuth) void loadConnections();
  }, [features.mcpOAuth]);

  const serverAddress = `${window.location.origin}/mcp`;
  const connectorName = features.demoMode ? 'Hogaan demo' : 'Hogaan';
  const signIn = features.mcpOAuth && allowed;

  const copyAddress = () => {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };
    // Some browsers and app views refuse clipboard access; the address is
    // selectable on the page either way.
    void navigator.clipboard?.writeText(serverAddress).then(done, () => undefined);
  };

  const keyForm = allowed && (
    <div className="ctx-line-edit">
      <input
        className="pr-name-input"
        aria-label="Name this connection"
        placeholder="Name this connection, e.g. My assistant"
        maxLength={60}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button
        type="button"
        className="pr-card-action"
        onClick={() =>
          void api.mcp
            .create(label)
            .then((r) => {
              setFresh({ token: r.token, serverUrl: r.serverUrl });
              setLabel('');
              return load();
            })
            .catch(() => setError("That didn't work. Please try again."))
        }
      >
        {features.mcpOAuth ? 'Create a key' : 'Connect an assistant'}
      </button>
    </div>
  );

  return (
    <section className="pr-card">
      <header className="pr-card-head">
        <h2 className="pr-card-h">Use Hogaan from your AI assistant</h2>
      </header>
      <div className="pr-card-body">
        <p className="pr-card-note">
          If you already use an AI assistant that connects to your calendar and email, you can add
          Hogaan to it. Your assistant can then ask Hogaan to coach you before a meeting, and save
          what you learn back here. Hogaan never stores your inbox or calendar.
        </p>
        {!allowed && (
          <p className="pr-card-note">This is part of the Personal plan. See Plan below.</p>
        )}

        {signIn && (
          <>
            <div className="ac-block">
              <h3 className="ac-h">Connect Claude</h3>
              <p className="ac-sub">claude.ai, desktop and mobile apps</p>
              <a
                className="ac-add"
                href={claudeAddConnectorUrl(connectorName, serverAddress)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Add to Claude
                <span aria-hidden="true"> ↗</span>
              </a>
              <p className="pr-card-note ac-after">
                Claude opens &ldquo;Add custom connector&rdquo; with Hogaan filled in. Choose Add,
                then Connect. A Hogaan page opens: sign in and choose Allow. On Claude&rsquo;s Free
                plan you can add one custom connector. On a Team or Enterprise plan, an Owner adds
                it for everyone.
              </p>
            </div>

            <div className="ac-block">
              <h3 className="ac-h">Or set it up by hand</h3>
              <ol className="ac-steps">
                <li>
                  In claude.ai or the Claude desktop app, open Customize, then Connectors, and
                  choose Add custom connector.
                </li>
                <li>
                  Name it {connectorName} and paste this address.
                  <div className="ac-code">
                    <code>{serverAddress}</code>
                    <button type="button" className="pr-inline" onClick={copyAddress}>
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </li>
                <li>
                  Choose Connect. A Hogaan page opens in your browser: sign in if asked, read what
                  the assistant can do, and choose Allow.
                </li>
              </ol>
            </div>

            <div className="ac-block">
              <h3 className="ac-h">Good to know</h3>
              <ul className="ac-notes">
                <li>
                  Add the connector on the web or in the desktop app first. It then works in the
                  Claude mobile apps too.
                </li>
                <li>
                  Other assistants that accept a custom connector (a remote MCP server) can use the
                  same address.
                </li>
                <li>You can disconnect an assistant here at any time.</li>
                {features.demoMode && (
                  <li>
                    Demo: you connect as the sample leader. If the page asks for an access code, it
                    is the one at the end of your demo link.
                  </li>
                )}
              </ul>
            </div>

            <div className="ac-block">
              <h3 className="ac-h">Connected assistants</h3>
              {connections.length === 0 && (
                <p className="pr-card-note">None yet. They appear here once you choose Allow.</p>
              )}
            </div>
          </>
        )}

        {connections.map((c) => (
          <div className="pr-field" key={c.id}>
            <div className="pr-field-label">{c.clientName}</div>
            <div className="pr-field-value" style={{ gap: 8 }}>
              <span className="mo-when">
                {`Signed in from ${c.redirectHost} · `}
                {c.lastUsedAt !== null
                  ? `last used ${new Date(c.lastUsedAt).toLocaleDateString()}`
                  : 'not used yet'}
              </span>
              <button
                type="button"
                className="pr-inline"
                onClick={() => void api.mcp.disconnect(c.id).then(loadConnections)}
              >
                Disconnect
              </button>
            </div>
          </div>
        ))}

        {fresh !== null && (
          <div className="demo-mail" style={{ marginBottom: 8 }}>
            {'Copy this now. It will not be shown again.\n\n'}
            {`Server URL: ${fresh.serverUrl}\nAuthorization header: Bearer ${fresh.token}\n\n`}
            {
              'In your assistant, add a custom connector (remote MCP server) with this URL and header.'
            }
          </div>
        )}
        {tokens.map((t) => (
          <div className="pr-field" key={t.id}>
            <div className="pr-field-label">{t.label}</div>
            <div className="pr-field-value" style={{ gap: 8 }}>
              <span className="mo-when">
                {t.lastUsedAt !== null
                  ? `Last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                  : 'Not used yet'}
              </span>
              <button
                type="button"
                className="pr-inline"
                onClick={() => void api.mcp.revoke(t.id).then(load)}
              >
                Disconnect
              </button>
            </div>
          </div>
        ))}

        {features.mcpOAuth && allowed ? (
          <details className="ac-block ac-keys">
            <summary>My assistant can&rsquo;t sign in this way</summary>
            <p className="pr-card-note ac-after">
              Some assistants ask for a key instead of opening a sign-in page. Create one here and
              paste it where your assistant asks for it. Treat it like a password.
            </p>
            {keyForm}
          </details>
        ) : (
          keyForm
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
