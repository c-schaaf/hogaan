/**
 * Regression tests for Shell.tsx routing logic.
 *
 * These tests exist specifically because the routing bugs (double routeAuthed
 * fire, SIGNED_IN infinite loop, F5 bounce to Home) were invisible to the
 * existing test suite — which covered only the backend. Each test below maps
 * to a bug that was found by the CU audit agent and fixed on this branch.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../Shell';

// vi.mock factories are hoisted before const declarations. Variables referenced
// directly in the factory's returned object must use vi.hoisted(). Variables
// only accessed inside nested vi.fn() callbacks are fine as plain let/const
// because those callbacks run at call-time (not factory-eval time).
const mockProfileGet = vi.hoisted(() => vi.fn());

// Capture the auth callback so tests can fire Supabase auth events manually.
// Plain let is safe here: authRef.cb is assigned inside vi.fn's implementation,
// which runs when onAuthStateChange() is called (test time), not factory time.
type AuthCb = (event: string, session: { access_token: string } | null) => void;
let fireAuth: AuthCb = () => {};

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((cb: AuthCb) => {
        fireAuth = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../lib/api', () => ({
  api: {
    profile: { get: mockProfileGet, patch: vi.fn().mockResolvedValue({}) },
    sessions: { list: vi.fn().mockResolvedValue({ sessions: [] }) },
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(msg: string, s: number) {
      super(msg);
      this.status = s;
    }
  },
}));

vi.mock('../lib/auth-errors', () => ({ readAuthErrorFromUrl: () => null }));

// Stub all phase components — routing tests only care which phase is active
vi.mock('../phases/Login', () => ({ Login: () => <div data-testid="phase-login" /> }));
vi.mock('../phases/Signup', () => ({ Signup: () => <div data-testid="phase-signup" /> }));
vi.mock('../phases/Home', () => ({
  Home: ({ onNav }: { onNav?: (t: string) => void }) => (
    <div data-testid="phase-home">
      <button data-testid="nav-sessions" onClick={() => onNav?.('sessions')}>
        Sessions
      </button>
      <button data-testid="nav-profile" onClick={() => onNav?.('profile')}>
        Profile
      </button>
    </div>
  ),
}));
vi.mock('../phases/Sessions', () => ({
  Sessions: () => <div data-testid="phase-sessions" />,
}));
vi.mock('../phases/Profile', () => ({ Profile: () => <div data-testid="phase-profile" /> }));
vi.mock('../phases/Chat', () => ({ Chat: () => <div data-testid="phase-chat" /> }));
vi.mock('../phases/Onboarding', () => ({
  Onboarding: () => <div data-testid="phase-onboarding" />,
}));
vi.mock('../phases/EmailVerify', () => ({
  EmailVerify: () => <div data-testid="phase-verify" />,
}));
vi.mock('../phases/Forgot', () => ({ Forgot: () => <div data-testid="phase-forgot" /> }));
vi.mock('../phases/Reset', () => ({ Reset: () => <div data-testid="phase-reset" /> }));

const ONBOARDED_PROFILE = {
  fullName: 'Test User',
  email: 'test@example.com',
  onboarded: true,
  mappedPractices: ['Integrity'],
  commStyle: null,
  responseDepth: null,
};

beforeEach(() => {
  sessionStorage.clear();
  // Reset jsdom URL — replaceState() persists across tests otherwise, and the
  // production Shell.tsx writes /sessions, /profile to the URL when phase changes.
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks(); // reset call counts; preserves mock implementations
  mockProfileGet.mockResolvedValue(ONBOARDED_PROFILE);
});

describe('boot deduplication', () => {
  it('calls routeAuthed exactly once when INITIAL_SESSION fires', async () => {
    render(<Shell />);

    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });

    await waitFor(() => expect(mockProfileGet).toHaveBeenCalledTimes(1));

    // Wait an extra tick to confirm no second call arrives
    await new Promise((r) => setTimeout(r, 50));
    expect(mockProfileGet).toHaveBeenCalledTimes(1);
  });

  it('does not call routeAuthed a second time when SIGNED_IN fires with the same token', async () => {
    render(<Shell />);

    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });
    await waitFor(() => expect(mockProfileGet).toHaveBeenCalledTimes(1));

    act(() => {
      fireAuth('SIGNED_IN', { access_token: 'tok-1' }); // same token → deduplicated
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockProfileGet).toHaveBeenCalledTimes(1);
  });
});

describe('SIGNED_IN loop prevention', () => {
  it('ignores SIGNED_IN events once the user is on an authed page', async () => {
    render(<Shell />);

    // Boot → home
    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });
    await waitFor(() => screen.getByTestId('phase-home'));

    const callsBefore = mockProfileGet.mock.calls.length;

    // Background token refresh fires SIGNED_IN with a fresh token
    act(() => {
      fireAuth('SIGNED_IN', { access_token: 'tok-2' });
    });
    await new Promise((r) => setTimeout(r, 50));

    // Guard must block re-routing — this was the infinite loop bug
    expect(mockProfileGet).toHaveBeenCalledTimes(callsBefore);
  });
});

describe('F5 phase restore', () => {
  it('returns to the sessionStorage phase instead of Home on reload', async () => {
    sessionStorage.setItem('shell-phase', 'sessions');
    render(<Shell />);

    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });

    await waitFor(() => screen.getByTestId('phase-sessions'));
  });

  it('restores to profile page saved in sessionStorage', async () => {
    sessionStorage.setItem('shell-phase', 'profile');
    render(<Shell />);

    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });

    await waitFor(() => screen.getByTestId('phase-profile'));
  });

  it('navigating to sessions via onNav writes sessions to sessionStorage', async () => {
    render(<Shell />);
    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });
    await waitFor(() => screen.getByTestId('phase-home'));

    fireEvent.click(screen.getByTestId('nav-sessions'));

    await waitFor(() => expect(sessionStorage.getItem('shell-phase')).toBe('sessions'));
  });

  it('navigating to profile via onNav writes profile to sessionStorage', async () => {
    render(<Shell />);
    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });
    await waitFor(() => screen.getByTestId('phase-home'));

    fireEvent.click(screen.getByTestId('nav-profile'));

    await waitFor(() => expect(sessionStorage.getItem('shell-phase')).toBe('profile'));
  });

  it('full cycle: nav to sessions → remount → restores sessions (not home)', async () => {
    // Step 1: land on home, navigate to sessions
    const { unmount } = render(<Shell />);
    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });
    await waitFor(() => screen.getByTestId('phase-home'));

    fireEvent.click(screen.getByTestId('nav-sessions'));
    await waitFor(() => screen.getByTestId('phase-sessions'));

    // sessionStorage must have been written by the time phase renders
    expect(sessionStorage.getItem('shell-phase')).toBe('sessions');

    // Step 2: simulate F5 — unmount without clearing sessionStorage, then remount
    unmount();
    render(<Shell />);
    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-2' });
    });

    // Must land on sessions, not home
    await waitFor(() => screen.getByTestId('phase-sessions'));
    expect(screen.queryByTestId('phase-home')).toBeNull();
  });

  it('full cycle: nav to profile → remount → restores profile (not home)', async () => {
    const { unmount } = render(<Shell />);
    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });
    await waitFor(() => screen.getByTestId('phase-home'));

    fireEvent.click(screen.getByTestId('nav-profile'));
    await waitFor(() => screen.getByTestId('phase-profile'));

    expect(sessionStorage.getItem('shell-phase')).toBe('profile');

    unmount();
    render(<Shell />);
    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-2' });
    });

    await waitFor(() => screen.getByTestId('phase-profile'));
    expect(screen.queryByTestId('phase-home')).toBeNull();
  });

  it('concurrent SIGNED_IN during routeAuthed does not reset phase to home', async () => {
    render(<Shell />);
    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });
    await waitFor(() => screen.getByTestId('phase-home'));

    fireEvent.click(screen.getByTestId('nav-sessions'));
    await waitFor(() => screen.getByTestId('phase-sessions'));

    // Simulate a background token refresh firing SIGNED_IN with new token
    act(() => {
      fireAuth('SIGNED_IN', { access_token: 'tok-new' });
    });
    await new Promise((r) => setTimeout(r, 80));

    // Must stay on sessions, not bounce to home
    expect(screen.getByTestId('phase-sessions')).toBeTruthy();
    expect(screen.queryByTestId('phase-home')).toBeNull();
  });
});

describe('unauthenticated boot', () => {
  it('shows login when INITIAL_SESSION has no session', async () => {
    render(<Shell />);

    act(() => {
      fireAuth('INITIAL_SESSION', null);
    });

    await waitFor(() => screen.getByTestId('phase-login'));
    expect(mockProfileGet).not.toHaveBeenCalled();
  });
});

describe('SIGNED_OUT routing', () => {
  it('routes to login when SIGNED_OUT event fires while on authed page', async () => {
    render(<Shell />);

    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });
    await waitFor(() => screen.getByTestId('phase-home'));

    act(() => {
      fireAuth('SIGNED_OUT', null);
    });

    await waitFor(() => screen.getByTestId('phase-login'));
  });

  it('does not re-route to login when SIGNED_OUT fires while already on login', async () => {
    render(<Shell />);

    act(() => {
      fireAuth('INITIAL_SESSION', null);
    });
    await waitFor(() => screen.getByTestId('phase-login'));

    // SIGNED_OUT on login page — should stay on login, not crash
    act(() => {
      fireAuth('SIGNED_OUT', null);
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('phase-login')).toBeTruthy();
  });

  it('PASSWORD_RECOVERY event routes to reset phase', async () => {
    render(<Shell />);

    act(() => {
      fireAuth('PASSWORD_RECOVERY', { access_token: 'tok-pw' });
    });

    await waitFor(() => screen.getByTestId('phase-reset'));
  });
});

describe('URL deep-link routing', () => {
  const origLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: origLocation });
  });

  it('routes to sessions when pathname is /sessions', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/sessions', pathname: '/sessions', search: '', hash: '' },
    });
    render(<Shell />);

    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });

    await waitFor(() => screen.getByTestId('phase-sessions'));
  });

  it('routes to profile when pathname is /profile', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/profile', pathname: '/profile', search: '', hash: '' },
    });
    render(<Shell />);

    act(() => {
      fireAuth('INITIAL_SESSION', { access_token: 'tok-1' });
    });

    await waitFor(() => screen.getByTestId('phase-profile'));
  });
});
