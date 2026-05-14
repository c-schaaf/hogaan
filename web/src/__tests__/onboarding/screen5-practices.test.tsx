import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Screen5Practices } from '../../phases/onboarding/Screen5Practices';

vi.mock('../../components/Primitives', () => ({
  Arrow: () => <span>→</span>,
  CheckGlyph: () => null,
  Eyebrow: () => null,
}));

const ALL_PRACTICES = [
  'Purpose',
  'Integrity',
  'Accountability',
  'Dignity',
  'Empathy',
  'Inclusion',
  'Assets',
  'Innovation',
  'Prosperity',
  'Humility',
  'Peace',
  'Democracy',
];

describe('Screen5Practices', () => {
  it('renders all 12 practices', () => {
    render(<Screen5Practices values={[]} onToggle={vi.fn()} onContinue={vi.fn()} />);
    for (const name of ALL_PRACTICES) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('renders practices in 4 groups', () => {
    render(<Screen5Practices values={[]} onToggle={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.getByText('Self')).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.getByText('Organization')).toBeTruthy();
    expect(screen.getByText('Community')).toBeTruthy();
  });

  it('calls onToggle with practice name when clicked', () => {
    const onToggle = vi.fn();
    render(<Screen5Practices values={[]} onToggle={onToggle} onContinue={vi.fn()} />);
    fireEvent.click(screen.getByText('Integrity').closest('button')!);
    expect(onToggle).toHaveBeenCalledWith('Integrity');
  });

  it('shows correct selected count', () => {
    render(
      <Screen5Practices
        values={['Integrity', 'Peace', 'Empathy']}
        onToggle={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('Continue button is disabled when no practices selected', () => {
    render(<Screen5Practices values={[]} onToggle={vi.fn()} onContinue={vi.fn()} />);
    const btn =
      screen.getByText('Continue').closest('button') ??
      screen.getByRole('button', { name: /Continue/ });
    expect(btn).toBeDisabled();
  });

  it('Continue button is enabled when at least 1 practice selected', () => {
    render(<Screen5Practices values={['Integrity']} onToggle={vi.fn()} onContinue={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /Continue/ });
    expect(btn).not.toBeDisabled();
  });

  it('calls onContinue when Continue button clicked', () => {
    const onContinue = vi.fn();
    render(<Screen5Practices values={['Integrity']} onToggle={vi.fn()} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('selected practices have "selected" class', () => {
    render(<Screen5Practices values={['Empathy']} onToggle={vi.fn()} onContinue={vi.fn()} />);
    const btn = screen.getByText('Empathy').closest('button')!;
    expect(btn.className).toContain('selected');
  });

  it('unselected practices do not have "selected" class', () => {
    render(<Screen5Practices values={['Empathy']} onToggle={vi.fn()} onContinue={vi.fn()} />);
    const btn = screen.getByText('Integrity').closest('button')!;
    expect(btn.className).not.toContain('selected');
  });
});
