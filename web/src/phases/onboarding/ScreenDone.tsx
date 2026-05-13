import { Arrow } from '../../components/Primitives';

interface Props {
  name: string;
  onOpen: () => void;
}

export function ScreenDone({ name, onOpen }: Props) {
  return (
    <div className="celebrate">
      <div className="celebrate-mark">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <path d="M18 10v18" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          <path
            d="M18 14c-3-6-12-6-12 0 0 5 6 8 12 6"
            stroke="white"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M18 14c3-6 12-6 12 0 0 5-6 8-12 6"
            stroke="white"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h1>You're set{name ? `, ${name}` : ''}.</h1>
      <p>Bring me a moment — anything on your mind.</p>
      <div className="wordmark">Hogaan · Leadership</div>
      <div className="attribution">
        A <span className="hamse">Hamse Warfa</span> product
      </div>
      <div style={{ flex: 1 }} />
      <button type="button" className="cta" style={{ maxWidth: 240 }} onClick={onOpen}>
        Open Hogaan <Arrow />
      </button>
      <div className="auto-hint">Opens automatically in a moment…</div>
    </div>
  );
}
