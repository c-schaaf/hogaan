/**
 * SCRUM — render-time fallback used by main.tsx when supabase.ts reports a
 * missing-env failure. Lives in its own component so the auth client module
 * can stay JSX-free.
 */
export function ConfigErrorScreen({ message }: { message: string }): JSX.Element {
  return (
    <div
      role="alert"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#fff',
        color: '#111',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>Hogaan can't start.</h1>
        <p style={{ color: '#555', lineHeight: 1.5, margin: 0 }}>{message}</p>
      </div>
    </div>
  );
}
