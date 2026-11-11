import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailVerify } from '../../phases/EmailVerify';

const mockResend = vi.hoisted(() => vi.fn());
const mockSignInWithOtp = vi.hoisted(() => vi.fn());

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      resend: mockResend,
      signInWithOtp: mockSignInWithOtp,
    },
  },
}));

vi.mock('../../components/Icons', () => ({
  IconCheck: () => <span data-testid="icon-check">✓</span>,
  IconEnvelope: () => null,
  IconBack: () => null,
  IconEye: () => null,
}));

vi.mock('../../components/HogaanWordmark', () => ({ HogaanWordmark: () => null }));
vi.mock('../../phases/onboarding/data', () => ({ TWELVE_PRACTICES: [] }));

const defaultProps = {
  email: 'hamse@test.com',
  onContinue: vi.fn(),
  goSignup: vi.fn(),
};

describe('EmailVerify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResend.mockResolvedValue({ error: null });
    mockSignInWithOtp.mockResolvedValue({ error: null });
  });

  it('renders the user email in the body text', () => {
    render(<EmailVerify {...defaultProps} />);
    expect(screen.getByText('hamse@test.com')).toBeTruthy();
  });

  it('shows signup mode body text', () => {
    render(<EmailVerify {...defaultProps} mode="signup" />);
    expect(screen.getByText(/Click it to verify/)).toBeTruthy();
  });

  it('shows login mode with one-tap copy', () => {
    render(<EmailVerify {...defaultProps} mode="login" />);
    expect(screen.getByText(/one-tap sign-in link/)).toBeTruthy();
  });

  it('"I\'ve verified" button calls onContinue in signup mode', () => {
    render(<EmailVerify {...defaultProps} mode="signup" />);
    fireEvent.click(screen.getByText("I've verified — continue"));
    expect(defaultProps.onContinue).toHaveBeenCalledOnce();
  });

  it('resend button is enabled initially', () => {
    render(<EmailVerify {...defaultProps} />);
    expect(screen.getByRole('button', { name: /resend/ })).not.toBeDisabled();
  });

  it('calls supabase.auth.resend in signup mode when resend clicked', async () => {
    render(<EmailVerify {...defaultProps} mode="signup" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /resend/ }));
    });
    expect(mockResend).toHaveBeenCalledWith({ type: 'signup', email: 'hamse@test.com' });
  });

  it('calls supabase.auth.signInWithOtp in login mode when resend clicked', async () => {
    render(<EmailVerify {...defaultProps} mode="login" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /resend/ }));
    });
    expect(mockSignInWithOtp).toHaveBeenCalledOnce();
  });

  it('shows sent toast immediately after clicking resend (setResent before await)', async () => {
    render(<EmailVerify {...defaultProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /resend/ }));
    });
    expect(screen.getByText(/Sent — check your inbox/)).toBeTruthy();
  });

  it('resend button is disabled while countdown is active', async () => {
    vi.useFakeTimers();
    render(<EmailVerify {...defaultProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /resend/ }));
    });
    // counter is now 30 — button should be disabled
    expect(screen.getByRole('button', { name: /resend/ })).toBeDisabled();
    vi.useRealTimers();
  });

  it('shows countdown text after resend click', async () => {
    vi.useFakeTimers();
    render(<EmailVerify {...defaultProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /resend/ }));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: /resend \(\d+s\)/ })).toBeTruthy();
    vi.useRealTimers();
  });

  it('does not call resend again while counter > 0', async () => {
    vi.useFakeTimers();
    render(<EmailVerify {...defaultProps} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /resend/ }));
    });
    // second click while disabled
    fireEvent.click(screen.getByRole('button', { name: /resend/ }));
    expect(mockResend).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
