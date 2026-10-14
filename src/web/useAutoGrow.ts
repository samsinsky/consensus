import { useLayoutEffect, type RefObject } from 'react';

/** Grows a textarea with its text; CSS max-height caps it, and it scrolls beyond that. */
export function useAutoGrow(box: RefObject<HTMLTextAreaElement | null>, text: string) {
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    // Show a scrollbar only once the CSS cap stops the growth.
    el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? 'auto' : 'hidden';
  }, [box, text]);
}
