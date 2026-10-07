-- RLS / RPC tests. Runs inside one transaction that is rolled back; prints PASS/FAIL per assertion.
-- Requires the seeded local database (supabase db reset).
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
begin;

create table public.t_results (n serial, name text, ok boolean);
grant all on public.t_results to public;
grant usage on sequence public.t_results_n_seq to public;

create function public.t_assert(name text, ok boolean) returns void language plpgsql as $$
begin insert into public.t_results (name, ok) values (name, coalesce(ok, false)); end $$;

-- Expect the statement to raise an error (or, with want_error=false, to succeed).
create function public.t_throws(name text, stmt text) returns void language plpgsql as $$
declare failed boolean := false;
begin
  begin execute stmt; exception when others then failed := true; end;
  insert into public.t_results (name, ok) values (name, failed);
end $$;
create function public.t_works(name text, stmt text) returns void language plpgsql as $$
declare failed boolean := false; msg text;
begin
  begin execute stmt; exception when others then failed := true; msg := sqlerrm; end;
  insert into public.t_results (name, ok) values (name || case when failed then ' (' || msg || ')' else '' end, not failed);
end $$;
grant execute on function public.t_assert(text, boolean), public.t_throws(text, text), public.t_works(text, text) to public;

-- Test users (the signup trigger gives each a customer/qss profile).
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'), ('00000000-0000-0000-0000-0000000000a3');

-- ---- customer qss
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select public.t_assert('customer: profile defaults to customer/qss', (select role = 'customer' and company_id = 'qss' from profiles));
select public.t_assert('customer qss: risks only where customer_id=qss',
  (select count(*) > 0 and bool_and(customer_id = 'qss') from risks));
select public.t_assert('customer qss: alerts only where customer_id=qss',
  (select count(*) = 6 and bool_and(customer_id = 'qss') from alerts));
select public.t_assert('customer qss: parts only where customer_id=qss',
  (select count(*) > 0 and bool_and(customer_id = 'qss') from parts));
select public.t_assert('customer qss: sees 0 lanes', (select count(*) = 0 from lanes));
select public.t_assert('customer qss: sees 0 sites', (select count(*) = 0 from sites));
select public.t_assert('customer qss: sees 0 machines', (select count(*) = 0 from machines));
select public.t_assert('customer qss: sees 0 uploads', (select count(*) = 0 from uploads));
select public.t_assert('customer qss: sees companies and signals', (select count(*) > 0 from companies) and (select count(*) > 0 from signals));
select public.t_assert('customer qss: sees only its own vehicle programmes', (select count(*) = 3 and bool_and(customer_id = 'qss') from vehicle_programs));
select public.t_throws('customer qss: cannot respond_alert', $$select respond_alert('alert-hmo-qss', '{"x":1}'::jsonb)$$);
select public.t_works('customer qss: can acknowledge own alert', $$select acknowledge_alert('alert-hmo-qss', 'act-hmo-1')$$);
select public.t_assert('customer qss: alert is now acknowledged', (select status = 'acknowledged' and chosen_action_id = 'act-hmo-1' from alerts where id = 'alert-hmo-qss'));
select public.t_throws('customer qss: cannot insert invite for another customer',
  $$insert into invites (id, customer_id, supplier_name, contact_email, sent_at, status, plan) values ('t-inv', 'slp-interiors', 'X', 'x@x.example', current_date, 'sent', 'sponsored')$$);
select public.t_works('customer qss: can insert own invite',
  $$insert into invites (id, customer_id, supplier_name, contact_email, sent_at, status, plan) values ('t-inv-ok', 'qss', 'X', 'x@x.example', current_date, 'sent', 'sponsored')$$);
select public.t_assert('customer qss: sees only own invites', (select count(*) = 3 and bool_and(customer_id = 'qss') from invites));
select public.t_throws('customer qss: cannot update alerts directly',
  $q$do $d$ declare n int; begin update alerts set status = 'resolved' where id = 'alert-tsr-qss'; get diagnostics n = row_count; if n = 0 then raise exception 'no rows'; end if; end $d$$q$);

-- ---- owner edl
select public.t_works('switch to owner/edl', $$select switch_test_identity('owner', 'edl')$$);
select public.t_assert('owner edl: profile updated', (select role = 'owner' and company_id = 'edl' from profiles));
select public.t_assert('owner edl: sees its lanes', (select count(*) > 0 and bool_and(company_id = 'edl') from lanes));
select public.t_assert('owner edl: sees its machines', (select count(*) > 0 and bool_and(company_id = 'edl') from machines));
select public.t_assert('owner edl: sees its uploads', (select count(*) > 0 and bool_and(company_id = 'edl') from uploads));
select public.t_assert('owner edl: 0 lanes of other companies', (select count(*) = 0 from lanes where company_id <> 'edl'));
select public.t_assert('owner edl: risks only where supplier_id=edl', (select count(*) > 0 and bool_and(supplier_id = 'edl') from risks));
select public.t_assert('owner edl: alerts only where supplier_id=edl', (select count(*) > 0 and bool_and(supplier_id = 'edl') from alerts));
select public.t_assert('owner edl: parts only where supplier_id=edl', (select count(*) > 0 and bool_and(supplier_id = 'edl') from parts));
select public.t_assert('owner edl: programmes only of qss (its parts go there), none of slp-interiors', (select count(*) > 0 and bool_and(customer_id = 'qss') from vehicle_programs));
select public.t_assert('owner edl: sees 0 invites', (select count(*) = 0 from invites));
select public.t_works('owner edl: can respond_alert on its own alert', $$select respond_alert('alert-edl-qss', '{"note":"ok"}'::jsonb)$$);
select public.t_throws('owner edl: cannot respond_alert on another supplier alert', $$select respond_alert('alert-hmo-qss', '{"note":"ok"}'::jsonb)$$);
select public.t_throws('owner edl: cannot acknowledge_alert', $$select acknowledge_alert('alert-edl-qss')$$);
select public.t_works('owner edl: can insert own machine',
  $$insert into machines (id, company_id, name, capacity_tonnes, shifts_per_week, utilization) values ('t-m', 'edl', 'T', 1, 1, 0.5)$$);
