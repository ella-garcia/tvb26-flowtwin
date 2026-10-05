// snake_case (Postgres) <-> camelCase (app) for TOP-LEVEL row keys only.
// jsonb columns are already camelCase in the database, so their contents are left alone.

const toCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Fields where null is a real value in the app's types (everything else: null means "absent"). */
const KEEP_NULL = new Set(["daysToLineStop", "daysToRecover"]);

export function rowToApp<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = toCamel(k);
    if (v === null && !KEEP_NULL.has(key)) continue;
    out[key] = v;
  }
  return out as T;
}

export function rowsToApp<T>(rows: Record<string, unknown>[] | null | undefined): T[] {
  return (rows ?? []).map((r) => rowToApp<T>(r));
}

export function rowToDb(obj: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[toSnake(k)] = v;
  }
  return out;
}
