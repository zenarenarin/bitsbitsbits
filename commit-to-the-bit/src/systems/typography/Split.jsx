// Splits copy into animatable units without losing natural word spacing.
// <Split text="Until connected." by="char" className="u" />
export function Split({ text, by = 'char', unitClass = '', wordClass = '' }) {
  const words = text.split(' ');
  return (
    <>
      {words.map((w, wi) => (
        <span key={wi} className={`split-unit ${wordClass}`} style={{ whiteSpace: 'nowrap' }} data-word={wi}>
          {by === 'char'
            ? [...w].map((c, ci) => (
                <span key={ci} className={`split-unit ${unitClass}`}>
                  {c}
                </span>
              ))
            : w}
          {wi < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  );
}

// A line wrapped in an overflow mask so it can rise into place.
export function MaskLine({ children, className = '', style }) {
  return (
    <span className="mask-line" style={style}>
      <span className={`split-line ${className}`}>{children}</span>
    </span>
  );
}
