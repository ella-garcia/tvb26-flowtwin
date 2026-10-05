-- Stock along the pipeline for each part (professor feedback, Oct 2026: stock must be visible per part).
-- All nullable: null = unknown (in transit) / not shared (supplier finished goods) / no confirmed date (next delivery).
alter table public.parts add column in_transit numeric check (in_transit >= 0);
alter table public.parts add column supplier_fg_on_hand numeric check (supplier_fg_on_hand >= 0);
alter table public.parts add column next_delivery_date date;
