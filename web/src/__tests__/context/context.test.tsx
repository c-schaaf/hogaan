import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '../../phases/Context';

const brief = vi.hoisted(() => ({
  get: vi.fn(),
  deleteLine: vi.fn(),
  deleteAll: vi.fn(),
  editLine: vi.fn(),
  addLine: vi.fn(),
  setFields: vi.fn(),
}));
vi.mock('../../lib/api', () => ({ api: { brief } }));
vi.mock('../../components/HogaanWordmark', () => ({ HogaanWordmark: () => null }));
vi.mock('../../components/Nav', () => ({ BottomNav: () => null, DesktopSidebar: () => null }));

const sample = {
  profileFields: { title: 'Program director', teamShape: 'six people' },
  profile: [],
  goals: [{ id: 'g1', text: 'Ask for one more hire', source: 'conversation', updatedAt: '' }],
  notes: [{ id: 'n1', text: 'Open loop: headcount talk', source: 'conversation', updatedAt: '' }],
  version: 2,
  updatedAt: null,
  updatedBy: 'scripted-demo',
};

describe('P1.3 What Hogaan knows about you', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    brief.get.mockResolvedValue(sample);
  });

  it('shows the brief in plain language', async () => {
    render(<Context onNav={vi.fn()} onBack={vi.fn()} />);
    expect(await screen.findByText('Program director')).toBeInTheDocument();
    expect(screen.getByText('Ask for one more hire')).toBeInTheDocument();
    expect(screen.getByText('Open loop: headcount talk')).toBeInTheDocument();
    expect(screen.getByText(/Private sessions are never used here/)).toBeInTheDocument();
  });

  it('deletes a single line', async () => {
    brief.deleteLine.mockResolvedValue({ ...sample, notes: [] });
    render(<Context onNav={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText('Delete: Open loop: headcount talk'));
    await waitFor(() => expect(brief.deleteLine).toHaveBeenCalledWith('n1'));
    await waitFor(() => expect(screen.queryByText('Open loop: headcount talk')).toBeNull());
  });

  it('delete everything asks for confirmation first', async () => {
    brief.deleteAll.mockResolvedValue({ ok: true });
    render(<Context onNav={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Delete everything Hogaan knows'));
    expect(brief.deleteAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Yes, delete everything'));
    await waitFor(() => expect(brief.deleteAll).toHaveBeenCalled());
  });
});
