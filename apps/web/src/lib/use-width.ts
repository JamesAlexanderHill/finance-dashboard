import { useEffect, useRef, useState } from 'react';

/** Tracks an element's content width (0 until mounted, so charts render client-side only). */
export function useWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
