-- What-if scenarios for the key customer: recommended actions per supplier and the 12-week outlook levels for every
-- combination of them ({actions: [{id, label, detail}], combos: {"010": [{level, extraDays}] x 12}}). Precomputed by the
-- risk engine so the app only combines results.
alter table public.risks add column scenarios jsonb not null default '{}';
