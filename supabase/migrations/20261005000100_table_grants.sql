-- Fix: the core schema relies on RLS policies, but newer Supabase default privileges give anon/authenticated/service_role
-- only Dxtm (no SELECT/INSERT/UPDATE) on new public tables, so every policy-guarded query failed with "permission denied".
-- Grant exactly what the policies allow; RLS still decides which rows. demo_snapshot stays unreachable (service role only).
grant select on public.profiles, public.app_settings, public.companies, public.relationships, public.signals,
  public.emission_factors, public.sites, public.partners, public.lanes, public.machines, public.certifications,
  public.kpis, public.energy, public.materials, public.shipments, public.twins, public.uploads, public.parts,
  public.risks, public.alerts, public.invites, public.requests, public.shares, public.jobs
  to authenticated;
-- Own operating data (policies: own company insert/update)
grant insert, update on public.sites, public.partners, public.lanes, public.machines, public.certifications,
  public.kpis, public.energy, public.materials, public.shipments, public.twins, public.uploads to authenticated;
grant insert on public.invites, public.jobs to authenticated;
grant usage on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;