select public.t_throws('owner edl: cannot insert machine for another company',
  $$insert into machines (id, company_id, name, capacity_tonnes, shifts_per_week, utilization) values ('t-m2', 'hmo', 'T', 1, 1, 0.5)$$);

-- ---- admin
select public.t_works('switch to admin', $$select switch_test_identity('admin', 'qss')$$);
select public.t_assert('admin: sees companies', (select count(*) = 15 from companies));
select public.t_assert('admin: sees signals', (select count(*) > 0 from signals));
select public.t_assert('admin: 0 lanes', (select count(*) = 0 from lanes));
select public.t_assert('admin: 0 risks', (select count(*) = 0 from risks));
select public.t_assert('admin: 0 parts', (select count(*) = 0 from parts));
select public.t_assert('admin: 0 alerts', (select count(*) = 0 from alerts));

-- ---- switch_test_identity validation
select public.t_throws('switch: supplier id rejected for role customer', $$select switch_test_identity('customer', 'edl')$$);
select public.t_throws('switch: customer id rejected for role owner', $$select switch_test_identity('owner', 'qss')$$);
select public.t_throws('switch: unknown role rejected', $$select switch_test_identity('god', 'qss')$$);
select public.t_works('switch: customer slp-interiors accepted', $$select switch_test_identity('customer', 'slp-interiors')$$);
select public.t_assert('slp-interiors customer sees none of qss alerts', (select count(*) = 0 from alerts));

-- ---- reset_demo
-- Databases seeded before the full snapshot have only alerts/invites: snapshot the current rows for the rest (seeded DBs keep theirs).
reset role;
insert into demo_snapshot (name, rows)
select 'companies', (select jsonb_agg(to_jsonb(x)) from companies x)
union all select 'relationships', (select jsonb_agg(to_jsonb(x)) from relationships x)
union all select 'vehicle_programs', (select jsonb_agg(to_jsonb(x)) from vehicle_programs x)
union all select 'parts', (select jsonb_agg(to_jsonb(x)) from parts x)
union all select 'risks', (select jsonb_agg(to_jsonb(x)) from risks x)
union all select 'supplier_profiles', (select jsonb_agg(to_jsonb(x)) from supplier_profiles x)
on conflict (name) do nothing;
-- What an upload leaves behind: a new supplier with relationship, part, profile, receipt, release; changed stock and contact.
insert into companies (id, name, city, state, lat, lon, kind, size_band, employees, scian) values
  ('t-upload-co', 'T', 'Saltillo', 'Coahuila', 25.4, -101, 'supplier', 'small', 0, '336300');
insert into relationships (supplier_id, customer_id, chain_position, requirements) values ('t-upload-co', 'qss', 'sub', '{}');
insert into parts (id, number, name, supplier_id, customer_id, unit_cost_mxn, daily_usage, on_hand, days_of_cover, criticality)
  values ('t-part', 'T-1', 'T', 't-upload-co', 'qss', 1, 1, 0, 0, 'normal');
insert into supplier_profiles (customer_id, supplier_id) values ('qss', 't-upload-co');
insert into receipts (customer_id, supplier_id, part_id, po_number, promised_date, quantity_ordered)
  values ('qss', 't-upload-co', 't-part', 'T-R', '2026-09-01', 1);
insert into demand_releases (customer_id, part_id, week_start, quantity) values ('qss', 'part-qss-4471-brk', '2026-10-12', 1);
update parts set on_hand = on_hand + 999 where id = 'part-qss-4471-brk';
update companies set contact = '{"email":"t@t.example"}' where id = 'edl';
delete from vehicle_programs where customer_id = 'qss';
insert into alert_notifications (alert_id, channel, recipient, audience, status, reason)
  values ('alert-hmo-qss', 'email', 't@t.example', 'customer', 'dry-run', 'new-alert');
set local role authenticated;
select public.t_works('reset_demo runs', $$select reset_demo()$$);
reset role;
select public.t_assert('reset_demo removes the upload-created company and its rows',
  not exists (select 1 from companies where id = 't-upload-co') and not exists (select 1 from relationships where supplier_id = 't-upload-co')
  and not exists (select 1 from parts where id = 't-part') and not exists (select 1 from supplier_profiles where supplier_id = 't-upload-co'));
select public.t_assert('reset_demo clears receipts and demand_releases',
  (select count(*) = 0 from receipts) and (select count(*) = 0 from demand_releases));
select public.t_assert('reset_demo restores parts, risks, programmes, profiles, relationships, companies from the snapshot',
  (select bool_and((select count(*) from parts) = jsonb_array_length(rows)) from demo_snapshot where name = 'parts')
  and (select bool_and((select count(*) from risks) = jsonb_array_length(rows)) from demo_snapshot where name = 'risks')
  and (select bool_and((select count(*) from vehicle_programs) = jsonb_array_length(rows)) from demo_snapshot where name = 'vehicle_programs')
  and (select bool_and((select count(*) from supplier_profiles) = jsonb_array_length(rows)) from demo_snapshot where name = 'supplier_profiles')
  and (select bool_and((select count(*) from relationships) = jsonb_array_length(rows)) from demo_snapshot where name = 'relationships')
  and (select bool_and((select count(*) from companies) = jsonb_array_length(rows)) from demo_snapshot where name = 'companies'));
