"""Minimal Supabase access over PostgREST with httpx, using the service-role key (bypasses RLS; server side only)."""
import httpx

import config


class DB:
    def __init__(self, client: httpx.Client | None = None):
        key = config.service_role_key()
        self.base = config.supabase_url() + "/rest/v1"
        self.http = client or httpx.Client(
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}, timeout=30.0)

    def _check(self, r: httpx.Response):
        if r.status_code >= 400:
            # PostgREST error bodies describe the request, never the key.
            raise RuntimeError(f"Supabase {r.request.method} {r.request.url.path} -> {r.status_code}: {r.text[:500]}")
        return r

    def select(self, table: str, params: dict | None = None) -> list[dict]:
        return self._check(self.http.get(f"{self.base}/{table}", params={"select": "*", **(params or {})})).json()

    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        if not rows:
            return
        self._check(self.http.post(f"{self.base}/{table}", params={"on_conflict": on_conflict}, json=rows,
                                   headers={"Prefer": "resolution=merge-duplicates,return=minimal"}))

    def insert(self, table: str, rows: list[dict]) -> list[dict]:
        return self._check(self.http.post(f"{self.base}/{table}", json=rows, headers={"Prefer": "return=representation"})).json()

    def update(self, table: str, match: dict, values: dict) -> list[dict]:
        """PATCH rows where every column equals/filters as given (values like 'eq.x' pass through). Returns changed rows."""
        params = {k: (v if str(v).startswith(("eq.", "in.", "is.")) else f"eq.{v}") for k, v in match.items()}
        return self._check(self.http.patch(f"{self.base}/{table}", params=params, json=values,
                                           headers={"Prefer": "return=representation"})).json()
