import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigErrorScreen } from './components/ConfigErrorScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { supabaseConfigError } from './lib/supabase';
import { Shell } from './Shell';

// Stylesheet order matters: base tokens -> screens -> sessions/profile ->
// desktop overrides -> mobile polish (last so it wins at narrow widths).
import './styles/hogaan-base.css';
import './styles/hogaan-screens.css';
import './styles/hogaan-sessions-profile.css';
import './styles/hogaan-desktop.css';
import './styles/hogaan-mobile-polish.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// SCRUM — config-error fallback. supabase.ts used to throw at module load,
// which blanked the page before any UI rendered. The env check now sets a
// module-scoped flag we read here, so a missing VITE_SUPABASE_* shows a
// real error screen instead of a white page.
createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      {supabaseConfigError !== null ? (
        <ConfigErrorScreen message={supabaseConfigError} />
      ) : (
        <Shell />
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
