import React from 'react';
import { createRoot } from 'react-dom/client';
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

createRoot(root).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>,
);
