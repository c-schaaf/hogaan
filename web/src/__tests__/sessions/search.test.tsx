import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sessions } from '../../phases/Sessions';

const mockSessionsList = vi.hoisted(() => vi.fn());
const mockSessionsSearch = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api', () => ({
  api: {
    sessions: {
      list: mockSessionsList,
      search: mockSessionsSearch,
    },
  },
}));

vi.mock('../../components/HogaanWordmark', () => ({ HogaanWordmark: () => null }));
vi.mock('../../components/Nav', () => ({ BottomNav: () => null, DesktopSidebar: () => null }));
vi.mock('../../components/Icons', () => ({ SesIconArrow: () => null, SesIconSearch: () => null }));

const defaultProps = {
  onBack: vi.fn(),
  onOpen: vi.fn(),
  onNav: vi.fn(),
};

describe('Sessions — server-side search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSessionsList.mockResolvedValue({
      sessions: [
        { id: 's-listed', title: 'Listed session', msgs: 1, when: 'today', group: 'This week' },
      ],
      hasMore: false,
    });
  });

  it('calls api.sessions.search with the trimmed query after debounce', async () => {
    mockSessionsSearch.mockResolvedValue({ sessions: [], hasMore: false });
    render(<Sessions {...defaultProps} />);

    // Wait for the initial list to render so the search input mounts.
    await waitFor(() => expect(screen.getByText('Listed session')).toBeTruthy());

    const input = screen.getByPlaceholderText('Search sessions…');
    fireEvent.change(input, { target: { value: 'leadership' } });
    expect(mockSessionsSearch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(mockSessionsSearch).toHaveBeenCalledWith({ q: 'leadership', limit: 20 });
  });

  it('renders search results in place of the paginated list while query is active', async () => {
    mockSessionsSearch.mockResolvedValue({
      sessions: [
        {
          id: 's-match',
          title: 'Matched session',
          msgs: 2,
          when: 'yesterday',
          group: 'This week',
        },
      ],
      hasMore: false,
    });
    render(<Sessions {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Listed session')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('Search sessions…'), {
      target: { value: 'match' },
    });
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() => expect(screen.getByText('Matched session')).toBeTruthy());
    expect(screen.queryByText('Listed session')).toBeNull();
  });
});
