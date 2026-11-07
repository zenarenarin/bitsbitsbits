import { forwardRef } from 'react';

// The Bit — the coral light that travels through the whole presentation.
// Positioned by its centre: animate x / y in stage pixels.
export const Bit = forwardRef(function Bit({ size = 56, className = '', style }, ref) {
  return <div ref={ref} className={`bit ${className}`} style={{ width: size, height: size, margin: `${-size / 2}px 0 0 ${-size / 2}px`, ...style }} />;
});
