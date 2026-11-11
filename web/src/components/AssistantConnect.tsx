// P3.1 — connect the leader's own AI assistant to Hogaan (MCP).
import { useEffect, useState } from 'react';
import { api, type McpToken } from '../lib/api';

export function AssistantConnect() {
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [fresh, setFresh] = useState<{ token: string; serverUrl: string } | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api.mcp
      .list()
      .then((r) => {
        setTokens(r.tokens);
        setAllowed(r.allowed);
      })
      .catch(() => setError("We couldn't load your connections."));
  useEffect(() => {
    void load();
  }, []);

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
        {allowed && (
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
              Connect an assistant
            </button>
          </div>
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
