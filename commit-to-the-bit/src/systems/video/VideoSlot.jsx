import { useEffect, useRef, useState } from 'react';

/**
 * Local gameplay footage with an honest fallback (used by Slide 08, Phase 4).
 * Looks for public/assets/games/<name>.mp4. If the file is missing or fails
 * to decode, it renders a designed placeholder at the same aspect ratio —
 * never a substitute image, never a broken player.
 */
export function VideoSlot({ name, aspect = 9 / 16, width = 360, playing = true, label = 'Gameplay footage to be added' }) {
  const ref = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing
  const src = `./assets/games/${name}.mp4`;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing && status === 'ready') v.play().catch(() => {});
    else v.pause();
  }, [playing, status]);

  return (
    <div className={`video-slot is-${status}`} style={{ width, height: width / aspect }}>
      {status !== 'missing' && (
        <video
          ref={ref}
          src={src}
          muted
          loop
          playsInline
          preload="auto"
          onLoadedData={() => setStatus('ready')}
          onError={() => setStatus('missing')}
        />
      )}
      {status === 'missing' && (
        <div className="video-slot-ph">
          <span className="t-mono">{label}</span>
          <span className="t-mono file">assets/games/{name}.mp4</span>
        </div>
      )}
    </div>
  );
}
