-- Data page: a key customer or supplier asks for a system to be connected (ERP, logistics platform, file drop).
-- The request is a `connections` row with status 'pending'; the FlowTwin team (admin role) sees it and sets it up.
alter table public.connections drop constraint connections_kind_check;
alter table public.connections add constraint connections_kind_check check (kind in ('edi', 'erp', 'cfdi', 'logistics', 'files'));

create policy "admin reads connections" on public.connections for select to authenticated using (my_role() = 'admin');

create or replace function public.request_connection(p_provider text)
returns public.connections language plpgsql security definer set search_path = public as $$
declare c public.connections; k text;
begin
  if my_company() is null or my_role() not in ('customer', 'owner', 'ops') then raise exception 'Sign in as a company first'; end if;
  k := case p_provider when 'sap' then 'erp' when 'netsuite' then 'erp' when 'logistaas' then 'logistics' when 'file-drop' then 'files' end;
  if k is null then raise exception 'Unknown system %', p_provider; end if;
  insert into connections (id, company_id, kind, provider, status, config)
  values (my_company() || '-' || p_provider, my_company(), k, p_provider, 'pending',
          jsonb_build_object('requestedAt', now(), 'requestedByRole', my_role()))
  on conflict (id) do nothing;            -- asking twice keeps the first request; an active connection stays active
  -- A customer's open "connect your systems" request to this company is answered once it asks for any system.
  update requests set status = 'answered' where to_company_id = my_company() and 'connect-systems' = any(items) and status = 'open';
  select * into c from connections where id = my_company() || '-' || p_provider;
  return c;
end $$;
revoke execute on function public.request_connection(text) from public, anon;
grant execute on function public.request_connection(text) to authenticated;

-- ============================================================ key customer asks a supplier to connect its systems
-- One open request per pair, in `requests` (items = {connect-systems}); the supplier sees it on its Data page.
create or replace function public.request_supplier_connection(supplier text, note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare rid text; cid text := my_company();
begin
  if my_role() <> 'customer' then raise exception 'Only a key customer can ask for this'; end if;
  if not exists (select 1 from relationships where supplier_id = supplier and customer_id = cid) then
    raise exception 'Supplier % is not one of your suppliers', supplier; end if;
  select id into rid from requests
   where from_company_id = cid and to_company_id = supplier and 'connect-systems' = any(items) and status = 'open';
  if rid is not null then return rid; end if;
  rid := 'req-conn-' || cid || '-' || supplier || '-' || to_char(now(), 'YYYYMMDDHH24MISS');
  insert into requests (id, from_company_id, to_company_id, items, fiscal_year, sent_at, due_date, status, note)
  values (rid, cid, supplier, array['connect-systems'], extract(year from now())::int, current_date, current_date + 30, 'open', note);
  return rid;
end $$;
revoke execute on function public.request_supplier_connection(text, text) from public, anon;
grant execute on function public.request_supplier_connection(text, text) to authenticated;

-- Which systems each supplier has connected, for its key customers: provider and status only (no config, no secrets).
create view public.pair_connections with (security_barrier = true) as
  select c.id, c.company_id, c.provider, c.status, c.last_run_at
  from public.connections c
  where is_own_party(c.company_id) or my_role() = 'admin'
     or exists (select 1 from public.relationships r
                where r.supplier_id = c.company_id and my_role() = 'customer' and r.customer_id = my_company());
grant select on public.pair_connections to authenticated, service_role;
