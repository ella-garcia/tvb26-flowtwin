-- FlowTwin core schema (Phase 2). Mirrors app/src/lib/types.ts.
-- Columns are snake_case; nested structures stay JSONB in camelCase so the app can use them as-is.
-- Sharing is enforced here with row-level security. The app's data layer repeats the rules, but this is the source of truth.

-- ============================================================ identities
-- One profile per signed-in user. During testing every browser signs in anonymously
-- and the testing switcher calls switch_test_identity() to change role and company.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('admin', 'owner', 'ops', 'customer')),
  company_id text not null default 'qss',
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  id int primary key default 1 check (id = 1),
  testing_mode boolean not null default true,       -- allows switch_test_identity(); turn off with real logins
  line_stop_cost_eur_per_minute numeric not null default 15000,
  contract_demand_swing numeric not null default 0.15,
  line_hours_per_day numeric not null default 16,
  as_of date not null default current_date
);
insert into public.app_settings (id) values (1);

-- Helpers used by every policy. security definer so they can read profiles under RLS.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.profiles where user_id = auth.uid() $$;

create or replace function public.my_company() returns text
language sql stable security definer set search_path = public as
$$ select company_id from public.profiles where user_id = auth.uid() $$;

-- Owner or ops of the given company: may read and write its operating data.
create or replace function public.is_own_company(cid text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(my_role() in ('owner', 'ops') and my_company() = cid, false) $$;

-- Key customer of the pair, or the supplier itself: may read risk, alerts and parts for the pair.
create or replace function public.can_see_pair(customer text, supplier text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((my_role() = 'customer' and my_company() = customer)
                or (my_role() in ('owner', 'ops') and my_company() = supplier), false) $$;

-- ============================================================ directory (readable by any signed-in user)
create table public.companies (
  id text primary key,
  name text not null,
  city text not null,
  state text not null,
  lat double precision not null,
  lon double precision not null,
  kind text not null check (kind in ('supplier', 'customer')),
  size_band text not null check (size_band in ('micro', 'small', 'medium', 'large')),
  employees int not null,
  scian text not null,
  pack_ids text[] not null default '{auto}',
  synthetic boolean not null default true,
  contact jsonb
);

create table public.relationships (
  supplier_id text not null references public.companies(id),
  customer_id text not null,              -- a company id, or a partner id when the customer is not on the platform
  chain_position text not null check (chain_position in ('brand', 'direct', 'sub', 'raw', 'distributor')),
  share_of_sales numeric not null default 0,
  requirements jsonb not null,
  primary key (supplier_id, customer_id)
);

create table public.signals (
  id text primary key,
  kind text not null check (kind in ('weather', 'road', 'theft', 'port', 'blockade', 'supplier')),
  title text not null,
  description text not null,
  state text not null,
  lat double precision not null,
  lon double precision not null,
  radius_km numeric not null,
  highways text[] not null default '{}',
  starts_at date not null,
  ends_at date not null,
  severity text not null check (severity in ('low', 'medium', 'high')),
  transit_multiplier numeric not null default 1,
  source text not null,
  provenance text not null check (provenance in ('measured', 'estimated')),
  ingested_at timestamptz not null default now()
);

create table public.emission_factors (
  id text not null,
  version int not null,
  name text not null,
  value numeric not null,
  unit text not null,
  scope int not null check (scope in (1, 2, 3)),
  source text not null,
  year int not null,
  primary key (id, version)
);

-- ============================================================ supplier operating data (own company only)
create table public.sites (
  id text primary key, company_id text not null references public.companies(id),
  name text not null, type text not null, city text not null,
  lat double precision not null, lon double precision not null,
  pallet_positions int not null default 0, rented_positions int not null default 0
);
create table public.partners (
  id text primary key, company_id text not null references public.companies(id),
  name text not null, role text not null check (role in ('supplier', 'customer')), city text not null,
  lat double precision not null, lon double precision not null,
  linked_company_id text, material text, lead_time_days numeric, lead_time_variability numeric
);
-- Lanes carry freight costs: never readable outside the owning company.
create table public.lanes (
  id text primary key, company_id text not null references public.companies(id),
  from_id text not null, to_id text not null,
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),
  highway text, km numeric not null, trips_per_week numeric not null, fill_rate numeric not null,
  theft_risk text not null check (theft_risk in ('low', 'medium', 'high')),
  night_share numeric not null default 0, cost_per_trip_mxn numeric not null
);
create table public.machines (
  id text primary key, company_id text not null references public.companies(id),
  name text not null, capacity_tonnes numeric not null, shifts_per_week numeric not null, utilization numeric not null
);
create table public.certifications (
  company_id text not null references public.companies(id), name text not null, valid_until date not null,
  primary key (company_id, name)
);
create table public.kpis (
  id bigint generated always as identity primary key,
  company_id text not null references public.companies(id), kpi_id text not null, customer_id text,
  value numeric not null, provenance text not null, as_of date not null
);
create table public.energy (
  company_id text not null references public.companies(id), month text not null,
  electricity_kwh numeric not null, diesel_litres numeric not null, natural_gas_m3 numeric not null, source text not null,
  primary key (company_id, month)
);
create table public.materials (
  id bigint generated always as identity primary key,
  company_id text not null references public.companies(id), material text not null, tonnes numeric not null, year int not null, source text not null
);
create table public.shipments (
  id bigint generated always as identity primary key,
  company_id text not null references public.companies(id), customer_id text not null, year int not null, tonnes numeric not null
);
create table public.twins (
  company_id text primary key references public.companies(id),
  synced_through date not null, built_at timestamptz not null, counts jsonb not null,
  accuracy jsonb not null, overall_accuracy numeric not null, days jsonb not null
);
create table public.uploads (
  company_id text not null references public.companies(id),
  kind text not null, file_name text not null, rows int not null default 0, source text not null,
  status text not null check (status in ('waiting', 'uploaded', 'needs-input')),
  uploaded_at timestamptz, storage_path text,
  primary key (company_id, kind)
);

-- ============================================================ early warning (key customer + the supplier itself)
create table public.parts (
  id text primary key,
  number text not null, name text not null,
  supplier_id text not null references public.companies(id),
  customer_id text not null references public.companies(id),
  unit_cost_mxn numeric not null,          -- the key customer's purchase price, its own data
  daily_usage numeric not null, on_hand numeric not null, days_of_cover numeric not null,
  single_source boolean not null default false,
  criticality text not null check (criticality in ('line-stopper', 'high', 'normal'))
);
create table public.risks (
  customer_id text not null references public.companies(id),
  supplier_id text not null references public.companies(id),
  level text not null check (level in ('green', 'amber', 'red')),
  score numeric not null,
  normal_transit_days numeric not null, expected_transit_days numeric not null, worst_case_transit_days numeric not null,
  min_cover_days numeric not null, days_to_line_stop numeric, line_stop_exposure_eur numeric not null,
  drivers jsonb not null, flex jsonb not null, otif_trend jsonb not null, projection jsonb not null,
  data_status text not null check (data_status in ('connected', 'invited', 'public-only')),
  updated_at date not null,
  primary key (customer_id, supplier_id)
);
create table public.alerts (
  id text primary key,
  customer_id text not null references public.companies(id),
  supplier_id text not null references public.companies(id),
  part_ids text[] not null default '{}', signal_id text,
  level text not null check (level in ('green', 'amber', 'red')),
  title text not null, message text not null, created_at date not null, expected_shortfall_date date,
  line_stop_exposure_eur numeric not null,
  status text not null check (status in ('new', 'acknowledged', 'supplier-responded', 'resolved')),
  actions jsonb not null default '[]', chosen_action_id text, supplier_response jsonb
);
create table public.invites (
  id text primary key,
  customer_id text not null references public.companies(id),
  supplier_id text, supplier_name text not null, contact_email text not null,
  sent_at date not null, status text not null check (status in ('sent', 'joined')), plan text not null default 'sponsored'
);

-- Requests and shares (Phase 4 scorecards / carbon, kept for continuity with v0).
create table public.requests (
  id text primary key, from_company_id text not null, to_company_id text not null,
  items text[] not null, fiscal_year int not null, sent_at date not null, due_date date not null,
  status text not null, note text
);
create table public.shares (
  id text primary key, supplier_id text not null, customer_id text not null, request_id text,
  items text[] not null, approved_by text not null, approved_at date not null, version int not null,
  revoked boolean not null default false, scorecard jsonb, carbon jsonb
);

-- ============================================================ worker jobs
create table public.jobs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('parse-upload', 'ingest-signals', 'recompute-risk', 'build-twin')),
  company_id text,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz, error text
);
create index jobs_queued on public.jobs (created_at) where status = 'queued';