select public.t_assert('reset_demo restores stock and contact',
  (select p.on_hand = (e->>'on_hand')::numeric from parts p, demo_snapshot d, jsonb_array_elements(d.rows) e
   where d.name = 'parts' and e->>'id' = p.id and p.id = 'part-qss-4471-brk')
  and (select c.contact is not distinct from e->'contact' from companies c, demo_snapshot d, jsonb_array_elements(d.rows) e
       where d.name = 'companies' and e->>'id' = c.id and c.id = 'edl'));
select public.t_assert('reset_demo keeps alert_notifications of re-inserted alerts (no duplicate e-mails)',
  exists (select 1 from alert_notifications where alert_id = 'alert-hmo-qss' and recipient = 't@t.example'));
delete from demo_snapshot where name = 'vehicle_programs';
set local role authenticated;
select public.t_works('reset_demo skips a table whose snapshot is missing', $$select reset_demo()$$);
select switch_test_identity('customer', 'qss');
select public.t_assert('reset_demo restores alert-hmo-qss to new', (select status = 'new' and chosen_action_id is null from alerts where id = 'alert-hmo-qss'));
select public.t_assert('reset_demo restores edl response (status supplier-responded)', (select status = 'supplier-responded' from alerts where id = 'alert-edl-qss'));
select public.t_assert('reset_demo restores invites to 2', (select count(*) = 2 from invites));

-- ---- anon cannot call RPCs
reset role;
set local role anon;
select public.t_throws('anon: cannot call reset_demo', $$select reset_demo()$$);
reset role;

-- ---- Phase 2: supplier_profiles, receipts, demand_releases, uploads (key-customer intake)
reset role;
insert into public.receipts (customer_id, supplier_id, part_id, po_number, promised_date, received_date, quantity_ordered, quantity_received) values
  ('qss', 'edl', 'part-qss-4471-brk', 'T-PO1', '2026-09-01', '2026-09-01', 10, 10),
  ((select customer_id from parts where customer_id = 'slp-interiors' limit 1), (select supplier_id from parts where customer_id = 'slp-interiors' limit 1),
   (select id from parts where customer_id = 'slp-interiors' limit 1), 'T-PO2', '2026-09-01', '2026-09-02', 10, 10);
insert into public.demand_releases (customer_id, part_id, week_start, quantity) values
  ('qss', 'part-qss-4471-brk', '2026-10-05', 100), ('qss', 'part-qss-6120-lmb', '2026-10-05', 100),
  ((select customer_id from parts where customer_id = 'slp-interiors' limit 1), (select id from parts where customer_id = 'slp-interiors' limit 1), '2026-10-05', 50);
insert into public.uploads (company_id, kind, file_name, source, status) values ('slp-interiors', 'tier1-parts', 'slp.csv', 'CSV', 'uploaded');

set local role authenticated;
select public.t_works('p2: switch to customer qss', $$select switch_test_identity('customer', 'qss')$$);
select public.t_assert('p2 customer qss: supplier_profiles only own pairs', (select count(*) > 0 and bool_and(customer_id = 'qss') from supplier_profiles));
select public.t_assert('p2 customer qss: receipts only own (1 row)', (select count(*) = 1 and bool_and(customer_id = 'qss') from receipts));
select public.t_assert('p2 customer qss: demand_releases only own (2 rows)', (select count(*) = 2 and bool_and(customer_id = 'qss') from demand_releases));
select public.t_assert('p2 customer qss: does not see another customer upload', (select count(*) = 0 from uploads where company_id = 'slp-interiors'));
select public.t_works('p2 customer qss: can insert own upload',
  $$insert into uploads (company_id, kind, file_name, source, status, issues, mapping) values ('qss', 'tier1-stock', 's.csv', 'CSV', 'uploaded', '[{"row":2,"column":"x","message":"m","severity":"warning"}]', '{"a":"b"}')$$);
select public.t_assert('p2 customer qss: reads its own upload', (select count(*) = 1 and bool_and(company_id = 'qss') from uploads));
select public.t_works('p2 customer qss: can update its own upload', $$update uploads set status = 'needs-input' where company_id = 'qss' and kind = 'tier1-stock'$$);
select public.t_throws('p2 customer qss: cannot insert upload for another customer',
  $$insert into uploads (company_id, kind, file_name, source, status) values ('slp-interiors', 'tier1-stock', 's.csv', 'CSV', 'uploaded')$$);
select public.t_throws('p2 customer qss: cannot update another customer upload',
  $q$do $d$ declare n int; begin update uploads set status = 'waiting' where company_id = 'slp-interiors'; get diagnostics n = row_count; if n = 0 then raise exception 'no rows'; end if; end $d$$q$);
select public.t_throws('p2 customer qss: cannot insert receipts directly',
  $$insert into receipts (customer_id, supplier_id, po_number, promised_date, quantity_ordered) values ('qss', 'edl', 'X', '2026-09-01', 1)$$);
select public.t_throws('p2 customer qss: cannot insert demand_releases directly',
  $$insert into demand_releases (customer_id, part_id, week_start, quantity) values ('qss', 'part-qss-4471-brk', '2026-11-02', 1)$$);
select public.t_throws('p2 customer qss: cannot write supplier_profiles', $$update supplier_profiles set utilization = 0.1$$);
select public.t_works('p2 customer qss: can queue parse-upload job for itself',
  $$insert into jobs (kind, company_id, payload) values ('parse-upload', 'qss', '{}')$$);
