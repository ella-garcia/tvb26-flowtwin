-- Phase 2, weeks 2–3: Tier 1 data intake, supplier profiles, live signals, notifications, scheduling.

-- ============================================================ helpers
-- The key customer role of the given company (Tier 1): may upload and read its own intake data.
create or replace function public.is_own_customer(cid text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(my_role() = 'customer' and my_company() = cid, false) $$;

-- ============================================================ supplier profiles
-- Engine inputs per (customer, supplier). Replaces worker/data/supplier_profiles.json.
-- Written by the worker (service role) from receipts and supplier operating data.
create table public.supplier_profiles (
  customer_id text not null references public.companies(id),
  supplier_id text not null references public.companies(id),
  highways text[] not null default '{}',
  lead_time_mean_days numeric,
  lead_time_variability numeric,             -- coefficient of variation, 0..1
  utilization numeric,                       -- bottleneck utilisation, 0..1
  capacity_ceiling numeric,                  -- max sustainable utilisation, 0..1
  finished_goods_days numeric,               -- supplier's finished-goods cover for this customer
  bottleneck text,
  otif_weekly jsonb not null default '[]',   -- last 12 weeks, oldest first, 0..1
  data_status text not null default 'public-only' check (data_status in ('connected', 'invited', 'public-only')),
  source text not null default 'seed',       -- 'seed' | 'receipts' | 'supplier' | 'mixed'
  updated_at timestamptz not null default now(),
  primary key (customer_id, supplier_id)
);
alter table public.supplier_profiles enable row level security;
create policy "pair profiles" on public.supplier_profiles for select to authenticated using (can_see_pair(customer_id, supplier_id));
grant select on public.supplier_profiles to authenticated;
grant all on public.supplier_profiles to service_role;

-- ============================================================ Tier 1 intake tables
-- Demand releases (forecast / EDI schedule) per part and week.
create table public.demand_releases (
  id bigint generated always as identity primary key,
  customer_id text not null references public.companies(id),
  part_id text not null references public.parts(id),
  week_start date not null,
  quantity numeric not null,
  upload_id text,                            -- uploads.file_name batch marker
  unique (customer_id, part_id, week_start)
);
-- Goods receipts at the key customer: the delivery history that measures each supplier.
create table public.receipts (
  id bigint generated always as identity primary key,
  customer_id text not null references public.companies(id),
  supplier_id text not null references public.companies(id),
  part_id text references public.parts(id),
  po_number text not null,
  promised_date date not null,
  received_date date,
  quantity_ordered numeric not null,
  quantity_received numeric not null default 0,
  upload_id text,
  unique (customer_id, po_number, part_id)
);
alter table public.demand_releases enable row level security;
alter table public.receipts enable row level security;

create policy "customer releases" on public.demand_releases for select to authenticated using (
  is_own_customer(customer_id)
  or exists (select 1 from parts p where p.id = part_id and is_own_company(p.supplier_id)));
create policy "pair receipts" on public.receipts for select to authenticated using (can_see_pair(customer_id, supplier_id));
grant select on public.demand_releases, public.receipts to authenticated;
grant all on public.demand_releases, public.receipts to service_role;

-- ============================================================ uploads: also for key customers
alter table public.uploads add column issues jsonb not null default '[]';      -- [{row, column, message, severity}]
alter table public.uploads add column mapping jsonb not null default '{}';     -- {sourceColumn: field}
alter table public.uploads add column job_id bigint;
create policy "customer uploads read" on public.uploads for select to authenticated using (is_own_customer(company_id));
create policy "customer uploads insert" on public.uploads for insert to authenticated with check (is_own_customer(company_id));
create policy "customer uploads update" on public.uploads for update to authenticated
  using (is_own_customer(company_id)) with check (is_own_customer(company_id));
-- Upload kinds for key customers: tier1-suppliers, tier1-parts, tier1-stock, tier1-releases, tier1-receipts.

-- Jobs: key customers may queue parse-upload / recompute-risk for their own company.
drop policy "queue jobs" on public.jobs;
create policy "queue jobs" on public.jobs for insert to authenticated
  with check (created_by = auth.uid() and kind in ('parse-upload', 'recompute-risk')
              and (company_id is null or is_own_company(company_id) or is_own_customer(company_id)));

-- ============================================================ storage bucket for uploaded files
-- Path convention: <company_id>/<kind>/<timestamp>-<file name>. Private bucket.
insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, 20971520)
on conflict (id) do nothing;

