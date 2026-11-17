// P3.1b — the consent screen an assistant sends the leader to. It must name
// the assistant AND where it will return to, and do nothing until the
// leader chooses.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectAssistant } from '../../phases/ConnectAssistant';

const oauth = vi.hoisted(() => ({ request: vi.fn(), consent: vi.fn() }));
vi.mock('../../lib/api', () => ({
  api: { oauth },
  ApiError: class ApiError extends Error {
    constructor(public status: number) {
      super('x');
    }
  },
}));
vi.mock('../../components/HogaanWordmark', () => ({ HogaanWordmark: () => null }));
vi.mock('../../components/Nav', () => ({ BottomNav: () => null, DesktopSidebar: () => null }));

const assign = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/connect-assistant?req=hgr_signed');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      href: 'http://localhost/connect-assistant?req=hgr_signed',
      assign,
    },
  });
});
afterEach(() => sessionStorage.clear());

describe('Connect an assistant (consent screen)', () => {
  it('names the assistant and the return address, then sends the leader back on Allow', async () => {
    oauth.request.mockResolvedValue({
      clientName: 'Claude',
      returnsTo: 'claude.ai',
      localApp: false,
      publishedBy: null,
      nameVerified: true,
      allowed: true,
    });
    oauth.consent.mockResolvedValue({
      redirectTo: 'https://claude.ai/api/mcp/auth_callback?code=c&state=s',
    });
    render(<ConnectAssistant onNav={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Claude' })).toBeInTheDocument();
    expect(screen.getAllByText('claude.ai').length).toBeGreaterThan(0);
    expect(oauth.request).toHaveBeenCalledWith('hgr_signed');
    expect(oauth.consent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=c&state=s'),
    );
    expect(oauth.consent).toHaveBeenCalledWith('hgr_signed', true);
  });

  it('Cancel tells the assistant no', async () => {
    oauth.request.mockResolvedValue({
      clientName: 'Claude',
      returnsTo: 'claude.ai',
      localApp: false,
      publishedBy: null,
      nameVerified: true,
      allowed: true,
    });
    oauth.consent.mockResolvedValue({
      redirectTo: 'https://claude.ai/api/mcp/auth_callback?error=access_denied',
    });
    render(<ConnectAssistant onNav={vi.fn()} onDone={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(oauth.consent).toHaveBeenCalledWith('hgr_signed', false));
  });

  it('warns when the assistant named itself (registered, not published)', async () => {
    oauth.request.mockResolvedValue({
      clientName: 'Claude',
      returnsTo: 'evil.example',
      localApp: false,
      publishedBy: null,
      nameVerified: false,
      allowed: true,
    });
    render(<ConnectAssistant onNav={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByText(/cannot confirm this name/)).toBeInTheDocument();
  });

  it('without the plan there is no Allow button', async () => {
    oauth.request.mockResolvedValue({
      clientName: 'Claude',
      returnsTo: 'claude.ai',
      localApp: false,
      publishedBy: null,
      nameVerified: true,
      allowed: false,
    });
    render(<ConnectAssistant onNav={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByText(/part of the Personal plan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });
});
