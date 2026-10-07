// Public pages render outside AppProvider and the Shell: no testing toggles, no anonymous sign-in, no identity switch.
// Access is decided server-side by the signed token (WP6), never by the app. Route matching: ./publicRoute.ts.
import ReplyPage from "../pages/reply";

export function PublicRoot({ token }: { token: string }) {
  return <ReplyPage token={token} />;
}
