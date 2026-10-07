-- WP1 (Phase 2): announced events entered by the platform admin on the Signals page.
-- Signals stay read-only for every role (policy "signals" is select-only); admins write only through these two RPCs.
--   admin_upsert_signal(sig jsonb): add or edit an announced `blockade` (pre-announced road blockade, by place and
--     highway) or `policy` (tariff or USMCA event, by affects.originCountries / affects.hsPrefixes) signal.
--     Keys are the app's camelCase field names. Rows get source_id 'admin'; feed signals cannot be overwritten.
--   admin_set_signal_active(signal_id text, is_active boolean): disable or re-enable any signal. A live feed's next
--     run sets its own signals active again while the feed still reports them.

create or replace function public.admin_upsert_signal(sig jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  sid text := nullif(trim(sig->>'id'), '');
  k text := sig->>'kind';
  t text := nullif(trim(sig->>'title'), '');
  s_from date; s_to date; mult numeric; rad numeric; la double precision; lo double precision;
  aff jsonb; countries text[]; prefixes text[]; hws text[];
begin
  if my_role() is distinct from 'admin' then raise exception 'Only the platform admin can add signals'; end if;
  if k is null or k not in ('blockade', 'policy') then raise exception 'Kind must be blockade or policy'; end if;
  if t is null then raise exception 'A title is required'; end if;
  s_from := (sig->>'startsAt')::date; s_to := (sig->>'endsAt')::date;
  if s_from is null or s_to is null or s_to < s_from then raise exception 'Give a start date and an end date on or after it'; end if;
  if coalesce(sig->>'severity', '') not in ('low', 'medium', 'high') then raise exception 'Severity must be low, medium or high'; end if;
  if sid is not null and (sid not like 'adm-%' or exists (select 1 from signals where id = sid and source_id is distinct from 'admin')) then
    raise exception 'Signal % comes from a feed and cannot be edited here', sid; end if;

  if k = 'blockade' then
    la := (sig->>'lat')::double precision; lo := (sig->>'lon')::double precision; rad := (sig->>'radiusKm')::numeric;
    mult := (sig->>'transitMultiplier')::numeric;
    if la is null or lo is null or la not between 14 and 33 or lo not between -118 and -86 then
      raise exception 'Give a latitude and longitude in Mexico or at the border'; end if;
    if rad is null or rad <= 0 or rad > 200 then raise exception 'Radius must be between 0 and 200 km'; end if;
    if mult is null or mult < 1 or mult > 5 then raise exception 'Transit effect must be between 1 and 5'; end if;
    select coalesce(array_agg(upper(trim(h))) filter (where trim(h) <> ''), '{}') into hws
      from jsonb_array_elements_text(coalesce(sig->'highways', '[]')) h;
    aff := null;
  else
    -- policy: reaches parts by origin country / HS code, not by place or transit time
    select coalesce(array_agg(upper(trim(c))), '{}') into countries
      from jsonb_array_elements_text(coalesce(sig->'affects'->'originCountries', '[]')) c where trim(c) <> '';
    select coalesce(array_agg(replace(trim(p), '.', '')), '{}') into prefixes
      from jsonb_array_elements_text(coalesce(sig->'affects'->'hsPrefixes', '[]')) p where trim(p) <> '';
    if cardinality(countries) = 0 and cardinality(prefixes) = 0 then
      raise exception 'A policy signal needs origin countries or HS code prefixes'; end if;
    if exists (select 1 from unnest(countries) c where c !~ '^[A-Z]{2}$') then
      raise exception 'Origin countries are two-letter ISO codes, e.g. CN'; end if;
    if exists (select 1 from unnest(prefixes) p where p !~ '^[0-9]{2,10}$') then
      raise exception 'HS code prefixes are 2 to 10 digits, e.g. 8708'; end if;
    aff := jsonb_strip_nulls(jsonb_build_object(
      'originCountries', case when cardinality(countries) > 0 then to_jsonb(countries) end,
      'hsPrefixes', case when cardinality(prefixes) > 0 then to_jsonb(prefixes) end));
    la := 0; lo := 0; rad := 0; mult := 1; hws := '{}';
  end if;

  sid := coalesce(sid, 'adm-' || k || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'));
  insert into signals (id, kind, title, description, state, lat, lon, radius_km, highways, starts_at, ends_at, severity,
                       transit_multiplier, source, provenance, short_label, source_id, external_ref, active, affects)
  values (sid, k, t, coalesce(nullif(trim(sig->>'description'), ''), t),
          coalesce(nullif(trim(sig->>'state'), ''), case when k = 'policy' then 'All' else '' end),
          la, lo, rad, hws, s_from, s_to, sig->>'severity', mult, 'Announced event (admin)', 'estimated',
          coalesce(nullif(trim(sig->>'shortLabel'), ''), left(t, 60)), 'admin', sid, true, aff)
  on conflict (id) do update set kind = excluded.kind, title = excluded.title, description = excluded.description,
    state = excluded.state, lat = excluded.lat, lon = excluded.lon, radius_km = excluded.radius_km,
    highways = excluded.highways, starts_at = excluded.starts_at, ends_at = excluded.ends_at, severity = excluded.severity,
    transit_multiplier = excluded.transit_multiplier, short_label = excluded.short_label, affects = excluded.affects,
    ingested_at = now();
  return sid;
end $$;

create or replace function public.admin_set_signal_active(signal_id text, is_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role() is distinct from 'admin' then raise exception 'Only the platform admin can disable signals'; end if;
  update signals set active = coalesce(is_active, true) where id = signal_id;
  if not found then raise exception 'Signal % not found', signal_id; end if;
end $$;

revoke execute on function public.admin_upsert_signal(jsonb), public.admin_set_signal_active(text, boolean) from public, anon;
grant execute on function public.admin_upsert_signal(jsonb), public.admin_set_signal_active(text, boolean) to authenticated;
