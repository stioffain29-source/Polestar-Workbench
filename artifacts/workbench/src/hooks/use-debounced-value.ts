import { useEffect, useState } from "react";

/**
 * Debounce a fast-changing value (typically a search box) before it is allowed
 * to drive a network query, so typing fires one request instead of one per
 * keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