-- Seed snapshot used by reset_demo(): the mutable tables as first loaded.
create table public.demo_snapshot (name text primary key, rows jsonb not null);

-- ============================================================ row-level security
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.companies enable row level security;
alter table public.relationships enable row level security;
alter table public.signals enable row level security;
alter table public.emission_factors enable row level security;
alter table public.sites enable row level security;
alter table public.partners enable row level security;
alter table public.lanes enable row level security;
alter table public.machines enable row level security;
alter table public.certifications enable row level security;
alter table public.kpis enable row level security;
alter table public.energy enable row level security;
alter table public.materials enable row level security;
alter table public.shipments enable row level security;
alter table public.twins enable row level security;
alter table public.uploads enable row level security;
alter table public.parts enable row level security;
alter table public.risks enable row level security;
alter table public.alerts enable row level security;
alter table public.invites enable row level security;
alter table public.requests enable row level security;
alter table public.shares enable row level security;
alter table public.jobs enable row level security;
alter table public.demo_snapshot enable row level security;   -- no policies: service role only

create policy "own profile" on public.profiles for select to authenticated using (user_id = auth.uid());
create policy "settings readable" on public.app_settings for select to authenticated using (true);

-- Directory and reference data
create policy "directory" on public.companies for select to authenticated using (true);
create policy "signals" on public.signals for select to authenticated using (true);
create policy "factors" on public.emission_factors for select to authenticated using (true);
create policy "relationships" on public.relationships for select to authenticated using (
  is_own_company(supplier_id) or (my_role() = 'customer' and my_company() = customer_id) or my_role() = 'admin');