select public.t_throws('p2 customer qss: cannot queue job for another customer',
  $$insert into jobs (kind, company_id, payload) values ('parse-upload', 'slp-interiors', '{}')$$);
select public.t_throws('p2 customer qss: cannot queue parse-upload without a company',
  $$insert into jobs (kind, company_id, payload) values ('parse-upload', null, '{"company_id":"slp-interiors"}')$$);
select public.t_throws('p2 customer qss: cannot queue parse-upload whose payload names another company',
  $$insert into jobs (kind, company_id, payload) values ('parse-upload', 'qss', '{"company_id":"slp-interiors"}')$$);
select public.t_works('p2 customer qss: can queue parse-upload whose payload names itself',
  $$insert into jobs (kind, company_id, payload) values ('parse-upload', 'qss', '{"company_id":"qss","storage_path":"qss/x/1-a.csv"}')$$);
select public.t_throws('p2 customer qss: cannot queue recompute-risk for every customer (null company)',
  $$insert into jobs (kind, company_id, payload) values ('recompute-risk', null, '{}')$$);
select public.t_throws('p2 customer qss: cannot queue recompute-risk for another customer',
  $$insert into jobs (kind, company_id, payload) values ('recompute-risk', 'slp-interiors', '{}')$$);
select public.t_works('p2 customer qss: can queue recompute-risk for itself',
  $$insert into jobs (kind, company_id, payload) values ('recompute-risk', 'qss', '{}')$$);

select public.t_works('p2: switch to owner edl', $$select switch_test_identity('owner', 'edl')$$);
select public.t_assert('p2 owner edl: supplier_profiles only supplier edl', (select count(*) > 0 and bool_and(supplier_id = 'edl') from supplier_profiles));
select public.t_assert('p2 owner edl: receipts only its own supplier rows', (select count(*) = 1 and bool_and(supplier_id = 'edl') from receipts));
select public.t_assert('p2 owner edl: demand_releases only for its parts',
  (select count(*) = 1 and bool_and(part_id = 'part-qss-4471-brk') from demand_releases));
select public.t_assert('p2 owner edl: sees no customer intake uploads', (select count(*) = 0 from uploads where company_id in ('qss', 'slp-interiors')));
select public.t_throws('p2 owner edl: cannot insert upload for a customer',
  $$insert into uploads (company_id, kind, file_name, source, status) values ('qss', 'tier1-parts', 's.csv', 'CSV', 'uploaded')$$);

select public.t_works('p2: switch to owner hmo', $$select switch_test_identity('owner', 'hmo')$$);
select public.t_assert('p2 owner hmo: no receipts (none for hmo)', (select count(*) = 0 from receipts));
select public.t_assert('p2 owner hmo: only its own part release',
  (select count(*) = 1 and bool_and(part_id = 'part-qss-6120-lmb') from demand_releases));

select public.t_works('p2: switch to customer slp-interiors', $$select switch_test_identity('customer', 'slp-interiors')$$);
select public.t_assert('p2 customer slp: sees only own profiles', (select count(*) > 0 and bool_and(customer_id = 'slp-interiors') from supplier_profiles));
select public.t_assert('p2 customer slp: sees only own receipts and releases',
  (select count(*) = 1 from receipts) and (select count(*) = 1 and bool_and(customer_id = 'slp-interiors') from demand_releases));
select public.t_assert('p2 customer slp: sees only its upload', (select count(*) = 1 and bool_and(company_id = 'slp-interiors') from uploads));

select public.t_works('p2: switch to admin', $$select switch_test_identity('admin', 'qss')$$);
select public.t_works('p2 admin: can queue recompute-risk for every customer',
  $$insert into jobs (kind, company_id, payload) values ('recompute-risk', null, '{}')$$);
select public.t_assert('p2 admin: 0 profiles, receipts, releases',
  (select count(*) = 0 from supplier_profiles) and (select count(*) = 0 from receipts) and (select count(*) = 0 from demand_releases));
reset role;

-- ---- Circular layer: circular_profiles, consent sharing (request_circular / share_circular / revoke_share), consolidation_plans
reset role;
insert into consolidation_plans (customer_id, loops, totals) values ('qss', '[]', '{}'), ('slp-interiors', '[]', '{}')
  on conflict (customer_id) do update set loops = excluded.loops;
delete from circular_profiles where year = 2090;

set local role authenticated;
select public.switch_test_identity('customer', 'qss');
select public.t_assert('circ customer qss: sees 0 circular_profiles', (select count(*) = 0 from circular_profiles));
select public.t_throws('circ customer qss: cannot insert a circular_profile',
  $$insert into circular_profiles (company_id, year, scrap_route) values ('qss', 2090, 'unknown')$$);
select public.t_works('circ customer qss: can ask edl for circular data', $$select request_circular('edl')$$);
select public.t_assert('circ customer qss: sees its open circular request to edl',
  (select count(*) = 1 from requests where from_company_id = 'qss' and to_company_id = 'edl' and 'circular' = any(items) and status = 'open'));
select public.t_assert('circ customer qss: asking twice keeps one open request', (select request_circular('edl')) = (select request_circular('edl')));
select public.t_throws('circ customer qss: cannot ask a company that is not its supplier', $$select request_circular('slp-interiors')$$);
select public.t_throws('circ customer qss: cannot share_circular',
  $$select share_circular('qss', '{"year":2090,"scrapRoute":"recycler","iso14001":true,"provenance":"estimated"}'::jsonb)$$);
select public.t_assert('circ customer qss: sees only its own consolidation plan',
  (select count(*) = 1 and bool_and(customer_id = 'qss') from consolidation_plans));

