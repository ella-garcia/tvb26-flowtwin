# Database tests

Proves the sharing rules (RLS and RPCs) by acting as each role. Runs in one transaction that is rolled back, so it leaves no data behind.

```
supabase db reset && supabase/tests/run.sh
```

Prints `PASS`/`FAIL` per assertion and exits non-zero if any fail. Requires the local stack (`supabase start`) and Docker.
