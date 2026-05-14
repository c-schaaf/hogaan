/**
 * Regression test: Sessions list must not flash "No sessions yet." or
 * "No sessions match…" during the initial load (before the API resolves).
 *
 * Bug: loading=true + rows=null → hasAny=false → the no-results text rendered
 * for ~1–2 s before data arrived. Fixed by adding a `loading ? null` guard.
 */
import { render, screen } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { Sessions } from '../phases/Sessions';

// Simulates a request that never resolves (infinite loading state)
vi.mock('../lib/api', () => ({
  api: {
    sessions: { list: vi.fn(() => new Promise(() => {})) },
  },
}));

vi.mock('../components/HogaanWordmark', () => ({ HogaanWordmark: () => null }));
vi.mock('../components/Nav', () => ({ BottomNav: () => null, DesktopSidebar: () => null }));
vi.mock('../components/Icons', () => ({
  SesIconArrow: () => null,
  SesIconSearch: () => null,
}));

it('shows nothing (not "No sessions yet.") while the list is loading', () => {
  render(<Sessions onBack={vi.fn()} onOpen={vi.fn()} onNav={vi.fn()} />);

  expect(screen.queryByText(/no sessions yet/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/no sessions match/i)).not.toBeInTheDocument();
});
