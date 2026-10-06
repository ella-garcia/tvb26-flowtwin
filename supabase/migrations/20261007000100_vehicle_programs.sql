-- Vehicle programmes (professor feedback, Oct 2026): a Tier 1 plant builds for several models at once,
-- so each part maps to the models it goes into and the risk board can be read per model.
create table public.vehicle_programs (
  id text primary key,
  customer_id text not null references public.companies(id),
  oem text not null,
  model text not null,
  oem_plant text not null,
  daily_vehicles numeric not null check (daily_vehicles >= 0)
);
alter table public.parts add column program_ids text[] not null default '{}';
-- Per-part stop day from the risk engine ({part_id: day}), so a stop can be attributed to a model.
alter table public.risks add column part_stop_days jsonb not null default '{}';

alter table public.vehicle_programs enable row level security;
-- The key customer reads its own programmes; a supplier reads the ones its parts go into.
create policy "programme readers" on public.vehicle_programs for select to authenticated using (
  is_own_customer(customer_id)
  or exists (select 1 from public.parts p where p.customer_id = vehicle_programs.customer_id
             and vehicle_programs.id = any (p.program_ids) and is_own_company(p.supplier_id)));
grant select on public.vehicle_programs to authenticated;
grant all on public.vehicle_programs to service_role;
