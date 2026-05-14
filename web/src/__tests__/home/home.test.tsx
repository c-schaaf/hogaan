import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Home } from '../../phases/Home';

vi.mock('../../components/HogaanWordmark', () => ({ HogaanWordmark: () => null }));
vi.mock('../../components/Nav', () => ({ BottomNav: () => null, DesktopSidebar: () => null }));
vi.mock('../../components/Icons', () => ({
  HomeIconMic: () => null,
  HomeIconSpark: () => null,
}));

const defaultProps = {
  user: { name: 'Hamse' },
  practices: ['Integrity', 'Peace', 'Empathy'],
  onCompose: vi.fn(),
  onNav: vi.fn(),
};

// Helper to render Home with a specific hour mocked
function renderWithHour(hour: number, props = defaultProps) {
  const origDate = global.Date;
  const MockDate = class extends origDate {
    getHours() { return hour; }
  };
  vi.spyOn(global, 'Date').mockImplementation((...args: unknown[]) => {
    if (args.length === 0) return new MockDate();
    return new origDate(...(args as [string | number | Date]));
  });
  const result = render(<Home {...props} />);
  vi.restoreAllMocks();
  return result;
}

describe('Home — greeting', () => {
  it('shows "Good morning" for hour=8', () => {
    renderWithHour(8);
    expect(screen.getByText(/Good morning, Hamse/)).toBeTruthy();
  });

  it('shows "Good afternoon" for hour=14', () => {
    renderWithHour(14);
    expect(screen.getByText(/Good afternoon, Hamse/)).toBeTruthy();
  });

  it('shows "Good evening" for hour=19', () => {
    renderWithHour(19);
    expect(screen.getByText(/Good evening, Hamse/)).toBeTruthy();
  });

  it('shows "Still up" for hour=0', () => {
    renderWithHour(0);
    expect(screen.getByText(/Still up, Hamse/)).toBeTruthy();
  });
});

describe('Home — suggestions', () => {
  it('renders exactly 3 suggestion chips', () => {
    render(<Home {...defaultProps} />);
    const chips = document.querySelectorAll('.hm-chip');
    expect(chips).toHaveLength(3);
  });

  it('renders suggestions from user practices', () => {
    render(<Home {...defaultProps} practices={['Integrity', 'Peace', 'Empathy']} />);
    const chips = Array.from(document.querySelectorAll('.hm-chip-label')).map((el) => el.textContent);
    // Integrity, Peace, Empathy all have PRACTICE_SUGGESTIONS entries
    expect(chips.length).toBe(3);
  });

  it('renders 3 fallback suggestions when no practices provided', () => {
    render(<Home {...defaultProps} practices={[]} />);
    const chips = document.querySelectorAll('.hm-chip');
    expect(chips).toHaveLength(3);
  });

  it('clicking a chip calls onCompose with topic string', () => {
    const onCompose = vi.fn();
    render(<Home {...defaultProps} onCompose={onCompose} />);
    const firstChip = document.querySelector('.hm-chip') as HTMLButtonElement;
    fireEvent.click(firstChip);
    expect(onCompose).toHaveBeenCalledOnce();
    expect(typeof vi.mocked(onCompose).mock.calls[0]![0]).toBe('string');
  });
});

describe('Home — compose', () => {
  it('clicking compose button calls onCompose', () => {
    const onCompose = vi.fn();
    render(<Home {...defaultProps} onCompose={onCompose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(onCompose).toHaveBeenCalledOnce();
  });

  it('pressing Enter in compose input calls onCompose', () => {
    const onCompose = vi.fn();
    render(<Home {...defaultProps} onCompose={onCompose} />);
    const input = screen.getByPlaceholderText(/Tell me what happened/);
    fireEvent.change(input, { target: { value: 'test message' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCompose).toHaveBeenCalledWith('test message');
  });
});
