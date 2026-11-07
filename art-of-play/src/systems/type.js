/*
 * Kinetic typography.
 *
 * Type is laid out on the fixed 1920x1080 grid: 12 columns, 120 px outer margin,
 * 8 px baseline. Every block is built from masked lines so words can rise into
 * place from behind an edge rather than fading. Behaviours are small, named and
 * reused; a scene chooses one per moment instead of animating everything.
 */

export const GRID = {
  margin: 120,
  col: (1920 - 240) / 12,
  x: (c) => 120 + c * ((1920 - 240) / 12),
}

/**
 * @param root parent element
 * @param o.lines array of strings (HTML allowed for <span data-w="id"> word hooks)
 */
export function textBlock(root, { lines, cls = 'display', size = 120, x = GRID.margin, y = 200, right = null, color = null, lh = null, tracking = null, weight = null, align = 'left', opacity = 1 }) {
  const el = document.createElement('div')
  el.className = `t t-${cls}`
  const st = el.style
  if (right !== null) st.right = `${right}px`
  else st.left = `${x}px`
  st.top = `${y}px`
  st.fontSize = `${size}px`
  st.textAlign = align
  if (lh) st.lineHeight = lh
  if (tracking !== null) st.letterSpacing = tracking
  if (color) st.color = color
  if (weight) st.fontWeight = weight
  st.opacity = opacity
  const inners = []
  const lineEls = []
  for (const l of lines) {
    const ln = document.createElement('span')
    ln.className = 'ln'
    const inner = document.createElement('span')
    inner.innerHTML = l
    ln.appendChild(inner)
    el.appendChild(ln)
    inners.push(inner)
    lineEls.push(ln)
  }
  root.appendChild(el)
  const words = {}
  el.querySelectorAll('[data-w]').forEach((w) => (words[w.dataset.w] = w))
  return { el, lines: inners, lineEls, words }
}

/** Split an element's text into per-character spans (keeps spaces). */
export function splitChars(el) {
  const text = el.textContent
  el.textContent = ''
  const out = []
  for (const ch of text) {
    const s = document.createElement('span')
    s.style.display = 'inline-block'
    s.style.whiteSpace = 'pre'
    s.textContent = ch
    el.appendChild(s)
    out.push(s)
  }
  return out
}

/** Position of an element inside the 1920x1080 stage, independent of CSS scaling. */
export function stageRect(el) {
  let x = 0
  let y = 0
  let n = el
  while (n && !n.classList?.contains('scene-type')) {
    x += n.offsetLeft
    y += n.offsetTop
    n = n.offsetParent
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight }
}

// ------------------------------------------------------------------ behaviours

/** Lines rise into place from behind their mask. Weighted, not floaty. */
export function rise(tl, lines, at, { duration = 1.15, stagger = 0.085, ease = 'expo.out', from = 112 } = {}) {
  return tl.fromTo(lines, { yPercent: from }, { yPercent: 0, duration, stagger, ease }, at)
}

/** Lines leave upward, the first line first, with a little anticipation. */
export function lift(tl, lines, at, { duration = 0.7, stagger = 0.05, ease = 'power3.in', to = -112 } = {}) {
  return tl.fromTo(lines, { yPercent: 0 }, { yPercent: to, duration, stagger, ease, immediateRender: false }, at)
}

/** Fade with a small upward settle: reserved for quiet secondary text. */
export function settle(tl, els, at, { duration = 0.9, stagger = 0.06, y = 14 } = {}) {
  return tl.fromTo(els, { opacity: 0, y }, { opacity: 1, y: 0, duration, stagger, ease: 'power2.out' }, at)
}

export function unsettle(tl, els, at, { duration = 0.45 } = {}) {
  return tl.fromTo(els, { opacity: 1 }, { opacity: 0, duration, ease: 'power1.in', immediateRender: false }, at)
}