select public.switch_test_identity('owner', 'edl');
select public.t_works('circ owner edl: can insert own circular_profile',
  $$insert into circular_profiles (company_id, year, scrap_rate, scrap_route, iso14001) values ('edl', 2090, 0.05, 'recycler', true)$$);
select public.t_works('circ owner edl: can upsert own circular_profile',
  $$insert into circular_profiles (company_id, year, scrap_rate, scrap_route, iso14001) values ('edl', 2090, 0.04, 'mill-return', true)
    on conflict (company_id, year) do update set scrap_rate = excluded.scrap_rate, scrap_route = excluded.scrap_route$$);
select public.t_assert('circ owner edl: upsert took effect',
  (select scrap_rate = 0.04 and scrap_route = 'mill-return' and provenance = 'estimated' from circular_profiles where company_id = 'edl' and year = 2090));
select public.t_throws('circ owner edl: cannot insert a circular_profile for another company',
  $$insert into circular_profiles (company_id, year, scrap_route) values ('hmo', 2090, 'unknown')$$);
select public.t_assert('circ owner edl: sees only its own circular_profiles', (select count(*) > 0 and bool_and(company_id = 'edl') from circular_profiles));
select public.t_assert('circ owner edl: cannot read consolidation_plans', (select count(*) = 0 from consolidation_plans));
select public.t_assert('circ owner edl: sees the qss request',
  (select count(*) >= 1 from requests where from_company_id = 'qss' and to_company_id = 'edl' and 'circular' = any(items)));
select public.t_throws('circ owner edl: summary with unitCostMxn is rejected',
  $$select share_circular('qss', '{"year":2090,"scrapRoute":"recycler","iso14001":true,"unitCostMxn":12}'::jsonb)$$);
select public.t_throws('circ owner edl: summary with margins is rejected',
  $$select share_circular('qss', '{"year":2090,"margins":0.2}'::jsonb)$$);
select public.t_throws('circ owner edl: cannot share with a company that is not its customer',
  $$select share_circular('slp-interiors', '{"year":2090,"scrapRoute":"recycler","iso14001":true,"provenance":"estimated"}'::jsonb)$$);
select public.t_assert('circ owner edl: share_circular to qss returns an id',
  (select share_circular('qss', '{"year":2090,"scrapRate":0.04,"scrapRoute":"mill-return","iso14001":true,"provenance":"estimated"}'::jsonb) like 'share-circ-edl-qss-v%'));
select public.t_assert('circ owner edl: exactly one active circular share to qss after re-sharing',
  (select count(*) = 1 from shares where supplier_id = 'edl' and customer_id = 'qss' and 'circular' = any(items)));

select public.switch_test_identity('customer', 'qss');
select public.t_assert('circ customer qss: sees the active edl share with the summary',
  (select count(*) = 1 and bool_and(circular->>'scrapRoute' = 'mill-return' and not (circular ? 'notes')) from shares where supplier_id = 'edl' and customer_id = 'qss' and 'circular' = any(items)));
select public.t_assert('circ customer qss: shares only for itself', (select bool_and(customer_id = 'qss') from shares));

select public.switch_test_identity('customer', 'slp-interiors');
select public.t_assert('circ customer slp: cannot see qss shares', (select count(*) = 0 from shares where customer_id = 'qss'));
select public.t_assert('circ customer slp: sees only its own consolidation plan',
  (select count(*) = 1 and bool_and(customer_id = 'slp-interiors') from consolidation_plans));
select public.t_assert('circ customer slp: cannot see qss requests', (select count(*) = 0 from requests where from_company_id = 'qss'));

select public.switch_test_identity('ops', 'edl');
select public.t_assert('circ ops edl: sees its shares read-only',
  (select count(*) = 1 from shares where supplier_id = 'edl' and customer_id = 'qss' and 'circular' = any(items)));
select public.t_works('circ ops edl: can upsert own circular_profile',
  $$insert into circular_profiles (company_id, year, scrap_route) values ('edl', 2090, 'recycler') on conflict (company_id, year) do update set scrap_route = excluded.scrap_route$$);
select public.t_throws('circ ops edl: share_circular is rejected',
  $$select share_circular('qss', '{"year":2090,"scrapRoute":"recycler","iso14001":true,"provenance":"estimated"}'::jsonb)$$);
select public.t_throws('circ ops edl: revoke_share is rejected',
  $$select revoke_share((select id from shares where supplier_id = 'edl' and customer_id = 'qss' and not revoked and 'circular' = any(items) limit 1))$$);

select public.switch_test_identity('owner', 'edl');
select public.t_works('circ owner edl: revoke_share works',
  $$select revoke_share((select id from shares where supplier_id = 'edl' and customer_id = 'qss' and not revoked and 'circular' = any(items) limit 1))$$);
select public.t_throws('circ owner edl: cannot revoke a share that is not its own',
  $$select revoke_share('share-does-not-exist')$$);
select public.switch_test_identity('customer', 'qss');
select public.t_assert('circ customer qss: sees 0 edl shares after revoke',
  (select count(*) = 0 from shares where supplier_id = 'edl' and customer_id = 'qss' and 'circular' = any(items)));

-- reset_demo restores the circular tables from the snapshot
reset role;
delete from circular_profiles;
delete from shares;
delete from requests;
delete from consolidation_plans;
set local role authenticated;
select public.t_works('circ reset_demo runs', $$select reset_demo()$$);
reset role;
select public.t_assert('circ reset_demo restores circular_profiles from the snapshot',
  (select count(*) from circular_profiles) = coalesce((select jsonb_array_length(rows) from demo_snapshot where name = 'circular_profiles'), 0));
