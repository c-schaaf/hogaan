import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat } from '../../phases/Chat';

const mockTurnStream = vi.hoisted(() => vi.fn());
const mockSessionsList = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api', () => ({
  api: {
    turnStream: mockTurnStream,
    sessions: {
      list: mockSessionsList,
      get: vi.fn(),
    },
  },
}));

vi.mock('../../components/Icons', () => ({
  ChatIconBack: () => null,
  ChatIconBookmark: () => null,
  ChatIconClose: () => null,
  ChatIconMenu: () => null,
  ChatIconMic: () => null,
  ChatIconMoon: () => null,
  ChatIconSend: () => null,
}));

async function* streamEvents(sessionId: string, deltaText: string) {
  yield { type: 'start' as const, sessionId };
  yield { type: 'delta' as const, text: deltaText };
  yield { type: 'end' as const, turnId: 't1', sessionId, latencyMs: 50 };
}

const defaultProps = {
  practices: ['Integrity'],
  onBack: vi.fn(),
};

describe('Chat — New Chat button (SCRUM-54)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionsList.mockResolvedValue({ sessions: [] });
  });

  it('renders a New Chat button in the topbar', () => {
    render(<Chat {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Start a new chat' })).toBeTruthy();
  });

  it('clears the message list when New Chat is clicked', async () => {
    mockTurnStream.mockImplementation(() => streamEvents('sess-A', 'Hello there.'));
    render(<Chat {...defaultProps} />);
    const input = screen.getByPlaceholderText(/Type your message/);

    fireEvent.change(input, { target: { value: 'first message' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('first message')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));

    await waitFor(() => expect(screen.queryByText('first message')).toBeNull());
  });

  it('drops the sessionId from the next turnStream request after New Chat', async () => {
    mockTurnStream.mockImplementation(() => streamEvents('sess-A', 'Hi.'));
    render(<Chat {...defaultProps} />);
    const input = screen.getByPlaceholderText(/Type your message/);

    // Turn 1 — server returns sessionId 'sess-A' which Chat now tracks locally.
    fireEvent.change(input, { target: { value: 'turn one' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockTurnStream).toHaveBeenCalledTimes(1));
    // Drain async generator before sending turn 2.
    await waitFor(() => expect(screen.getByText(/Hi\./)).toBeTruthy());

    // Turn 2 (continuation) — body MUST carry sessionId 'sess-A'.
    mockTurnStream.mockImplementation(() => streamEvents('sess-A', 'Continuing.'));
    fireEvent.change(input, { target: { value: 'turn two' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockTurnStream).toHaveBeenCalledTimes(2));
    expect(mockTurnStream.mock.calls[1]![0]).toMatchObject({
      message: 'turn two',
      sessionId: 'sess-A',
    });

    // Hit New Chat, then send turn 3 — body must NOT carry sessionId.
    fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));
    mockTurnStream.mockImplementation(() => streamEvents('sess-B', 'Fresh.'));
    fireEvent.change(input, { target: { value: 'turn three' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockTurnStream).toHaveBeenCalledTimes(3));

    const thirdCall = mockTurnStream.mock.calls[2]![0] as { sessionId?: string };
    expect(thirdCall).toMatchObject({ message: 'turn three' });
    expect(thirdCall.sessionId).toBeUndefined();
  });
});