-- Own operating data: read and write only by owner/ops of the same company. No other policy exists,
-- so a key customer or admin gets zero rows (costs in lanes are therefore never visible).
do $$
declare t text;
begin
  foreach t in array array['sites','partners','lanes','machines','certifications','kpis','energy','materials','shipments','twins','uploads'] loop
    execute format('create policy "own company read" on public.%I for select to authenticated using (is_own_company(company_id))', t);
    execute format('create policy "own company insert" on public.%I for insert to authenticated with check (is_own_company(company_id))', t);
    execute format('create policy "own company update" on public.%I for update to authenticated using (is_own_company(company_id)) with check (is_own_company(company_id))', t);
  end loop;
end $$;

-- Early warning: the key customer and the supplier see the same rows about their pair.
create policy "pair parts" on public.parts for select to authenticated using (can_see_pair(customer_id, supplier_id));
create policy "pair risks" on public.risks for select to authenticated using (can_see_pair(customer_id, supplier_id));
create policy "pair alerts" on public.alerts for select to authenticated using (can_see_pair(customer_id, supplier_id));
-- Alert changes go through the RPCs below, never direct updates.

create policy "my invites" on public.invites for select to authenticated
  using (my_role() = 'customer' and my_company() = customer_id);
create policy "send invites" on public.invites for insert to authenticated
  with check (my_role() = 'customer' and my_company() = customer_id and status = 'sent' and plan = 'sponsored');

create policy "requests" on public.requests for select to authenticated using (
  (my_role() = 'customer' and my_company() = from_company_id) or is_own_company(to_company_id));