create policy "upload own company files" on storage.objects for insert to authenticated with check (
  bucket_id = 'uploads' and (storage.foldername(name))[1] = public.my_company()
  and public.my_role() in ('owner', 'ops', 'customer'));
create policy "read own company files" on storage.objects for select to authenticated using (
  bucket_id = 'uploads' and (storage.foldername(name))[1] = public.my_company()
  and public.my_role() in ('owner', 'ops', 'customer'));

-- ============================================================ signals: short label + where they came from
alter table public.signals add column short_label text;          -- e.g. "Rainy season" for driver text
alter table public.signals add column source_id text;            -- 'file' | 'open-meteo' | 'smn' | …
alter table public.signals add column external_ref text;         -- id in the source system
alter table public.signals add column active boolean not null default true;

-- ============================================================ notifications
create table public.alert_notifications (
  id bigint generated always as identity primary key,
  alert_id text not null references public.alerts(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  recipient text not null,
  audience text not null check (audience in ('customer', 'supplier')),
  status text not null check (status in ('sent', 'dry-run', 'failed', 'skipped')),
  reason text not null,                     -- 'new-alert' | 'level-up' | 'supplier-responded' | …
  sent_at timestamptz not null default now(),
  error text
);
alter table public.alert_notifications enable row level security;
create policy "pair notifications" on public.alert_notifications for select to authenticated using (
  exists (select 1 from alerts a where a.id = alert_id and can_see_pair(a.customer_id, a.supplier_id)));
grant select on public.alert_notifications to authenticated;
grant all on public.alert_notifications to service_role;

-- Alerts: who resolved them (a person or the engine when the risk turned green).
alter table public.alerts add column resolved_by text;           -- 'customer' | 'engine'
alter table public.alerts add column updated_at timestamptz not null default now();

-- ============================================================ scheduling (pg_cron + pg_net → worker)
-- Worker endpoint and token live in a table no app role can read.
create table public.worker_config (
  id int primary key default 1 check (id = 1),
  worker_url text,          -- e.g. https://flowtwin-worker-xxxx.run.app ; null = scheduling disabled
  worker_token text         -- bearer token the worker expects (WORKER_TOKEN)
);
insert into public.worker_config (id) values (1);
alter table public.worker_config enable row level security;     -- no policies: service role / postgres only
revoke all on public.worker_config from anon, authenticated;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Calls the worker's hourly endpoint. Does nothing until worker_url is set.
create or replace function public.trigger_worker(path text default '/cron/hourly') returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare cfg public.worker_config; req bigint;
begin
  select * into cfg from worker_config where id = 1;
  if cfg.worker_url is null then return null; end if;
  select net.http_post(
    url := rtrim(cfg.worker_url, '/') || path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(cfg.worker_token, '')),
    body := '{}'::jsonb
  ) into req;
  return req;
end $$;
revoke execute on function public.trigger_worker(text) from public, anon, authenticated;

-- Hourly: pull signals, recompute risk, send notifications. Every 2 minutes: drain queued jobs (uploads).
select cron.schedule('flowtwin-hourly', '5 * * * *', $$ select public.trigger_worker('/cron/hourly') $$);
select cron.schedule('flowtwin-drain-jobs', '*/2 * * * *', $$ select public.trigger_worker('/jobs/drain') $$);
