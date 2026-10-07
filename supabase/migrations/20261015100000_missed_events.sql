-- Track record (WP3): delivery problems nobody warned about ("misses"). They have no alert, so they cannot live in
-- alert_outcomes (alert_id references alerts). Written by the worker's evaluate-alerts job; read by both sides of the pair.
-- part_id is required and cascades: reset_demo() restores parts from the snapshot, which clears these rows with them.
-- (A late receipt with no part has nothing to attribute a miss to; the worker skips it.)
create table public.missed_events (
  id bigint generated always as identity primary key,
  customer_id text not null references public.companies(id),
  supplier_id text not null references public.companies(id),
  part_id text not null references public.parts(id) on delete cascade,
  event_date date not null,
  evidence jsonb not null default '[]',      -- [{kind, ref, date, note}], same shape as alert_outcomes.evidence
  rule_version text,
  detected_at timestamptz not null default now(),
  unique (customer_id, supplier_id, part_id, event_date)
);
alter table public.missed_events enable row level security;
create policy "pair missed events" on public.missed_events for select to authenticated
  using (can_see_pair(customer_id, supplier_id));
grant select on public.missed_events to authenticated;
grant all on public.missed_events to service_role;
grant usage on all sequences in schema public to service_role;
