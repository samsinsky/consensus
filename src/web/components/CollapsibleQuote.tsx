import { useState } from 'react';

const MAX_LINES = 3;
const MAX_CHARS = 280;

/** A forwarded quote that starts collapsed to three lines when it is long. */
export function CollapsibleQuote({ text }: { text: string }) {
  const long = text.split('\n').length > MAX_LINES || text.length > MAX_CHARS;
  const [open, setOpen] = useState(false);
  return (
    <div className="quote-wrap">
      <blockquote className={long && !open ? 'quote collapsed' : 'quote'}>{text}</blockquote>
      {long && (
        <button className="ghost quote-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
