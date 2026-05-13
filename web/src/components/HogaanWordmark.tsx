export function HogaanWordmark({ small = false }: { small?: boolean }) {
  return (
    <div className="hg-wordmark" data-small={small ? 'true' : 'false'}>
      <span className="hg-wm-h">Hogaan</span>
      <span className="hg-wm-dot" />
      <span className="hg-wm-tag">LEADERSHIP</span>
    </div>
  );
}