select public.t_assert('circ reset_demo restores shares from the snapshot',
  (select count(*) from shares) = coalesce((select jsonb_array_length(rows) from demo_snapshot where name = 'shares'), 0));
select public.t_assert('circ reset_demo restores requests from the snapshot',
  (select count(*) from requests) = coalesce((select jsonb_array_length(rows) from demo_snapshot where name = 'requests'), 0));
select public.t_assert('circ reset_demo restores consolidation_plans from the snapshot',
  (select count(*) from consolidation_plans) = coalesce((select jsonb_array_length(rows) from demo_snapshot where name = 'consolidation_plans'), 0));

-- ---- Phase 2 foundation: contacts, capacity events, shipment notices, track record, connections (WP0)
reset role;
update contacts set phone_e164 = '+524611234567', whatsapp_opt_in_at = now(), whatsapp_opt_in_text = 'Acepto avisos' where id = 'edl-primary';
insert into shipment_notices (customer_id, supplier_id, part_id, quantity, ship_date, expected_arrival, source, source_ref) values
  ('qss', 'edl', 'part-qss-4471-brk', 100, '2026-10-06', '2026-10-07', 'edi', 'T-ISA-1'),
  ((select customer_id from parts where customer_id = 'slp-interiors' limit 1), (select supplier_id from parts where customer_id = 'slp-interiors' limit 1),
   (select id from parts where customer_id = 'slp-interiors' limit 1), 50, '2026-10-06', '2026-10-08', 'edi', 'T-ISA-2');
insert into risk_history (customer_id, supplier_id, as_of, level, score)
  select customer_id, supplier_id, '2026-10-05', level, score from risks;
insert into alert_outcomes (alert_id, outcome) select id, 'pending' from alerts;
insert into connections (id, company_id, kind, provider) values ('t-conn-qss', 'qss', 'edi', 'edi-inbox'), ('t-conn-edl', 'edl', 'cfdi', 'syntage'),
  ('t-conn-slp', 'slp-interiors', 'erp', 'sap-s4');
insert into integration_runs (connection_id, rows) values ('t-conn-qss', 3), ('t-conn-edl', 2), ('t-conn-slp', 1);
select public.t_works('wp0: signal kinds policy and supplier-input are allowed',
  $$insert into signals (id, kind, title, description, state, lat, lon, radius_km, highways, starts_at, ends_at, severity, transit_multiplier, source, provenance, supply_cut_pct, affects)
    values ('t-sig-policy', 'policy', 'T', 'T', 'Querétaro', 20.5, -100.4, 1, '{}', '2026-10-05', '2026-10-30', 'medium', 1, 'test', 'estimated', null, '{"originCountries":["CN"]}'),
           ('t-sig-input', 'supplier-input', 'T', 'T', 'Guanajuato', 20.5, -100.8, 1, '{}', '2026-10-05', '2026-10-12', 'high', 1, 'test', 'estimated', 0.4, '{"supplierIds":["edl"]}')$$);
select public.t_throws('wp0: shipment notice with negative quantity is rejected',
  $$insert into shipment_notices (customer_id, supplier_id, part_id, quantity, source, source_ref) values ('qss', 'edl', 'part-qss-4471-brk', -1, 'edi', 'T-NEG')$$);

set local role authenticated;
select public.switch_test_identity('customer', 'qss');
select public.t_assert('wp0 customer qss: reads only its own contacts', (select count(*) = 1 and bool_and(company_id = 'qss') from contacts));
select public.t_assert('wp0 customer qss: pair_contacts shows edl with WhatsApp, no phone column',
  (select has_whatsapp from pair_contacts where id = 'edl-primary')
  and not exists (select 1 from information_schema.columns where table_name = 'pair_contacts' and column_name = 'phone_e164'));
select public.t_assert('wp0 customer qss: pair_contacts only own suppliers and itself',
  (select bool_and(company_id = 'qss' or company_id in (select supplier_id from relationships where customer_id = 'qss')) from pair_contacts));
select public.t_assert('wp0 customer qss: cannot read the edl phone', (select count(*) = 0 from contacts where phone_e164 is not null));
select public.t_throws('wp0 customer qss: cannot add a contact to edl',
  $$insert into contacts (id, company_id, name) values ('t-c-x', 'edl', 'X')$$);
select public.t_works('wp0 customer qss: can add its own contact', $$insert into contacts (id, company_id, name, locale) values ('t-c-qss', 'qss', 'Planner', 'en')$$);
select public.t_assert('wp0 customer qss: sees 0 capacity_events', (select count(*) = 0 from capacity_events));
select public.t_assert('wp0 customer qss: shipment_notices only own pairs (1)', (select count(*) = 1 and bool_and(customer_id = 'qss') from shipment_notices));
select public.t_throws('wp0 customer qss: cannot insert shipment_notices',
  $$insert into shipment_notices (customer_id, supplier_id, part_id, quantity, source, source_ref) values ('qss', 'edl', 'part-qss-4471-brk', 1, 'reply', 'T-X')$$);
select public.t_assert('wp0 customer qss: risk_history only own pairs', (select count(*) > 0 and bool_and(customer_id = 'qss') from risk_history));
select public.t_assert('wp0 customer qss: alert_outcomes only own alerts', (select count(*) = 6 from alert_outcomes));
select public.t_assert('wp0 customer qss: connections only own (1) and its runs (1)',
  (select count(*) = 1 and bool_and(company_id = 'qss') from connections) and (select count(*) = 1 from integration_runs));
