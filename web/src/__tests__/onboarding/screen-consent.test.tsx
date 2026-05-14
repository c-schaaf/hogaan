import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScreenConsent } from '../../phases/onboarding/ScreenConsent';

vi.mock('../../components/Primitives', () => ({
  Arrow: () => <span>→</span>,
  CheckGlyph: () => null,
}));

describe('ScreenConsent', () => {
  it('renders two disclosure sections', () => {
    render(<ScreenConsent checked={false} onToggle={vi.fn()} onStart={vi.fn()} starting={false} />);
    expect(screen.getByText("I'm an AI, not a therapist.")).toBeTruthy();
    expect(screen.getByText('You can leave anytime.')).toBeTruthy();
  });

  it('checkbox renders unchecked by default (aria-checked=false)', () => {
    render(<ScreenConsent checked={false} onToggle={vi.fn()} onStart={vi.fn()} starting={false} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
  });

  it('clicking the checkbox calls onToggle', () => {
    const onToggle = vi.fn();
    render(<ScreenConsent checked={false} onToggle={onToggle} onStart={vi.fn()} starting={false} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('Start button is disabled when checked=false', () => {
    render(<ScreenConsent checked={false} onToggle={vi.fn()} onStart={vi.fn()} starting={false} />);
    expect(screen.getByText('Start coaching').closest('button')).toBeDisabled();
  });

  it('Start button is enabled when checked=true', () => {
    render(<ScreenConsent checked={true} onToggle={vi.fn()} onStart={vi.fn()} starting={false} />);
    expect(screen.getByText('Start coaching').closest('button')).not.toBeDisabled();
  });

  it('clicking Start calls onStart', () => {
    const onStart = vi.fn();
    render(<ScreenConsent checked={true} onToggle={vi.fn()} onStart={onStart} starting={false} />);
    fireEvent.click(screen.getByText('Start coaching').closest('button')!);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('shows "Starting…" text when starting=true', () => {
    render(<ScreenConsent checked={true} onToggle={vi.fn()} onStart={vi.fn()} starting={true} />);
    expect(screen.getByText('Starting…')).toBeTruthy();
  });

  it('Start button is disabled when starting=true', () => {
    render(<ScreenConsent checked={true} onToggle={vi.fn()} onStart={vi.fn()} starting={true} />);
    expect(screen.getByText('Starting…').closest('button')).toBeDisabled();
  });
});
