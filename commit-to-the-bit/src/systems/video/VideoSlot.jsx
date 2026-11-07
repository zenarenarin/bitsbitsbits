import { useEffect, useRef, useState } from 'react';

/**
 * Local gameplay footage with an honest fallback.
 * Looks for public/assets/games/<name>.mp4 and fills its parent box.
 * If the file is missing or fails to decode it shows a designed placeholder
 * in the same frame — never a substitute image, never a broken player.
 * Only plays while `playing` is true, so one example has the room at a time.
 */
export function VideoSlot({ name, playing = false, label = 'Gameplay footage to be added', compact = false }) {
  const ref = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing
  const src = `./assets/games/${name}.mp4`;

  useEffect(() => {
    const v = ref.current;
    if (!v || status !== 'ready') return;
    if (playing) {
      v.currentTime = 0;
      v.play().catch(() => {});
    } else v.pause();
  }, [playing, status]);

  return (
    <div className={`video-slot is-${status} ${compact ? 'compact' : ''}`}>
      {status !== 'missing' && (
        <video ref={ref} src={src} muted loop playsInline preload="auto" onLoadedData={() => setStatus('ready')} onError={() => setStatus('missing')} />
      )}
      {status === 'missing' && (
        <div className="video-slot-ph">
          <span className="ph-label">{label}</span>
          <span className="t-mono file">assets/games/{name}.mp4</span>
        </div>
      )}
    </div>
  );
}
