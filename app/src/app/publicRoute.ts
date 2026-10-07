// Public routes: pages a person opens from a WhatsApp or email link without logging in (#r/<token>).
const PUBLIC = /^#r\/([A-Za-z0-9_-]{16,128})$/;

/** The reply token when the hash is a public reply link, else null. */
export function publicToken(hash: string = location.hash): string | null {
  return PUBLIC.exec(hash)?.[1] ?? null;
}
