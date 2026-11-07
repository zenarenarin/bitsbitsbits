// Discreet presenter chrome: progress, toast, key help.
export function Progress({ scenes, index, beat, light }) {
  const s = scenes[index];
  const groups = [...new Set(scenes.map((x) => x.group))];
  const total = scenes[index].beats;
  if (index === 0) return null;
  return (
    <div className={`chrome progress ${light ? 'on-light' : ''}`}>
      {total > 1 && (
        <div className="beats" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`beat ${i <= beat ? 'on' : ''}`} />
          ))}
        </div>
      )}
      <span className="label">
        {String(s.group).padStart(2, '0')} / {String(groups.length - 1).padStart(2, '0')}
      </span>
      <div className="dots" aria-hidden>
        {groups.slice(1).map((g) => (
          <span key={g} className={`dot ${g === s.group ? 'now' : g < s.group ? 'done' : ''}`} />
        ))}
      </div>
    </div>
  );
}

export function Toast({ msg }) {
  return <div className={`chrome toast ${msg ? 'show' : ''}`}>{msg}</div>;
}

export function Help({ onClose, muted, lite }) {
  const rows = [
    ['→ / Space', 'Next beat'],
    ['←', 'Previous beat'],
    ['R', 'Replay beat'],
    ['F', 'Fullscreen'],
    ['M', `Mute (${muted ? 'muted' : 'on'})`],
    ['Home', 'Back to opening'],
    ['L', `Lite mode (${lite ? 'on' : 'off'})`],
    ['H / ?', 'This panel'],
  ];
  return (
    <div className="chrome help" onClick={onClose}>
      <div className="card">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <kbd>{k}</kbd>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
