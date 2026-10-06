// Load data through the scoped data layer, turning a refused read (AccessDeniedError) into a value
// the page can render. Any other error is a bug and is rethrown.
import { useMemo, type DependencyList } from "react";
import { AccessDeniedError } from "./dataLayer";

export type Scoped<T> = { ok: true; data: T } | { ok: false; error: string };

/** Run `read` once per change of `deps`. Pair with <ScopedError> from components/shared for the refused case. */
export function useScoped<T>(read: () => T, deps: DependencyList): Scoped<T> {
  // The caller lists what `read` depends on, like a useMemo dependency array.
  // eslint-disable-next-line react/use-memo, react-hooks/exhaustive-deps
  return useMemo(() => scoped(read), deps);
}

/** The same without memoising, for reads that are cheap or inside a loop. */
export function scoped<T>(read: () => T): Scoped<T> {
  try {
    return { ok: true, data: read() };
  } catch (e) {
    if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
    throw e;
  }
}
