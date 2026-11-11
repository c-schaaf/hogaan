// The Moments tab is a new top-level destination. It must stay hidden until
// the moments feature is switched on, so merging changes nothing by default.
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomNav } from '../../components/Nav';
import { resetFeaturesForTests } from '../../lib/features';

function stubFeatures(features: Record<string, boolean>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(features), { status: 200 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetFeaturesForTests();
});

describe('nav: Moments tab', () => {
  it('is hidden when the moments feature is off', async () => {
    stubFeatures({ moments: false });
    render(<BottomNav active="home" onNav={() => {}} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /moments/i })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('appears, and navigates, when the moments feature is on', async () => {
    stubFeatures({ moments: true });
    const onNav = vi.fn();
    render(<BottomNav active="home" onNav={onNav} />);
    const tab = await screen.findByRole('button', { name: /moments/i });
    tab.click();
    expect(onNav).toHaveBeenCalledWith('moments');
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });
});