create policy "shares" on public.shares for select to authenticated using (not revoked and (
  (my_role() = 'customer' and my_company() = customer_id) or is_own_company(supplier_id)));

create policy "my jobs read" on public.jobs for select to authenticated using (created_by = auth.uid());
create policy "queue jobs" on public.jobs for insert to authenticated
  with check (created_by = auth.uid() and kind in ('parse-upload', 'recompute-risk') and (company_id is null or is_own_company(company_id)));

-- ============================================================ RPCs (all writes with business rules)
-- Testing only: change the caller's role and company. Disabled when testing_mode is off.
create or replace function public.switch_test_identity(new_role text, new_company text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not (select testing_mode from app_settings where id = 1) then raise exception 'Testing mode is off'; end if;
  if new_role not in ('admin', 'owner', 'ops', 'customer') then raise exception 'Unknown role %', new_role; end if;
  if new_role = 'customer' and not exists (select 1 from companies where id = new_company and kind = 'customer') then
    raise exception 'Company % is not a key customer', new_company; end if;
  if new_role in ('owner', 'ops') and not exists (select 1 from companies where id = new_company and kind = 'supplier') then
    raise exception 'Company % is not a supplier', new_company; end if;
  insert into profiles (user_id, role, company_id, updated_at) values (auth.uid(), new_role, new_company, now())
  on conflict (user_id) do update set role = excluded.role, company_id = excluded.company_id, updated_at = now()
  returning * into p;
  return p;
end $$;

-- Key customer: acknowledge an alert and record the chosen action.
create or replace function public.acknowledge_alert(alert_id text, action_id text default null)
returns public.alerts language plpgsql security definer set search_path = public as $$
declare a public.alerts;
begin
  update alerts set status = case when status = 'new' then 'acknowledged' else status end,
                    chosen_action_id = coalesce(action_id, chosen_action_id)
  where id = alert_id and my_role() = 'customer' and customer_id = my_company()
  returning * into a;
  if a.id is null then raise exception 'Alert not found or not yours'; end if;
  return a;
end $$;

create or replace function public.resolve_alert(alert_id text)
returns public.alerts language plpgsql security definer set search_path = public as $$
declare a public.alerts;
begin
  update alerts set status = 'resolved'
  where id = alert_id and my_role() = 'customer' and customer_id = my_company()
  returning * into a;
  if a.id is null then raise exception 'Alert not found or not yours'; end if;
  return a;
end $$;

-- Supplier: respond to an alert about itself.
create or replace function public.respond_alert(alert_id text, response jsonb)
returns public.alerts language plpgsql security definer set search_path = public as $$
declare a public.alerts;
begin
  update alerts set status = 'supplier-responded', supplier_response = response
  where id = alert_id and is_own_company(supplier_id) and status <> 'resolved'
  returning * into a;
  if a.id is null then raise exception 'Alert not found, resolved, or not about your company'; end if;
  return a;
end $$;

-- Testing only: restore alerts and invites to the seed.
create or replace function public.reset_demo()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (select testing_mode from app_settings where id = 1) then raise exception 'Testing mode is off'; end if;
  delete from alerts;
  insert into alerts select * from jsonb_populate_recordset(null::alerts, (select rows from demo_snapshot where name = 'alerts'));
  delete from invites;
  insert into invites select * from jsonb_populate_recordset(null::invites, (select rows from demo_snapshot where name = 'invites'));
end $$;

-- Only signed-in users may call the RPCs.
revoke execute on function public.switch_test_identity(text, text), public.acknowledge_alert(text, text),
  public.resolve_alert(text), public.respond_alert(text, jsonb), public.reset_demo() from public, anon;
grant execute on function public.switch_test_identity(text, text), public.acknowledge_alert(text, text),
  public.resolve_alert(text), public.respond_alert(text, jsonb), public.reset_demo() to authenticated;

-- New users (including anonymous testers) start as the key customer QRO Seating Systems.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
