import { useLayoutEffect, useRef } from 'react';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

// Fixed 1920×1080 composition, uniformly scaled and letterboxed to any display.
export function Stage({ children, className = '' }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
      const el = ref.current;
      if (!el) return;
      el.style.transform = `scale(${s}) translate(-50%, -50%)`;
      el.dataset.scale = s;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div className="viewport">
      <div ref={ref} className={`stage ${className}`} id="stage">
        {children}
      </div>
    </div>
  );
}

// Convert a pointer event to stage (1920×1080) coordinates.
export function toStage(e) {
  const el = document.getElementById('stage');
  const r = el.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * STAGE_W,
    y: ((e.clientY - r.top) / r.height) * STAGE_H,
  };
}
