-- SAMPLE DATA for a live demo of the twin track record (WP3). Not real deliveries.
-- Run manually against a local, seeded database, e.g.
--   docker exec -i supabase_db_flowtwin-v0 psql -U postgres -d postgres < supabase/demo/track_demo.sql
-- It adds past alerts (ids ending in a date), the receipts and shipment notices they are judged by, the risk snapshots
-- of the days they were raised, and their outcomes (rules v1, as worker/track/rules.py would judge them).
-- Same content as app/src/data/track-demo.json. Safe to run twice (on conflict do nothing).
-- Cleared by reset_demo(): it deletes alerts that are not in the seed snapshot (outcomes cascade), receipts,
-- shipment notices and risk_history.
begin;

insert into public.alerts (id, customer_id, supplier_id, part_ids, level, title, message, created_at, expected_shortfall_date,
                           line_stop_exposure_eur, status, actions, chosen_action_id, supplier_response) values
  ('alert-hmo-qss-20260908', 'qss', 'hmo', '{part-qss-6120-lmb}', 'red', 'Transit from Orizaba goes from 2 to 5 days',
   'Sample data. Cover of the lumbar air line was projected to run out around 11 Sep 2026.', '2026-09-08', '2026-09-11', 0,
   'resolved', '[{"id":"act-hmo-1","label":"Pull the next order forward","description":"Sample action."}]', null, null),
  ('alert-pip-qss-20260915', 'qss', 'pip', '{part-qss-7205-trm}', 'amber', 'Highway blockade, Puebla–Tlaxcala corridor',
   'Sample data. Cover of the seat side trim cover was projected to run out around 18 Sep 2026.', '2026-09-15', '2026-09-18', 0,
   'resolved', '[{"id":"act-pip-1","label":"Pull the next order forward","description":"Sample action."}]', 'act-pip-1', null),
  ('alert-tsr-qss-20260825', 'qss', 'tsr', '{part-qss-9011-fls}', 'amber', 'Road closure, MEX-57D near Palmillas',
   'Sample data. Cover of the M6 flange screw was projected to run out around 28 Aug 2026.', '2026-08-25', '2026-08-28', 0,
   'resolved', '[{"id":"act-tsr-1","label":"Pull the next order forward","description":"Sample action."}]', null, null),
  ('alert-rdp-qss-20260901', 'qss', 'rdp', '{part-qss-5310-pab}', 'amber', 'Transit from Manzanillo goes from 2 to 4 days',
   'Sample data. Cover of the PA6 compound was projected to run out around 5 Sep 2026.', '2026-09-01', '2026-09-05', 0,
   'resolved', '[]', null, null),
  ('alert-edl-qss-20260812', 'qss', 'edl', '{part-qss-4480-rcp}', 'amber', 'Press 4 breakdown, Estampados del Laja',
   'Sample data. Cover of the recliner mounting plate was projected to run out around 15 Aug 2026.', '2026-08-12', '2026-08-15', 0,
   'resolved', '[]', null, null),
  ('alert-hmo-qss-20260728', 'qss', 'hmo', '{part-qss-6120-lmb}', 'red', 'Transit from Orizaba goes from 2 to 4 days',
   'Sample data. Cover of the lumbar air line was projected to run out around 31 Jul 2026.', '2026-07-28', '2026-07-31', 0,
   'resolved', '[]', null,
   '{"by":"Gloria Montiel","at":"2026-07-29","message":"Sample data: an extra truck leaves on the 28th.","confirmedCapacity":true}'),
  ('alert-pfl-qss-20261003', 'qss', 'pfl', '{part-qss-5401-pph}', 'amber', 'Transit from Laredo goes from 4 to 7 days',
   'Sample data. Cover of the PP pellets is projected to run out around 8 Oct 2026.', '2026-10-03', '2026-10-08', 0,
   'acknowledged', '[]', null, null),
  ('alert-tsr-qss-20260618', 'qss', 'tsr', '{part-qss-9011-fls}', 'red', 'Road closure, MEX-57D near San Juan del Río',
   'Sample data. Cover of the M6 flange screw was projected to run out around 20 Jun 2026.', '2026-06-18', '2026-06-20', 0,
   'resolved', '[]', null, null),
  ('alert-rpo-slp-interiors-20260904', 'slp-interiors', 'rpo', '{part-slp-2401-spr}', 'amber', 'Transit from San Luis Potosí goes from 1 to 2 days',
   'Sample data. Cover of the compression spring was projected to run out around 7 Sep 2026.', '2026-09-04', '2026-09-07', 0,
   'resolved', '[]', null, null)
on conflict (id) do nothing;

insert into public.receipts (customer_id, supplier_id, part_id, po_number, promised_date, received_date, quantity_ordered,
                             quantity_received, upload_id, source, source_ref) values
  ('qss', 'hmo', 'part-qss-6120-lmb', 'PO-QSS-48211', '2026-09-10', '2026-09-12', 1800, 1800, 'track-demo', 'upload', 'track-demo'),
  ('qss', 'pip', 'part-qss-7205-trm', 'PO-QSS-48544', '2026-09-17', '2026-09-16', 600, 600, 'track-demo', 'upload', 'track-demo'),
  ('qss', 'tsr', 'part-qss-9011-fls', 'PO-QSS-47902', '2026-08-26', '2026-08-26', 43200, 43200, 'track-demo', 'upload', 'track-demo'),
  ('qss', 'tsr', 'part-qss-9011-fls', 'PO-QSS-47958', '2026-08-28', '2026-08-28', 43200, 43200, 'track-demo', 'upload', 'track-demo'),
  ('qss', 'edl', 'part-qss-4480-rcp', 'PO-QSS-47511', '2026-08-14', '2026-08-14', 2400, 1800, 'track-demo', 'upload', 'track-demo'),
  ('qss', 'hmo', 'part-qss-6120-lmb', 'PO-QSS-46980', '2026-07-30', '2026-07-30', 3600, 3600, 'track-demo', 'upload', 'track-demo'),
  ('qss', 'tsr', 'part-qss-9011-fls', 'PO-QSS-45120', '2026-06-20', '2026-06-21', 43200, 43200, 'track-demo', 'upload', 'track-demo'),
  ('slp-interiors', 'rpo', 'part-slp-2401-spr', 'PO-SLP-2231', '2026-09-06', '2026-09-06', 5000, 5000, 'track-demo', 'upload', 'track-demo')
