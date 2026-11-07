import { useEffect, useRef, useState } from 'react'
import { Engine } from './engine/Engine.js'
import { scenes } from './scenes/index.js'
import { grainDataURL } from './systems/textures.js'

export default function App() {
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const typeRef = useRef(null)
  const svgRef = useRef(null)
  const grainRef = useRef(null)
  const [status, setStatus] = useState(null)

  // Fit the fixed 1920x1080 composition to the window, letterboxed.
  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080)
      stageRef.current.style.transform = `translate(-50%, -50%) scale(${s})`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => {
    const engine = new Engine({
      canvas: canvasRef.current,
      typeLayer: typeRef.current,
      svgLayer: svgRef.current,
      scenes,
      onStatus: setStatus,
      grain: grainRef.current,
    })
    // Film grain: one static tile on an oversized layer, jumped about at 12 fps by
    // the engine clock with a compositor-only transform (no repaint, deterministic).
    grainRef.current.style.backgroundImage = `url(${grainDataURL(256, 1)})`
    engine.start()
  }, [])

  return (
    <div className="stage" ref={stageRef}>
      <canvas ref={canvasRef} width={1920} height={1080} />
      <div className="layer type-layer" ref={typeRef} />
      <svg className="layer svg-layer" ref={svgRef} viewBox="0 0 1920 1080" width="1920" height="1080" />
      <div className="layer vignette" />
      <div className="layer grain" ref={grainRef} />
      {status && (
        <div className="indicator">
          <span>
            {String(status.scene).padStart(2, '0')} / {String(status.total).padStart(2, '0')}
          </span>
          <span className="beats">
            {Array.from({ length: status.beats }, (_, k) => (
              <i key={k} className={k <= status.beat ? 'on' : ''} />
            ))}
          </span>
          {status.muted && <span>muted</span>}
        </div>
      )}
      {status?.hud && <div className="hud">{status.hud}</div>}
    </div>
  )
}
