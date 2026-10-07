-- Phase 2 foundation (WP0, docs/phase2-plan-2026-10.md): tables and columns the Phase 2 packages build on.
-- Live data (EDI, ERP, CFDI, reply page) lands in the same intake tables as uploads, tagged with where it came from.
-- No amount, price or cost column is added anywhere: supplier money is dropped before it reaches the database.

-- ============================================================ helpers
-- Owner/ops of the company, or the key customer itself: may read that company's own records.
create or replace function public.is_own_party(cid text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(is_own_company(cid) or is_own_customer(cid), false) $$;

-- ============================================================ parts: origin and tariff code (gap 01), stock provenance
alter table public.parts add column origin_country text check (origin_country ~ '^[A-Z]{2}$');  -- ISO 3166-1 alpha-2
alter table public.parts add column hs_code text check (hs_code ~ '^[0-9]{4,10}$');            -- fracción arancelaria, digits only
alter table public.parts add column stock_source text;          -- 'upload' | 'edi' | 'erp' | 'seed' …
alter table public.parts add column stock_source_ref text;      -- file name, interchange number, sync run …
alter table public.parts add column stock_confidence numeric check (stock_confidence between 0 and 1);

-- ============================================================ provenance on intake rows
alter table public.receipts add column source text not null default 'upload';
alter table public.receipts add column source_ref text;
alter table public.receipts add column confidence numeric check (confidence between 0 and 1);
alter table public.demand_releases add column source text not null default 'upload';
alter table public.demand_releases add column source_ref text;
alter table public.demand_releases add column confidence numeric check (confidence between 0 and 1);

-- ============================================================ shipment notices (EDI 856/DESADV, CFDI, ERP, reply page)
-- What a supplier says it shipped. Quantities and dates only: no amounts.
create table public.shipment_notices (
  id bigint generated always as identity primary key,
  customer_id text not null references public.companies(id),
  supplier_id text not null references public.companies(id),
  part_id text not null references public.parts(id),
  quantity numeric not null check (quantity >= 0),
  ship_date date,
  expected_arrival date,
  carrier text,
  source text not null check (source in ('edi', 'cfdi', 'erp', 'reply', 'upload')),
  source_ref text not null,                  -- interchange control number, CFDI UUID, ERP document id …
  confidence numeric check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (source, source_ref, part_id)
);
create index shipment_notices_pair on public.shipment_notices (customer_id, supplier_id, expected_arrival);
alter table public.shipment_notices enable row level security;
create policy "pair shipment notices" on public.shipment_notices for select to authenticated
  using (can_see_pair(customer_id, supplier_id));

-- ============================================================ capacity events (supplier-reported, private to the supplier)
-- The key customer sees only their effect (the flex result on the risk row), never this table.
create table public.capacity_events (
  id bigint generated always as identity primary key,
  supplier_id text not null references public.companies(id),
  resource text,                             -- e.g. "Prensa 3"
  starts_on date not null,
  ends_on date,
  capacity_change_pct numeric not null check (capacity_change_pct between -1 and 1),  -- -0.3 = 30% less
  reason text,
  source text not null default 'supplier' check (source in ('supplier', 'reply', 'erp')),
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
alter table public.capacity_events enable row level security;
create policy "own capacity read" on public.capacity_events for select to authenticated using (is_own_company(supplier_id));
create policy "own capacity insert" on public.capacity_events for insert to authenticated with check (is_own_company(supplier_id));
create policy "own capacity update" on public.capacity_events for update to authenticated
  using (is_own_company(supplier_id)) with check (is_own_company(supplier_id));

-- ============================================================ signals: tariff/policy events and supplier input shortages
alter table public.signals drop constraint signals_kind_check;
alter table public.signals add constraint signals_kind_check
  check (kind in ('weather', 'road', 'theft', 'port', 'blockade', 'supplier', 'customs', 'policy', 'supplier-input'));
alter table public.signals add column supply_cut_pct numeric check (supply_cut_pct between 0 and 1);  -- supplier-input only
alter table public.signals add column affects jsonb;  -- {supplierIds?, originCountries?, hsPrefixes?}; null = by place/highway

-- ============================================================ contacts (people who get alerts; phone and WhatsApp opt-in)
-- companies.contact stays the primary contact until WP5 moves notifications here; sync_contacts() mirrors it.
create table public.contacts (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  name text, role text, email text,
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  locale text not null default 'es' check (locale in ('es', 'en')),
  whatsapp_opt_in_at timestamptz,
  whatsapp_opt_in_text text,                 -- the exact wording the person agreed to
  whatsapp_opt_out_at timestamptz,
  is_primary boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index contacts_one_primary on public.contacts (company_id) where is_primary;
alter table public.contacts enable row level security;
create policy "own contacts read" on public.contacts for select to authenticated using (is_own_party(company_id));
create policy "own contacts insert" on public.contacts for insert to authenticated with check (is_own_party(company_id));
create policy "own contacts update" on public.contacts for update to authenticated
  using (is_own_party(company_id)) with check (is_own_party(company_id));

-- A key customer sees who at each of its suppliers gets alerts and on which channels, never their phone numbers.
create view public.pair_contacts with (security_barrier = true) as
  select c.id, c.company_id, c.name, c.role,
         (c.email is not null) as has_email,
         (c.phone_e164 is not null and c.whatsapp_opt_in_at is not null and c.whatsapp_opt_out_at is null) as has_whatsapp
  from public.contacts c
  where is_own_party(c.company_id)
     or exists (select 1 from public.relationships r
                where r.supplier_id = c.company_id and my_role() = 'customer' and r.customer_id = my_company());

-- Mirror companies.contact into the primary contact. Keeps phone and opt-in fields; idempotent.
create or replace function public.sync_contacts() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into contacts (id, company_id, name, role, email, locale, is_primary, updated_at)
  select c.id || '-primary', c.id, c.contact->>'name', c.contact->>'role', nullif(c.contact->>'email', ''),
         case when c.kind = 'supplier' then 'es' else 'en' end, true, now()
  from companies c where c.contact is not null
  on conflict (id) do update set name = coalesce(excluded.name, contacts.name), role = coalesce(excluded.role, contacts.role),
                                 email = excluded.email, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.sync_contacts() from public, anon, authenticated;
select public.sync_contacts();

-- ============================================================ notifications: provider ids, receipts, template, contact
alter table public.alert_notifications add column contact_id text references public.contacts(id) on delete set null;
alter table public.alert_notifications add column template text;
alter table public.alert_notifications add column provider_message_id text;
alter table public.alert_notifications add column delivered_at timestamptz;
alter table public.alert_notifications add column read_at timestamptz;
create index alert_notifications_provider on public.alert_notifications (provider_message_id) where provider_message_id is not null;

-- ============================================================ twin track record (WP3)
-- One snapshot per pair per day, so predictions can be checked against what happened.
create table public.risk_history (
  customer_id text not null references public.companies(id),
  supplier_id text not null references public.companies(id),
  as_of date not null,
  level text not null check (level in ('green', 'amber', 'red')),
  score numeric not null,
  days_to_line_stop numeric,
  part_stop_days jsonb,
  projection jsonb,
  drivers jsonb,
  recorded_at timestamptz not null default now(),
  primary key (customer_id, supplier_id, as_of)
);
alter table public.risk_history enable row level security;
create policy "pair risk history" on public.risk_history for select to authenticated using (can_see_pair(customer_id, supplier_id));

create table public.alert_outcomes (
  alert_id text primary key references public.alerts(id) on delete cascade,
  predicted_stop_date date,
  part_ids text[] not null default '{}',
  outcome text not null default 'pending' check (outcome in ('pending', 'hit', 'prevented', 'miss', 'false-alarm', 'unknown')),
  evidence jsonb not null default '[]',      -- receipts / shipment notices the verdict rests on
  rule_version text,
  evaluated_at timestamptz
);
alter table public.alert_outcomes enable row level security;
create policy "pair alert outcomes" on public.alert_outcomes for select to authenticated using (
  exists (select 1 from alerts a where a.id = alert_id and can_see_pair(a.customer_id, a.supplier_id)));

-- ============================================================ connections (EDI, ERP, CFDI) and their runs
-- Secrets never live here: secret_ref names a secret in the worker's environment / secret manager.
create table public.connections (
  id text primary key,
  company_id text not null references public.companies(id),
  kind text not null check (kind in ('edi', 'erp', 'cfdi')),
  provider text not null,                    -- 'edi-inbox', 'sap-s4', 'syntage' …
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'error')),
  config jsonb not null default '{}',
  secret_ref text,
  consent_text text,                         -- what the company agreed to (CFDI)
  consent_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.connections enable row level security;
create policy "own connections" on public.connections for select to authenticated using (is_own_party(company_id));

create table public.integration_runs (
  id bigint generated always as identity primary key,
  connection_id text not null references public.connections(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  rows int not null default 0,
  issues jsonb not null default '[]',
  cursor text,                               -- where the next run starts
  error text
);
alter table public.integration_runs enable row level security;
create policy "own integration runs" on public.integration_runs for select to authenticated using (
  exists (select 1 from connections c where c.id = connection_id and is_own_party(c.company_id)));

-- ============================================================ uploads and jobs
-- The tier1-data page shows 'processing' and 'failed'; the old check rejected them.
alter table public.uploads drop constraint uploads_status_check;
alter table public.uploads add constraint uploads_status_check
  check (status in ('waiting', 'processing', 'uploaded', 'needs-input', 'failed'));

alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check
  check (kind in ('parse-upload', 'ingest-signals', 'recompute-risk', 'build-twin',
                  'sync-connection', 'ingest-edi', 'evaluate-alerts', 'extract-reply', 'send-digest'));
-- The app still may queue only parse-upload and recompute-risk ("queue jobs" policy is unchanged).

-- ============================================================ grants
grant select on public.shipment_notices, public.capacity_events, public.contacts, public.pair_contacts,
  public.risk_history, public.alert_outcomes, public.connections, public.integration_runs to authenticated;
grant insert, update on public.capacity_events, public.contacts to authenticated;
grant all on public.shipment_notices, public.capacity_events, public.contacts, public.risk_history,
  public.alert_outcomes, public.connections, public.integration_runs to service_role;
grant select on public.pair_contacts to service_role;
grant usage on all sequences in schema public to authenticated, service_role;

-- ============================================================ reset_demo(): also clear Phase 2 data
create or replace function public.reset_demo()
returns void language plpgsql security definer set search_path = public as $$
declare snap jsonb; new_ids text[]; fk record;
begin
  if not (select testing_mode from app_settings where id = 1) then raise exception 'Testing mode is off'; end if;
  -- Phase 2 live data: none in the seed. shipment_notices first (it points at parts, which are restored below).
  delete from shipment_notices;
  delete from capacity_events;
  delete from risk_history;
  delete from alert_outcomes;
  delete from connections;                   -- cascades to integration_runs
  delete from receipts;
  delete from demand_releases;
  select rows into snap from demo_snapshot where name = 'companies';
  if snap is not null then
    select array_agg(id) into new_ids from companies
    where id not in (select e->>'id' from jsonb_array_elements(snap) e);
    if new_ids is not null then
      for fk in select c.conrelid::regclass as tbl, a.attname as col
                from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                where c.contype = 'f' and c.confrelid = 'public.companies'::regclass and c.conrelid <> 'public.companies'::regclass
      loop
        execute format('delete from %s where %I = any($1)', fk.tbl, fk.col) using new_ids;
      end loop;
      delete from companies where id = any(new_ids);
    end if;
    perform _restore_snapshot('companies', array['id']);
  end if;
  select rows into snap from demo_snapshot where name = 'relationships';
  if snap is not null then
    delete from relationships r where not exists (select 1 from jsonb_array_elements(snap) e
      where e->>'supplier_id' = r.supplier_id and e->>'customer_id' = r.customer_id);
    perform _restore_snapshot('relationships', array['supplier_id', 'customer_id']);
  end if;
  perform _restore_snapshot('vehicle_programs');
  perform _restore_snapshot('parts');
  perform _restore_snapshot('risks');
  perform _restore_snapshot('supplier_profiles');
  perform _restore_snapshot('invites');
  perform _restore_snapshot('consolidation_plans');
  perform _restore_snapshot('circular_profiles');
  perform _restore_snapshot('requests');
  perform _restore_snapshot('shares');
  select rows into snap from demo_snapshot where name = 'alerts';
  if snap is not null then
    delete from alerts where id not in (select e->>'id' from jsonb_array_elements(snap) e);
    perform _restore_snapshot('alerts', array['id']);
    update alerts set resolved_by = null, updated_at = now() where id in (select e->>'id' from jsonb_array_elements(snap) e);
  end if;
  -- Contacts: drop the ones testers added, then mirror the restored companies again.
  delete from contacts where not is_primary;
  update contacts set phone_e164 = null, whatsapp_opt_in_at = null, whatsapp_opt_in_text = null, whatsapp_opt_out_at = null;
  perform sync_contacts();
end $$;
