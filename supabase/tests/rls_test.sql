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
  (select count(*) = 5 and bool_and(customer_id = 'qss') from alerts));
select public.t_assert('customer qss: parts only where customer_id=qss',
  (select count(*) > 0 and bool_and(customer_id = 'qss') from parts));
select public.t_assert('customer qss: sees 0 lanes', (select count(*) = 0 from lanes));
select public.t_assert('customer qss: sees 0 sites', (select count(*) = 0 from sites));
select public.t_assert('customer qss: sees 0 machines', (select count(*) = 0 from machines));
select public.t_assert('customer qss: sees 0 uploads', (select count(*) = 0 from uploads));
select public.t_assert('customer qss: sees companies and signals', (select count(*) > 0 from companies) and (select count(*) > 0 from signals));
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
select public.t_assert('admin: sees companies', (select count(*) = 14 from companies));
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
select public.t_works('reset_demo runs', $$select reset_demo()$$);
select switch_test_identity('customer', 'qss');
select public.t_assert('reset_demo restores alert-hmo-qss to new', (select status = 'new' and chosen_action_id is null from alerts where id = 'alert-hmo-qss'));
select public.t_assert('reset_demo restores edl response (status supplier-responded)', (select status = 'supplier-responded' from alerts where id = 'alert-edl-qss'));
select public.t_assert('reset_demo restores invites to 2', (select count(*) = 2 from invites));

-- ---- anon cannot call RPCs
reset role;
set local role anon;
select public.t_throws('anon: cannot call reset_demo', $$select reset_demo()$$);
reset role;

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