select public.t_throws('wp0 customer qss: cannot insert connections',
  $$insert into connections (id, company_id, kind, provider) values ('t-conn-x', 'qss', 'erp', 'sap-s4')$$);
select public.t_throws('wp0 customer qss: cannot queue sync-connection jobs',
  $$insert into jobs (kind, company_id, payload) values ('sync-connection', 'qss', '{}')$$);
select public.t_works('wp0 customer qss: uploads accept status processing',
  $$insert into uploads (company_id, kind, file_name, source, status) values ('qss', 'wp0-test-kind', 's.csv', 'CSV', 'processing')$$);

select public.switch_test_identity('owner', 'edl');
select public.t_assert('wp0 owner edl: reads its contact with the phone', (select phone_e164 = '+524611234567' from contacts where id = 'edl-primary'));
select public.t_assert('wp0 owner edl: reads no other company contacts', (select bool_and(company_id = 'edl') from contacts));
select public.t_works('wp0 owner edl: can record a WhatsApp opt-out',
  $q$do $d$ declare n int; begin update contacts set whatsapp_opt_out_at = now() where id = 'edl-primary'; get diagnostics n = row_count; if n = 0 then raise exception 'no rows'; end if; end $d$$q$);
select public.t_throws('wp0 owner edl: invalid phone is rejected',
  $$update contacts set phone_e164 = '4611234567' where id = 'edl-primary'$$);
select public.t_works('wp0 owner edl: can report a capacity event',
  $$insert into capacity_events (supplier_id, resource, starts_on, ends_on, capacity_change_pct, reason) values ('edl', 'Prensa 3', '2026-10-09', '2026-10-13', -0.3, 'Mantenimiento')$$);
select public.t_throws('wp0 owner edl: cannot report capacity for hmo',
  $$insert into capacity_events (supplier_id, starts_on, capacity_change_pct) values ('hmo', '2026-10-09', -0.3)$$);
select public.t_assert('wp0 owner edl: shipment_notices only its own', (select count(*) = 1 and bool_and(supplier_id = 'edl') from shipment_notices));
select public.t_assert('wp0 owner edl: connections only its own', (select count(*) = 1 and bool_and(company_id = 'edl') from connections));

select public.switch_test_identity('owner', 'hmo');
select public.t_assert('wp0 owner hmo: sees 0 edl capacity_events', (select count(*) = 0 from capacity_events));

select public.switch_test_identity('customer', 'slp-interiors');
select public.t_assert('wp0 customer slp: cannot see qss alert_outcomes or risk_history',
  (select count(*) = 0 from alert_outcomes ao join alerts a on a.id = ao.alert_id where a.customer_id = 'qss')
  and (select count(*) = 0 from risk_history where customer_id = 'qss'));
select public.t_assert('wp0 customer slp: pair_contacts has no edl (not its supplier)',
  (select count(*) = 0 from pair_contacts where company_id = 'edl'));

reset role;
set local role anon;
select public.t_throws('wp0 anon: cannot read contacts', $$select count(*) from contacts$$);
select public.t_throws('wp0 anon: cannot read shipment_notices', $$select count(*) from shipment_notices$$);
reset role;

set local role authenticated;
select public.switch_test_identity('customer', 'qss');
select public.t_works('wp0 reset_demo runs', $$select reset_demo()$$);
reset role;
select public.t_assert('wp0 reset_demo clears shipment_notices, capacity_events, risk_history, alert_outcomes, connections, runs',
  (select count(*) = 0 from shipment_notices) and (select count(*) = 0 from capacity_events) and (select count(*) = 0 from risk_history)
  and (select count(*) = 0 from alert_outcomes) and (select count(*) = 0 from connections) and (select count(*) = 0 from integration_runs));
select public.t_assert('wp0 reset_demo keeps one primary contact per company with a contact and clears phones',
  (select count(*) from contacts) = (select count(*) from companies where contact is not null)
  and (select count(*) = 0 from contacts where phone_e164 is not null or whatsapp_opt_in_at is not null));

-- ---- WP1: admin signal RPCs (announced blockades and policy events; disable / enable)
set local role authenticated;
select public.switch_test_identity('customer', 'qss');
select public.t_throws('wp1 customer qss: cannot add a signal',
  $$select admin_upsert_signal('{"kind":"blockade","title":"x","startsAt":"2026-10-08","endsAt":"2026-10-08","severity":"high","lat":19,"lon":-98,"radiusKm":20,"transitMultiplier":2}')$$);
select public.t_throws('wp1 customer qss: cannot disable a signal', $$select admin_set_signal_active('sig-rain-veracruz', false)$$);
select public.t_throws('wp1 customer qss: cannot update signals directly', $$update signals set active = false where id = 'sig-rain-veracruz'$$);
select public.switch_test_identity('owner', 'edl');
select public.t_throws('wp1 owner edl: cannot add a signal',
  $$select admin_upsert_signal('{"kind":"policy","title":"x","startsAt":"2026-10-08","endsAt":"2026-10-08","severity":"low","affects":{"originCountries":["CN"]}}')$$);

select public.switch_test_identity('admin', 'qss');
select public.t_works('wp1 admin: adds a pre-announced blockade',
  $$select admin_upsert_signal('{"id":"adm-test-blockade","kind":"blockade","title":"Bloqueo anunciado en la MEX-57D","startsAt":"2026-10-09","endsAt":"2026-10-10","severity":"high","lat":20.39,"lon":-99.99,"radiusKm":15,"highways":["mex-57d"],"transitMultiplier":2.2,"state":"Querétaro"}')$$);
