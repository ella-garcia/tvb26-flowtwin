-- WP1 (Oct 2026 review): close the cross-tenant job hole and make reset_demo() restore the whole demo.

-- ============================================================ jobs: a queued job always names the caller's own company
-- The old policy let any signed-in user queue a job with company_id null, and the worker read payload.company_id
-- first, so a user could make the service-role worker read or write another customer's data.
-- parse-upload: company required (owner/ops of the company or its key customer), payload may not name another one.
-- recompute-risk: own key customer; null (recompute every customer) only for admins. The app queues parse-upload only.
drop policy "queue jobs" on public.jobs;
create policy "queue jobs" on public.jobs for insert to authenticated
  with check (created_by = auth.uid() and (
    (kind = 'parse-upload' and company_id is not null
     and (is_own_company(company_id) or is_own_customer(company_id))
     and coalesce(payload->>'company_id', company_id) = company_id)
    or (kind = 'recompute-risk'
        and ((company_id is not null and is_own_customer(company_id)) or (company_id is null and my_role() = 'admin')))));

-- ============================================================ reset_demo(): restore every table the demo and the intake change
-- Snapshots (demo_snapshot, written by seed.sql): companies, relationships, vehicle_programs, parts, risks,
-- supplier_profiles, alerts, invites. A table whose snapshot is missing (databases seeded before this change) is skipped.
-- Columns come from the snapshot's keys that exist in the table, so new columns take their defaults.
-- Alerts are upserted, not deleted and re-inserted: alert_notifications cascades on alert delete, and those rows are what
-- stops the same (alert, reason, recipient) e-mail being sent twice. Only alerts that are not in the snapshot are deleted.
create or replace function public._restore_snapshot(tbl text, conflict text[] default null) returns boolean
language plpgsql set search_path = public as $$
declare snap jsonb; cols text[]; list text; upd text;
begin
  select rows into snap from demo_snapshot where name = tbl;
  if snap is null then return false; end if;
  select array_agg(c.column_name::text order by c.ordinal_position) into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = tbl and c.is_generated = 'NEVER' and c.is_identity = 'NO'
    and c.column_name in (select jsonb_object_keys(e) from jsonb_array_elements(snap) e);
  if cols is null then return false; end if;
  select string_agg(quote_ident(k), ', ') into list from unnest(cols) k;
  if conflict is null then
    execute format('delete from public.%I', tbl);
    execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)', tbl, list, list, tbl)
      using snap;
  else
    select string_agg(format('%I = excluded.%I', k, k), ', ') into upd from unnest(cols) k where k <> all (conflict);
    execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%s) do update set %s',
                   tbl, list, list, tbl, (select string_agg(quote_ident(k), ', ') from unnest(conflict) k), upd) using snap;
  end if;
  return true;
end $$;

create or replace function public.reset_demo()
returns void language plpgsql security definer set search_path = public as $$
declare snap jsonb; new_ids text[]; fk record;
begin
  if not (select testing_mode from app_settings where id = 1) then raise exception 'Testing mode is off'; end if;
  -- Intake data: none in the seed.
  delete from receipts;
  delete from demand_releases;
  -- Companies created by uploads (not in the snapshot): remove every row that points at them, then the companies.
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
    perform _restore_snapshot('companies', array['id']);   -- e.g. contact e-mails changed by a suppliers upload
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
  select rows into snap from demo_snapshot where name = 'alerts';
  if snap is not null then
    delete from alerts where id not in (select e->>'id' from jsonb_array_elements(snap) e);
    perform _restore_snapshot('alerts', array['id']);
    update alerts set resolved_by = null, updated_at = now() where id in (select e->>'id' from jsonb_array_elements(snap) e);
  end if;
end $$;

revoke execute on function public._restore_snapshot(text, text[]) from public, anon, authenticated;
