import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Login } from '../../phases/Login';

const mockSignIn = vi.hoisted(() => vi.fn());

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: mockSignIn } },
}));

vi.mock('../../lib/auth-errors', () => ({
  humanizeAuthError: (e: { message?: string }) => e.message ?? 'Unknown error',
}));

vi.mock('../../components/Icons', () => ({
  IconSpinner: () => null,
  IconBack: () => null,
  IconEye: () => null,
}));

vi.mock('../../components/HogaanWordmark', () => ({ HogaanWordmark: () => null }));
vi.mock('../../phases/onboarding/data', () => ({ TWELVE_PRACTICES: [] }));

const defaultProps = {
  onSignedIn: vi.fn(),
  goSignup: vi.fn(),
  goForgot: vi.fn(),
};

function emailInput() {
  return document.querySelector('input[name="email"]') as HTMLInputElement;
}

function passwordInput() {
  return document.querySelector('input[type="password"]') as HTMLInputElement;
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({ error: null });
  });

  it('shows email error on empty submit', async () => {
    render(<Login {...defaultProps} />);
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => {
      expect(screen.getByText("That email doesn't look right.")).toBeTruthy();
    });
  });

  it('shows password error when password is empty', async () => {
    render(<Login {...defaultProps} />);
    fireEvent.change(emailInput(), { target: { value: 'valid@test.com' } });
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => {
      expect(screen.getByText('Enter your password.')).toBeTruthy();
    });
  });

  it('shows form-level error for invalid credentials', async () => {
    mockSignIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<Login {...defaultProps} />);
    fireEvent.change(emailInput(), { target: { value: 'user@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => {
      expect(screen.getByText(/Email or password didn't match/)).toBeTruthy();
    });
  });

  it('shows unconfirmed email message for not-confirmed error', async () => {
    mockSignIn.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    render(<Login {...defaultProps} />);
    fireEvent.change(emailInput(), { target: { value: 'user@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => {
      expect(screen.getByText(/haven't confirmed your email/)).toBeTruthy();
    });
  });

  it('calls signInWithPassword with email + password on valid submit', async () => {
    render(<Login {...defaultProps} />);
    fireEvent.change(emailInput(), { target: { value: 'user@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'correctpass' } });
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({ email: 'user@test.com', password: 'correctpass' });
    });
  });

  it('calls onSignedIn after successful sign in', async () => {
    render(<Login {...defaultProps} />);
    fireEvent.change(emailInput(), { target: { value: 'user@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'correctpass' } });
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => {
      expect(defaultProps.onSignedIn).toHaveBeenCalledOnce();
    });
  });

  it('renders banner prop above the form', () => {
    render(<Login {...defaultProps} banner="Your session expired." />);
    expect(screen.getByText('Your session expired.')).toBeTruthy();
  });

  it('calls goForgot when "Forgot your password?" is clicked', () => {
    render(<Login {...defaultProps} />);
    fireEvent.click(screen.getByText('Forgot your password?'));
    expect(defaultProps.goForgot).toHaveBeenCalledOnce();
  });

  it('calls goSignup when "Create an account" is clicked', () => {
    render(<Login {...defaultProps} />);
    fireEvent.click(screen.getByText('Create an account'));
    expect(defaultProps.goSignup).toHaveBeenCalledOnce();
  });
});