select public.t_assert('wp1 admin: blockade stored with source_id admin, estimated, highways upper-cased',
  (select source_id = 'admin' and provenance = 'estimated' and active and highways = '{MEX-57D}' and transit_multiplier = 2.2
   from signals where id = 'adm-test-blockade'));
select public.t_works('wp1 admin: adds a tariff policy event',
  $$select admin_upsert_signal('{"id":"adm-test-policy","kind":"policy","title":"Arancel a autopartes","startsAt":"2026-11-01","endsAt":"2026-12-31","severity":"medium","affects":{"originCountries":["cn","KR"],"hsPrefixes":["8708","87.14"]}}')$$);
select public.t_assert('wp1 admin: policy keeps affects and has no transit effect',
  (select affects = '{"originCountries":["CN","KR"],"hsPrefixes":["8708","8714"]}'::jsonb and transit_multiplier = 1 and radius_km = 0
   from signals where id = 'adm-test-policy'));
select public.t_throws('wp1 admin: policy without countries or HS prefixes is refused',
  $$select admin_upsert_signal('{"kind":"policy","title":"x","startsAt":"2026-11-01","endsAt":"2026-11-02","severity":"low","affects":{}}')$$);
select public.t_throws('wp1 admin: other kinds are refused',
  $$select admin_upsert_signal('{"kind":"weather","title":"x","startsAt":"2026-11-01","endsAt":"2026-11-02","severity":"low","lat":19,"lon":-98,"radiusKm":20,"transitMultiplier":2}')$$);
select public.t_throws('wp1 admin: end before start is refused',
  $$select admin_upsert_signal('{"kind":"blockade","title":"x","startsAt":"2026-11-02","endsAt":"2026-11-01","severity":"low","lat":19,"lon":-98,"radiusKm":20,"transitMultiplier":2}')$$);
select public.t_throws('wp1 admin: cannot overwrite a feed signal',
  $$select admin_upsert_signal('{"id":"sig-rain-veracruz","kind":"blockade","title":"x","startsAt":"2026-11-01","endsAt":"2026-11-02","severity":"low","lat":19,"lon":-98,"radiusKm":20,"transitMultiplier":2}')$$);
select public.t_works('wp1 admin: disables a feed signal', $$select admin_set_signal_active('sig-rain-veracruz', false)$$);
select public.t_assert('wp1 admin: the feed signal is inactive', (select not active from signals where id = 'sig-rain-veracruz'));
select public.t_works('wp1 admin: enables it again', $$select admin_set_signal_active('sig-rain-veracruz', true)$$);
select public.t_throws('wp1 admin: unknown signal id is an error', $$select admin_set_signal_active('no-such-signal', false)$$);
select public.t_works('wp1 admin: edits its own blockade',
  $q$select admin_set_signal_active('adm-test-blockade', false), admin_upsert_signal('{"id":"adm-test-blockade","kind":"blockade","title":"Bloqueo pospuesto","startsAt":"2026-10-12","endsAt":"2026-10-12","severity":"medium","lat":20.39,"lon":-99.99,"radiusKm":15,"transitMultiplier":1.5}')$q$);
select public.t_assert('wp1 admin: an edit keeps it disabled and changes the dates',
  (select not active and starts_at = '2026-10-12' and title = 'Bloqueo pospuesto' from signals where id = 'adm-test-blockade'));
reset role;
set local role anon;
select public.t_throws('wp1 anon: cannot call admin_upsert_signal',
  $$select admin_upsert_signal('{"kind":"policy","title":"x","startsAt":"2026-11-01","endsAt":"2026-11-02","severity":"low","affects":{"originCountries":["CN"]}}')$$);
select public.t_throws('wp1 anon: cannot call admin_set_signal_active', $$select admin_set_signal_active('sig-rain-veracruz', false)$$);
reset role;

-- ---- Track record: missed_events (delivery problems nobody warned about)
reset role;
insert into missed_events (customer_id, supplier_id, part_id, event_date, evidence) values
  ('qss', 'edl', 'part-qss-4471-brk', '2026-09-30', '[]'),
  ((select customer_id from parts where customer_id = 'slp-interiors' limit 1), (select supplier_id from parts where customer_id = 'slp-interiors' limit 1),
   (select id from parts where customer_id = 'slp-interiors' limit 1), '2026-09-30', '[]');
set local role authenticated;
select public.switch_test_identity('customer', 'qss');
select public.t_assert('miss customer qss: sees only its own missed_events', (select count(*) = 1 and bool_and(customer_id = 'qss') from missed_events));
select public.t_throws('miss customer qss: cannot insert missed_events',
  $$insert into missed_events (customer_id, supplier_id, part_id, event_date) values ('qss', 'edl', 'part-qss-4471-brk', '2026-09-29')$$);
select public.switch_test_identity('owner', 'edl');
select public.t_assert('miss owner edl: sees the miss about itself', (select count(*) = 1 and bool_and(supplier_id = 'edl') from missed_events));
select public.switch_test_identity('owner', 'hmo');
select public.t_assert('miss owner hmo: sees none', (select count(*) = 0 from missed_events));
select public.switch_test_identity('customer', 'qss');
select public.t_works('miss reset_demo runs', $$select reset_demo()$$);
reset role;
select public.t_assert('miss reset_demo clears missed_events (parts restored)', (select count(*) = 0 from missed_events));

-- ---- report
select (case when ok then 'PASS' else 'FAIL' end) || '  ' || name from public.t_results order by n;
select count(*) filter (where not ok) > 0 as failed, count(*) filter (where not ok) as nfail from public.t_results \gset
rollback;
\if :failed
  \echo :nfail assertion(s) FAILED
  \echo TESTS FAILED
\else
  \echo All assertions passed
\endif
