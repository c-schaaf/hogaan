import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Reflect } from '../../phases/Reflect';

const moments = vi.hoisted(() => ({ list: vi.fn(), reflect: vi.fn() }));
vi.mock('../../lib/api', () => ({ api: { moments } }));
vi.mock('../../components/HogaanWordmark', () => ({ HogaanWordmark: () => null }));
vi.mock('../../components/Nav', () => ({ BottomNav: () => null, DesktopSidebar: () => null }));

const m = {
  id: 'm1',
  what: 'Headcount conversation',
  withWhom: 'my director',
  happensAt: '2026-11-19T20:00:00.000Z',
  status: 'upcoming',
  source: 'leader',
  followupSentAt: null,
  createdAt: '',
  outcome: null,
};

describe('P2.3 Reflect page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    moments.list.mockResolvedValue({ moments: [m] });
    moments.reflect.mockResolvedValue({ ...m, status: 'reflected' });
  });

  it('needs an answer before saving, then records it and offers to talk it through', async () => {
    const onTalk = vi.fn();
    render(<Reflect momentId="m1" onNav={vi.fn()} onDone={vi.fn()} onTalk={onTalk} />);
    expect(await screen.findByText('Headcount conversation · my director')).toBeInTheDocument();
    const save = screen.getByText('Save reflection');
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'It was hard' }));
    fireEvent.change(screen.getByLabelText(/do differently/), { target: { value: 'Ask first' } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(moments.reflect).toHaveBeenCalledWith('m1', {
        howItWent: 'hard',
        differently: 'Ask first',
      }),
    );
    fireEvent.click(await screen.findByText('Talk it through with Hogaan'));
    expect(onTalk).toHaveBeenCalled();
  });
});
