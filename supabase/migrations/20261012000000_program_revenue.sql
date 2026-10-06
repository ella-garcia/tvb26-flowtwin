-- The key customer's own content value per vehicle (seat set or trim it sells), for the What-if revenue view only.
-- Estimated; money is never shown on the risk board, alerts or emails.
alter table public.vehicle_programs add column revenue_per_vehicle_mxn numeric check (revenue_per_vehicle_mxn >= 0);
