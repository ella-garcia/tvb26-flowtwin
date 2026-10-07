-- Circular and sustainability layer (Sadiq et al. 2026, Technovation 157, 103653).
-- Transport footprint per supplier pair, Tier 1-led load consolidation (milk runs), supplier-reported circular
-- profiles shared with a key customer only by consent. All figures are physical units; no money here.

-- ============================================================ settings
alter table public.app_settings add column pallets_per_truck numeric not null default 24;
alter table public.app_settings add column expedite_trips_per_short_day numeric not null default 1;   -- expedited trips per line-down day avoided
alter table public.app_settings add column expedite_fill_rate numeric not null default 0.3;          -- expedites run mostly empty
alter table public.app_settings add column milkrun_radius_km numeric not null default 120;           -- suppliers this close can share a loop

-- ============================================================ engine outputs
-- Transport footprint of one (customer, supplier) pair, computed by the engine (worker/engine/circular.py):
-- {roadKm, trucksPerWeek, palletsPerWeek, fillRate, truckKmPerWeek, co2ePerWeekKg, expediteKmPerShortDay,
--  expediteCo2ePerShortDayKg, factorId, factorVersion, provenance}
alter table public.risks add column circular jsonb;

-- Units per pallet for a part (the key customer's own logistics data). Null = pack default, marked estimated.
alter table public.parts add column units_per_pallet numeric;

-- Load-consolidation plan for one key customer, built from its own demand (parts' daily usage) and supplier
-- locations only: no supplier lanes, costs or private data are used, so nothing private leaks to the customer.
create table public.consolidation_plans (
  customer_id text primary key references public.companies(id),
  generated_at timestamptz not null default now(),
  loops jsonb not null default '[]',      -- [{id, members:[supplierId…], sequence, trucksBefore, trucksAfter, kmBefore, kmAfter, fillBefore, fillAfter, co2eBeforeKg, co2eAfterKg, deliveriesPerWeek, provenance}]
  totals jsonb not null default '{}',     -- {trucksSaved, kmSaved, co2eSavedKg, suppliersInLoops, excluded:[{supplierId, reason}]}
  updated_at timestamptz not null default now()
);
alter table public.consolidation_plans enable row level security;
create policy "own consolidation plan" on public.consolidation_plans for select to authenticated
  using (is_own_customer(customer_id));
grant select on public.consolidation_plans to authenticated;
grant all on public.consolidation_plans to service_role;

-- ============================================================ supplier circular profile (private to the supplier)
create table public.circular_profiles (
  company_id text not null references public.companies(id),
  year int not null,
  scrap_rate numeric,                     -- scrap ÷ material consumed, 0..1
  scrap_tonnes numeric,
  scrap_route text not null default 'unknown'
    check (scrap_route in ('recycler', 'mill-return', 'internal-remelt', 'landfill', 'unknown')),
  recycled_content_pct numeric,           -- 0..1
  returnable_packaging_pct numeric,       -- share of shipments in returnable containers, 0..1
  renewable_electricity_pct numeric,      -- 0..1
  iso14001 boolean not null default false,
  notes text,
  provenance text not null default 'estimated' check (provenance in ('measured', 'estimated')),  -- self-reported = estimated
  updated_at timestamptz not null default now(),
  primary key (company_id, year)
);
alter table public.circular_profiles enable row level security;
create policy "own circular read" on public.circular_profiles for select to authenticated using (is_own_company(company_id));
create policy "own circular insert" on public.circular_profiles for insert to authenticated with check (is_own_company(company_id));
create policy "own circular update" on public.circular_profiles for update to authenticated
  using (is_own_company(company_id)) with check (is_own_company(company_id));
grant select, insert, update on public.circular_profiles to authenticated;
grant all on public.circular_profiles to service_role;

-- ============================================================ consent sharing (requests + shares)
-- A key customer asks; the supplier OWNER (not ops) shares a frozen summary with that one customer; it can be revoked.
alter table public.shares add column circular jsonb;
grant select on public.requests, public.shares to authenticated;
grant all on public.requests, public.shares to service_role;

-- Key customer: ask a supplier for its circular summary. Returns the request id.
create or replace function public.request_circular(supplier text, note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare rid text; cid text := my_company();
begin
  if my_role() <> 'customer' then raise exception 'Only a key customer can ask for this'; end if;
  if not exists (select 1 from relationships where supplier_id = supplier and customer_id = cid) then
    raise exception 'Supplier % is not one of your suppliers', supplier; end if;
  select id into rid from requests
   where from_company_id = cid and to_company_id = supplier and 'circular' = any(items) and status = 'open';
  if rid is not null then return rid; end if;   -- one open request per pair
  rid := 'req-circ-' || cid || '-' || supplier || '-' || to_char(now(), 'YYYYMMDDHH24MISS');
  insert into requests (id, from_company_id, to_company_id, items, fiscal_year, sent_at, due_date, status, note)
  values (rid, cid, supplier, array['circular'], extract(year from now())::int, current_date, current_date + 30, 'open', note);
  return rid;
end $$;

-- Supplier owner: share a frozen circular summary with one of its customers (replaces earlier versions).
create or replace function public.share_circular(customer text, summary jsonb, request text default null)
returns text language plpgsql security definer set search_path = public as $$
declare sid text; sup text := my_company(); v int;
begin
  if my_role() <> 'owner' then raise exception 'Only the supplier owner can share data'; end if;
  if not exists (select 1 from relationships where supplier_id = sup and customer_id = customer) then
    raise exception 'Company % is not one of your customers', customer; end if;
  if summary ?| array['costs', 'prices', 'margins', 'unitCostMxn'] then raise exception 'Costs, prices and margins are never shared'; end if;
  select coalesce(max(version), 0) + 1 into v from shares where supplier_id = sup and customer_id = customer and 'circular' = any(items);
  update shares set revoked = true where supplier_id = sup and customer_id = customer and 'circular' = any(items) and not revoked;
  sid := 'share-circ-' || sup || '-' || customer || '-v' || v;
  insert into shares (id, supplier_id, customer_id, request_id, items, approved_by, approved_at, version, revoked, circular)
  values (sid, sup, customer, request, array['circular'], coalesce((select contact->>'name' from companies where id = sup), 'Owner'),
          current_date, v, false, summary);
  update requests set status = 'answered' where id = request and to_company_id = sup;
  return sid;
end $$;

-- Supplier owner: withdraw a share.
create or replace function public.revoke_share(share_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'owner' then raise exception 'Only the supplier owner can revoke a share'; end if;
  update shares set revoked = true where id = share_id and supplier_id = my_company();
  if not found then raise exception 'Share not found or not yours'; end if;
end $$;

revoke execute on function public.request_circular(text, text), public.share_circular(text, jsonb, text), public.revoke_share(text) from public, anon;
grant execute on function public.request_circular(text, text), public.share_circular(text, jsonb, text), public.revoke_share(text) to authenticated;

-- ============================================================ reset_demo: also restore the circular demo
create or replace function public.reset_demo()
returns void language plpgsql security definer set search_path = public as $$
declare snap jsonb; new_ids text[]; fk record;
begin
  if not (select testing_mode from app_settings where id = 1) then raise exception 'Testing mode is off'; end if;
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
end $$;
