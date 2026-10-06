-- Ports and customs (professor feedback D, Oct 2026): imported material crosses a border or a port, where customs is
-- a control point. A supplier's route to a key customer is a list of legs (road, border, customs, port, sea), each with
-- a normal time; signals slow only the legs they reach. Domestic suppliers keep no route (one implicit road leg).
alter table public.supplier_profiles add column route jsonb;   -- [{kind, label, place, lat, lon, days, highways}]
alter table public.risks add column legs jsonb not null default '[]';  -- [{kind, label, place, normalDays, expectedDays}]
alter table public.signals drop constraint signals_kind_check;
alter table public.signals add constraint signals_kind_check
  check (kind in ('weather', 'road', 'theft', 'port', 'blockade', 'supplier', 'customs'));
