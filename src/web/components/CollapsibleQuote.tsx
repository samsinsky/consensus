import { useLayoutEffect, useRef, useState } from 'react';

const MAX_LINES = 3;
const MAX_CHARS = 280;

/** A forwarded quote that starts collapsed to three lines when it is long. */
export function CollapsibleQuote({ text }: { text: string }) {
  const long = text.split('\n').length > MAX_LINES || text.length > MAX_CHARS;
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const anchor = useRef<number | undefined>(undefined);

  // Collapsing removes text above the toggle; scroll back by that much so the reader stays in place.
  useLayoutEffect(() => {
    const before = anchor.current;
    anchor.current = undefined;
    if (before === undefined || !toggle.current) return;
    const scroller = scrollParent(toggle.current);
    if (scroller) scroller.scrollTop -= before - toggle.current.getBoundingClientRect().top;
  }, [open]);

  const onToggle = () => {
    if (open && toggle.current) anchor.current = toggle.current.getBoundingClientRect().top;
    setOpen((o) => !o);
  };

  return (
    <div className="quote-wrap">
      <blockquote className={long && !open ? 'quote collapsed' : 'quote'}>{text}</blockquote>
      {long && (
        <button ref={toggle} className="ghost quote-toggle" onClick={onToggle}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function scrollParent(el: HTMLElement): HTMLElement | undefined {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? undefined;
}
