/**
 * Regression test: Profile page full-name inline editor.
 *
 * Bug: the Edit button next to "Full name" was rendered but its onClick was
 * missing — clicking did nothing. Fixed by wiring onClick to InlineButton.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Profile } from '../phases/Profile';

// vi.mock is hoisted — use vi.hoisted() for any variable the factory references
const mockPatch = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', () => ({
  api: {
    profile: {
      get: vi.fn().mockResolvedValue({
        fullName: 'Hamse Warfa',
        email: 'hamse@example.com',
        mappedPractices: ['Integrity'],
        onboarded: true,
        commStyle: null,
        responseDepth: null,
      }),
      patch: mockPatch,
    },
  },
}));

vi.mock('../components/HogaanWordmark', () => ({ HogaanWordmark: () => null }));
vi.mock('../components/Nav', () => ({ BottomNav: () => null, DesktopSidebar: () => null }));
vi.mock('../components/Icons', () => ({ PrIconEdit: () => null }));
// Profile.tsx imports from './onboarding/data' — relative to web/src/phases/,
// so from __tests__/ the mock path must be '../phases/onboarding/data'
vi.mock('../phases/onboarding/data', () => ({ TWELVE_PRACTICES: [] }));

const defaultProps = {
  user: { name: 'Hamse Warfa', email: 'hamse@example.com' },
  practices: ['Integrity'],
  onSignOut: vi.fn(),
  onNav: vi.fn(),
};

beforeEach(() => {
  mockPatch.mockReset().mockResolvedValue({});
});

// Wrap render in act(async) to drain the profile.get() useEffect microtask
// and avoid "not wrapped in act" warnings from the async state update.
async function renderProfile() {
  await act(async () => {
    render(<Profile {...defaultProps} />);
  });
}

it('shows an input when Edit is clicked next to Full name', async () => {
  await renderProfile();

  expect(screen.getByText('Hamse Warfa')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

  expect(screen.getByRole('textbox')).toBeInTheDocument();
});

it('calls api.profile.patch with the new name when Save is clicked', async () => {
  await renderProfile();

  fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hamse Warfa Jr.' } });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await waitFor(() => expect(mockPatch).toHaveBeenCalledWith({ fullName: 'Hamse Warfa Jr.' }));
});

it('cancels editing without saving when Cancel is clicked', async () => {
  await renderProfile();

  fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Oops Name' } });
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByText('Hamse Warfa')).toBeInTheDocument();
  expect(mockPatch).not.toHaveBeenCalled();
});
