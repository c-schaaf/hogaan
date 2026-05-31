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

describe('Sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sessions grouped by recency label', async () => {
    mockSessionsList.mockResolvedValue({
      sessions: [
        { id: 's1', title: 'Team Leadership', msgs: 5, when: '2 days ago', group: 'This week' },
        {
          id: 's2',
          title: 'Conflict Resolution',
          msgs: 3,
          when: '12 days ago',
          group: 'Earlier this month',
        },
        { id: 's3', title: 'Strategic Planning', msgs: 7, when: '45 days ago', group: 'Older' },
      ],
    });

    render(<Sessions {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('This week')).toBeTruthy();
      expect(screen.getByText('Earlier this month')).toBeTruthy();
      expect(screen.getByText('Older')).toBeTruthy();
    });
  });

  it('renders session titles in their groups', async () => {
    mockSessionsList.mockResolvedValue({
      sessions: [
        { id: 's1', title: 'Team Leadership', msgs: 5, when: '2 days ago', group: 'This week' },
      ],
    });

    render(<Sessions {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Team Leadership')).toBeTruthy();
    });
  });

  it('shows empty state when no sessions exist', async () => {
    mockSessionsList.mockResolvedValue({ sessions: [] });

    render(<Sessions {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Your saved conversations will live here/)).toBeTruthy();
    });
  });

  it('renders server search results in place of the paginated list', async () => {
    mockSessionsList.mockResolvedValue({
      sessions: [
        { id: 's1', title: 'Team Leadership', msgs: 5, when: '2 days ago', group: 'This week' },
        { id: 's2', title: 'Conflict Resolution', msgs: 3, when: '3 days ago', group: 'This week' },
      ],
    });
    mockSessionsSearch.mockResolvedValue({
      sessions: [
        { id: 's1', title: 'Team Leadership', msgs: 5, when: '2 days ago', group: 'This week' },
      ],
      hasMore: false,
    });

    render(<Sessions {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Team Leadership')).toBeTruthy());

    const input = screen.getByPlaceholderText('Search sessions…');
    fireEvent.change(input, { target: { value: 'Team' } });

    await waitFor(() => {
      expect(screen.getByText('Team Leadership')).toBeTruthy();
      expect(screen.queryByText('Conflict Resolution')).toBeNull();
    });
  });

  it('shows no-match message when server returns no results', async () => {
    mockSessionsList.mockResolvedValue({
      sessions: [
        { id: 's1', title: 'Team Leadership', msgs: 5, when: '2 days ago', group: 'This week' },
      ],
    });
    mockSessionsSearch.mockResolvedValue({ sessions: [], hasMore: false });

    render(<Sessions {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Team Leadership')).toBeTruthy());

    const input = screen.getByPlaceholderText('Search sessions…');
    fireEvent.change(input, { target: { value: 'zzznomatch' } });

    await waitFor(() => {
      // UI copy is "No session titles match "{query}"." — body-search is coming
      // soon, so the empty-state explicitly scopes itself to title matches.
      expect(screen.getByText(/No session titles match "zzznomatch"/)).toBeTruthy();
    });
  });

  it('shows Load more button when hasMore=true and appends next page on click', async () => {
    mockSessionsList
      .mockResolvedValueOnce({
        sessions: [
          { id: 's1', title: 'First Session', msgs: 5, when: '1 day ago', group: 'This week' },
        ],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            id: 's2',
            title: 'Second Session',
            msgs: 3,
            when: '8 days ago',
            group: 'Earlier this month',
          },
        ],
        hasMore: false,
      });

    render(<Sessions {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('First Session')).toBeTruthy());

    const loadMore = screen.getByText('Load more');
    expect(loadMore).toBeTruthy();

    fireEvent.click(loadMore);

    await waitFor(() => {
      expect(screen.getByText('First Session')).toBeTruthy();
      expect(screen.getByText('Second Session')).toBeTruthy();
    });

    // After last page, the button should be gone.
    await waitFor(() => {
      expect(screen.queryByText('Load more')).toBeNull();
    });

    // Verify cursor was used on second call.
    expect(mockSessionsList).toHaveBeenCalledTimes(2);
    expect(mockSessionsList).toHaveBeenNthCalledWith(2, { before: 's1', limit: 20 });
  });

  it('does not show Load more when hasMore=false', async () => {
    mockSessionsList.mockResolvedValue({
      sessions: [
        { id: 's1', title: 'Only Session', msgs: 1, when: '1 day ago', group: 'This week' },
      ],
      hasMore: false,
    });

    render(<Sessions {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Only Session')).toBeTruthy());
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('calls onOpen when a session row is clicked', async () => {
    mockSessionsList.mockResolvedValue({
      sessions: [
        { id: 'sess-abc', title: 'My Session', msgs: 2, when: '1 day ago', group: 'This week' },
      ],
    });

    render(<Sessions {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('My Session')).toBeTruthy());

    fireEvent.click(screen.getByText('My Session').closest('button')!);
    expect(defaultProps.onOpen).toHaveBeenCalledWith('sess-abc');
  });
});
