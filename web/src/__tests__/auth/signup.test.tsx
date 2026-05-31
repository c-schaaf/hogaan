import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Signup } from '../../phases/Signup';

const mockSignUp = vi.hoisted(() => vi.fn());

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signUp: mockSignUp } },
}));

vi.mock('../../lib/auth-errors', () => ({
  humanizeAuthError: (e: { message?: string }) => e.message ?? 'Unknown error',
}));

vi.mock('../../components/Icons', () => ({
  IconCheck: () => null,
  IconSpinner: () => null,
  IconBack: () => null,
  IconEye: () => null,
}));

vi.mock('../../components/HogaanWordmark', () => ({ HogaanWordmark: () => null }));
vi.mock('../../phases/onboarding/data', () => ({ TWELVE_PRACTICES: [] }));

const defaultProps = {
  goVerify: vi.fn(),
  goLogin: vi.fn(),
};

function nameInput() {
  return document.querySelector('input[name="name"]') as HTMLInputElement;
}

function emailInput() {
  return document.querySelector('input[name="email"]') as HTMLInputElement;
}

function passwordInput() {
  return document.querySelector('input[type="password"]') as HTMLInputElement;
}

describe('Signup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignUp.mockResolvedValue({ error: null });
  });

  it('shows name error when name is empty on submit', async () => {
    render(<Signup {...defaultProps} />);
    fireEvent.change(emailInput(), { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('Create my account'));
    await waitFor(() => {
      expect(screen.getByText('What should we call you?')).toBeTruthy();
    });
  });

  it('shows email error for invalid email format', async () => {
    render(<Signup {...defaultProps} />);
    fireEvent.change(nameInput(), { target: { value: 'Hamse' } });
    fireEvent.change(emailInput(), { target: { value: 'notanemail' } });
    fireEvent.change(passwordInput(), { target: { value: 'password123' } });
    // Submit the form directly. Clicking the submit button doesn't work in
    // jsdom when the email input has type="email" and a non-empty invalid
    // value — HTML5 email validation blocks the submit before JS sees it.
    // fireEvent.submit bypasses the implicit constraint check and exercises
    // the JS validator (Signup.tsx:24-30), which is what we actually want
    // to test.
    const form = emailInput().closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByText("That email doesn't look right.")).toBeTruthy();
    });
  });

  it('shows password error for short password', async () => {
    render(<Signup {...defaultProps} />);
    fireEvent.change(nameInput(), { target: { value: 'Hamse' } });
    fireEvent.change(emailInput(), { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'abc' } });
    fireEvent.click(screen.getByText('Create my account'));
    await waitFor(() => {
      expect(screen.getByText('Use 6 or more characters.')).toBeTruthy();
    });
  });

  it('calls supabase.auth.signUp with email and full_name on valid submit', async () => {
    render(<Signup {...defaultProps} />);
    fireEvent.change(nameInput(), { target: { value: 'Hamse Warfa' } });
    fireEvent.change(emailInput(), { target: { value: 'hamse@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('Create my account'));
    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'hamse@test.com',
          password: 'password123',
          options: expect.objectContaining({ data: { full_name: 'Hamse Warfa' } }),
        }),
      );
    });
  });

  it('calls goVerify after successful signup', async () => {
    render(<Signup {...defaultProps} />);
    fireEvent.change(nameInput(), { target: { value: 'Hamse Warfa' } });
    fireEvent.change(emailInput(), { target: { value: 'hamse@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('Create my account'));
    await waitFor(
      () => {
        expect(defaultProps.goVerify).toHaveBeenCalledWith({
          name: 'Hamse Warfa',
          email: 'hamse@test.com',
        });
      },
      { timeout: 1000 },
    );
  });

  it('shows email field error for already-registered error', async () => {
    mockSignUp.mockResolvedValue({ error: { message: 'User already registered' } });
    render(<Signup {...defaultProps} />);
    fireEvent.change(nameInput(), { target: { value: 'Hamse' } });
    fireEvent.change(emailInput(), { target: { value: 'existing@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('Create my account'));
    await waitFor(() => {
      expect(screen.getByText('User already registered')).toBeTruthy();
    });
  });

  it('calls goLogin when "Sign in" link is clicked', () => {
    render(<Signup {...defaultProps} />);
    fireEvent.click(screen.getByText('Sign in'));
    expect(defaultProps.goLogin).toHaveBeenCalledOnce();
  });
});