on conflict (customer_id, po_number, part_id) do nothing;

insert into public.shipment_notices (customer_id, supplier_id, part_id, quantity, ship_date, expected_arrival, carrier, source, source_ref) values
  ('qss', 'hmo', 'part-qss-6120-lmb', 3600, '2026-07-28', '2026-07-30', 'Sample carrier', 'edi', 'ASN-HMO-0730')
on conflict (source, source_ref, part_id) do nothing;

insert into public.risk_history (customer_id, supplier_id, as_of, level, score, days_to_line_stop, part_stop_days) values
  ('qss', 'hmo', '2026-09-08', 'red', 78, 3, '{"part-qss-6120-lmb":3}'),
  ('qss', 'pip', '2026-09-15', 'amber', 58, 3, '{"part-qss-7205-trm":3}'),
  ('qss', 'tsr', '2026-08-25', 'amber', 52, 3, '{"part-qss-9011-fls":3}'),
  ('qss', 'rdp', '2026-09-01', 'amber', 49, 4, '{"part-qss-5310-pab":4}'),
  ('qss', 'edl', '2026-08-12', 'amber', 55, 3, '{"part-qss-4480-rcp":3}'),
  ('qss', 'hmo', '2026-07-28', 'red', 71, 3, '{"part-qss-6120-lmb":3}'),
  ('qss', 'pfl', '2026-10-03', 'amber', 57, 5, '{"part-qss-5401-pph":5}'),
  ('qss', 'tsr', '2026-06-18', 'red', 68, 2, '{"part-qss-9011-fls":2}'),
  ('slp-interiors', 'rpo', '2026-09-04', 'amber', 41, 3, '{"part-slp-2401-spr":3}')
on conflict (customer_id, supplier_id, as_of) do nothing;

insert into public.alert_outcomes (alert_id, predicted_stop_date, part_ids, outcome, evidence, rule_version, evaluated_at) values
  ('alert-hmo-qss-20260908', '2026-09-11', '{part-qss-6120-lmb}', 'hit',
   '[{"kind":"receipt","ref":"PO-QSS-48211","date":"2026-09-12","note":"late by 2 days"}]', 'v1', '2026-09-13T06:05:00Z'),
  ('alert-pip-qss-20260915', '2026-09-18', '{part-qss-7205-trm}', 'prevented',
   '[{"kind":"action","ref":"act-pip-1","date":null,"note":"Customer chose: Pull the next order forward"},
     {"kind":"receipt","ref":"PO-QSS-48544","date":"2026-09-16","note":"On time and complete"}]', 'v1', '2026-09-20T06:05:00Z'),
  ('alert-tsr-qss-20260825', '2026-08-28', '{part-qss-9011-fls}', 'false-alarm',
   '[{"kind":"receipt","ref":"PO-QSS-47902","date":"2026-08-26","note":"On time and complete"},
     {"kind":"receipt","ref":"PO-QSS-47958","date":"2026-08-28","note":"On time and complete"}]', 'v1', '2026-08-30T06:05:00Z'),
  ('alert-rdp-qss-20260901', '2026-09-05', '{part-qss-5310-pab}', 'unknown',
   '[{"kind":"receipt","ref":"none","date":null,"note":"No receipts or shipment notices for these parts between 2026-08-31 and 2026-09-06"}]',
   'v1', '2026-09-07T06:05:00Z'),
  ('alert-edl-qss-20260812', '2026-08-15', '{part-qss-4480-rcp}', 'hit',
   '[{"kind":"receipt","ref":"PO-QSS-47511","date":"2026-08-14","note":"short: 1800 of 2400"}]', 'v1', '2026-08-17T06:05:00Z'),
  ('alert-hmo-qss-20260728', '2026-07-31', '{part-qss-6120-lmb}', 'prevented',
   '[{"kind":"action","ref":"supplier-response","date":"2026-07-29","note":"Supplier confirmed capacity (Gloria Montiel)"},
     {"kind":"receipt","ref":"PO-QSS-46980","date":"2026-07-30","note":"On time and complete"},
     {"kind":"shipment-notice","ref":"ASN-HMO-0730","date":"2026-07-30","note":"Shipped 3600, expected 2026-07-30"}]', 'v1', '2026-08-02T06:05:00Z'),
  ('alert-pfl-qss-20261003', '2026-10-08', '{part-qss-5401-pph}', 'pending', '[]', 'v1', '2026-10-05T06:05:00Z'),
  ('alert-tsr-qss-20260618', '2026-06-20', '{part-qss-9011-fls}', 'hit',
   '[{"kind":"receipt","ref":"PO-QSS-45120","date":"2026-06-21","note":"late by 1 day"}]', 'v1', '2026-06-22T06:05:00Z'),
  ('alert-rpo-slp-interiors-20260904', '2026-09-07', '{part-slp-2401-spr}', 'false-alarm',
   '[{"kind":"receipt","ref":"PO-SLP-2231","date":"2026-09-06","note":"On time and complete"}]', 'v1', '2026-09-09T06:05:00Z')
on conflict (alert_id) do nothing;

commit;
