// The Profile card that tells a leader how to add Hogaan to their assistant.
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantConnect, claudeAddConnectorUrl } from '../../components/AssistantConnect';
import { resetFeaturesForTests } from '../../lib/features';

vi.mock('../../lib/api', () => ({
  api: {
    mcp: {
      list: vi.fn(async () => ({ allowed: true, tokens: [] })),
      connections: vi.fn(async () => ({ connections: [] })),
      create: vi.fn(),
      revoke: vi.fn(),
      disconnect: vi.fn(),
    },
  },
}));

function stubFeatures(features: Record<string, boolean>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(features), { status: 200 })),
  );
}

beforeEach(() => resetFeaturesForTests());
afterEach(() => vi.unstubAllGlobals());

describe('claudeAddConnectorUrl', () => {
  it('opens Claude’s add-connector dialog with the name and address filled in', () => {
    const url = new URL(claudeAddConnectorUrl('Hogaan', 'https://app.example.com/mcp'));
    expect(url.origin + url.pathname).toBe('https://claude.ai/customize/connectors');
    expect(url.searchParams.get('modal')).toBe('add-custom-connector');
    expect(url.searchParams.get('connectorName')).toBe('Hogaan');
    expect(url.searchParams.get('connectorUrl')).toBe('https://app.example.com/mcp');
  });

  it('matches the exact format of a link known to work', () => {
    expect(claudeAddConnectorUrl('Black 4', 'https://api.black4.ai/mcp')).toBe(
      'https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Black%204&connectorUrl=https%3A%2F%2Fapi.black4.ai%2Fmcp',
    );
  });
});

describe('AssistantConnect card', () => {
  it('with sign-in on: shows the Add to Claude link, the by-hand steps and this site’s address', async () => {
    stubFeatures({ mcp: true, mcpOAuth: true });
    render(<AssistantConnect />);
    const link = await screen.findByRole('link', { name: /add to claude/i });
    const address = `${window.location.origin}/mcp`;
    expect(link.getAttribute('href')).toBe(claudeAddConnectorUrl('Hogaan', address));
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(address)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Or set it up by hand' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText(/None yet/)).toBeInTheDocument();
  });

  it('with sign-in off: no Claude link, only the personal-key form', async () => {
    stubFeatures({ mcp: true, mcpOAuth: false });
    render(<AssistantConnect />);
    expect(await screen.findByRole('button', { name: 'Connect an assistant' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /add to claude/i })).toBeNull();
  });

  it('in demo mode the connector is named as a demo', async () => {
    stubFeatures({ mcp: true, mcpOAuth: true, demoMode: true });
    render(<AssistantConnect />);
    const link = await screen.findByRole('link', { name: /add to claude/i });
    expect(new URL(link.getAttribute('href')!).searchParams.get('connectorName')).toBe(
      'Hogaan demo',
    );
    expect(screen.getByText(/sample leader/)).toBeInTheDocument();
  });
});
