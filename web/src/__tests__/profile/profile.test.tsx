import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Profile } from '../../phases/Profile';

const mockProfileGet = vi.hoisted(() => vi.fn());
const mockProfilePatch = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api', () => ({
  api: {
    profile: {
      get: mockProfileGet,
      patch: mockProfilePatch,
    },
  },
}));

vi.mock('../../components/HogaanWordmark', () => ({ HogaanWordmark: () => null }));
vi.mock('../../components/Nav', () => ({ BottomNav: () => null, DesktopSidebar: () => null }));
vi.mock('../../components/Icons', () => ({ PrIconEdit: () => null }));
vi.mock('../../phases/onboarding/data', () => ({
  TWELVE_PRACTICES: [
    { level: 'Self', items: ['Purpose', 'Integrity', 'Accountability'] },
    { level: 'Team', items: ['Dignity', 'Empathy', 'Inclusion'] },
    { level: 'Organization', items: ['Assets', 'Innovation', 'Prosperity'] },
    { level: 'Community', items: ['Humility', 'Peace', 'Democracy'] },
  ],
}));

const defaultProps = {
  user: { name: 'Hamse Warfa', email: 'hamse@test.com' },
  practices: ['Integrity', 'Peace'],
  onSignOut: vi.fn(),
  onNav: vi.fn(),
};

describe('Profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileGet.mockResolvedValue({
      fullName: 'Hamse Warfa',
      email: 'hamse@test.com',
      mappedPractices: ['Integrity', 'Peace'],
      onboarded: true,
    });
    mockProfilePatch.mockResolvedValue({ ok: true });
  });

  it('renders user name in the Full name field', async () => {
    render(<Profile {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Hamse Warfa')).toBeTruthy();
    });
  });

  it('renders user email in the Email field', async () => {
    render(<Profile {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('hamse@test.com')).toBeTruthy();
    });
  });

  it('renders selected practices with is-on class', async () => {
    render(<Profile {...defaultProps} />);
    await waitFor(() => {
      const pill = screen.getByText('Integrity').closest('.pr-prac-pill');
      expect(pill?.className).toContain('is-on');
    });
  });

  it('renders "N practices in focus" stat', async () => {
    render(<Profile {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('practices in focus')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
    });
  });

  it('shows singular "practice in focus" for 1 practice', async () => {
    mockProfileGet.mockResolvedValue({
      fullName: 'Hamse',
      email: 'h@test.com',
      mappedPractices: ['Integrity'],
      onboarded: true,
    });
    render(<Profile {...defaultProps} practices={['Integrity']} />);
    await waitFor(() => {
      expect(screen.getByText('practice in focus')).toBeTruthy();
    });
  });

  it('support section has mailto:hamse24@gmail.com anchor', () => {
    render(<Profile {...defaultProps} />);
    const link = document.querySelector('a[href="mailto:hamse24@gmail.com"]');
    expect(link).not.toBeNull();
  });

  it('"Update practices" button enters edit mode', async () => {
    render(<Profile {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Update practices')).toBeTruthy());
    fireEvent.click(screen.getByText('Update practices'));
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('clicking a practice pill in edit mode calls toggle (changes draft)', async () => {
    render(<Profile {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Update practices')).toBeTruthy());
    fireEvent.click(screen.getByText('Update practices'));

    // Empathy is not selected — clicking it should mark it as toggled
    const empathyBtn = screen.getByText('Empathy').closest('button');
    expect(empathyBtn).not.toBeNull();
    fireEvent.click(empathyBtn!);
    // After toggle, Empathy pill should now show is-on
    expect(empathyBtn?.className).toContain('is-on');
  });

  it('Save calls api.profile.patch with draftPractices', async () => {
    render(<Profile {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Update practices')).toBeTruthy());
    fireEvent.click(screen.getByText('Update practices'));
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });
    expect(mockProfilePatch).toHaveBeenCalledWith(
      expect.objectContaining({ mappedPractices: expect.any(Array) }),
    );
  });

  it('Cancel exits edit mode without patching', async () => {
    render(<Profile {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Update practices')).toBeTruthy());
    fireEvent.click(screen.getByText('Update practices'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockProfilePatch).not.toHaveBeenCalled();
    expect(screen.getByText('Update practices')).toBeTruthy();
  });

  it('Sign out button calls onSignOut', async () => {
    render(<Profile {...defaultProps} />);
    fireEvent.click(screen.getByText('Sign out'));
    expect(defaultProps.onSignOut).toHaveBeenCalledOnce();
  });
});
