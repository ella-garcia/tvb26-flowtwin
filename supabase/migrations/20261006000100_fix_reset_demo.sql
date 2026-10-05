-- reset_demo() re-inserted alerts with every column from the snapshot. The snapshot predates
-- alerts.updated_at / resolved_by, so updated_at came through as null and broke its not-null rule.
-- List the snapshot's columns explicitly and let the new columns take their defaults.
create or replace function public.reset_demo()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (select testing_mode from app_settings where id = 1) then raise exception 'Testing mode is off'; end if;
  delete from alerts;
  insert into alerts (id, customer_id, supplier_id, part_ids, signal_id, level, title, message, created_at,
                      expected_shortfall_date, line_stop_exposure_eur, status, actions, chosen_action_id, supplier_response)
  select id, customer_id, supplier_id, part_ids, signal_id, level, title, message, created_at,
         expected_shortfall_date, line_stop_exposure_eur, status, actions, chosen_action_id, supplier_response
  from jsonb_populate_recordset(null::alerts, (select rows from demo_snapshot where name = 'alerts'));
  delete from invites;
  insert into invites select * from jsonb_populate_recordset(null::invites, (select rows from demo_snapshot where name = 'invites'));
end $$;
