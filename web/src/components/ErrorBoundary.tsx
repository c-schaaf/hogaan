import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * SCRUM — the React tree had no error boundary, so a render-time throw
 * anywhere in <Shell> blanked the page for every user. This boundary
 * catches the throw, logs the stack, and renders a recoverable fallback.
 *
 * Sentry is wired server-side only today. When the client SDK lands, the
 * `onCaptureError` hook here is the right wiring point — pass a function
 * that calls `Sentry.captureException(error, { contexts: { react: info } })`.
 */
interface Props {
  children: ReactNode;
  /** Optional Sentry hook. Called from componentDidCatch. */
  onCaptureError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[error-boundary] render-time throw', error, info.componentStack);
    if (this.props.onCaptureError !== undefined) {
      try {
        this.props.onCaptureError(error, info);
      } catch (captureErr) {
        // eslint-disable-next-line no-console
        console.error('[error-boundary] onCaptureError threw', captureErr);
      }
    }
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg, #fff)',
          color: 'var(--ink-1, #111)',
          fontFamily: 'var(--font-b, system-ui)',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1
            style={{
              fontFamily: 'var(--font-h, Georgia, serif)',
              fontSize: 28,
              fontWeight: 500,
              margin: '0 0 12px',
            }}
          >
            Something went wrong on our side.
          </h1>
          <p style={{ color: 'var(--ink-3, #555)', margin: '0 0 24px', lineHeight: 1.5 }}>
            The page hit an error and stopped rendering. Reloading usually clears it. If it keeps
            happening, drop us a line at{' '}
            <a href="mailto:hamse24@gmail.com" style={{ color: 'inherit' }}>
              hamse24@gmail.com
            </a>
            .
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              appearance: 'none',
              border: '1px solid var(--gold, #d4a73a)',
              background: 'transparent',
              color: 'var(--gold-deep, #b6892b)',
              fontFamily: 'inherit',
              fontWeight: 600,
              fontSize: 14,
              padding: '11px 22px',
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
