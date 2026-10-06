-- 12-week outlook (business case: BCG's steel-maker example flags risks about 12 weeks ahead). Weekly levels from signals
-- known in advance (seasonal patterns, announced events), next to the 14-day daily projection that drives alerts.
alter table public.risks add column outlook jsonb not null default '[]';  -- [{weekStart, expectedTransitDays, extraDays, level, signals}]
