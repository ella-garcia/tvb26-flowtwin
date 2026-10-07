"""Orchestrator: risk rows and alert rows for one customer, from plain DB-shaped dicts."""
from datetime import date, timedelta

from .alerts import make_alert
from .circular import DEFAULT_FACTOR, transport_footprint
from .flex import FLEX_DAYS, run_flex
from .otif import otif_series
from .outlook import outlook
from .scenarios import scenarios
from .projection import HORIZON, input_cut_on, project
from .scoring import score_drivers, traffic_light

DEFAULT_SETTINGS = {"line_stop_cost_eur_per_minute": 15000, "contract_demand_swing": 0.15, "line_hours_per_day": 16,
                    "pallets_per_truck": 24, "expedite_trips_per_short_day": 1, "expedite_fill_rate": 0.3, "milkrun_radius_km": 120}


def compute_pair(customer, supplier, parts, signals, settings, as_of, factor=None):
    """Risk for one (customer, supplier). Returns (risk_row, ctx).

    customer: companies row (id, name, lat, lon).
    supplier: companies row merged with its profile: city, name, lat, lon, data_status, highways,
              lead_time_variability, utilization, ceiling, fg_days, bottleneck, otif (a, b, kind) or otif_trend (list of 12);
              optional capacity_events (the supplier's capacity_events rows; private, they only change the flex result).
    parts:    parts rows for the pair (in_transit / next_delivery_date / supplier_fg_on_hand / origin_country / hs_code
              used when present). signals: signals rows. settings: app_settings-shaped dict.
    """
    parts = sorted(parts, key=lambda p: p["number"])
    proj = project(customer, supplier, parts, signals, settings, as_of)
    cuts = [input_cut_on(supplier, signals, as_of + timedelta(days=i)) for i in range(FLEX_DAYS)]
    flex = run_flex(supplier, float(settings["contract_demand_swing"]), as_of, cuts, supplier.get("capacity_events") or ())
    otif = supplier.get("otif_trend") or otif_series(supplier["id"], supplier["otif"])
    score, drivers = score_drivers(customer, supplier, proj, flex, otif, signals, parts)
    dtls = proj["days_to_line_stop"]
    level = traffic_light(score, dtls)
    risk = dict(customer_id=customer["id"], supplier_id=supplier["id"], level=level, score=score,
                normal_transit_days=proj["normal"], expected_transit_days=proj["expected"], worst_case_transit_days=proj["worst"],
                min_cover_days=proj["min_cover"], days_to_line_stop=dtls, part_stop_days=proj["part_stops"], legs=proj["legs"],
                line_stop_exposure_eur=proj["exposure"],
                drivers=drivers, flex=flex, otif_trend=otif, projection=proj["projection"],
                outlook=outlook(supplier, parts, signals, as_of, proj["normal"]),
                scenarios=scenarios(supplier, parts, signals, as_of, proj["normal"]),
                circular=transport_footprint(customer, supplier, parts, settings, factor or DEFAULT_FACTOR),
                data_status=supplier["data_status"], updated_at=as_of.isoformat())
    covers = [p["coverDays"] for p in proj["projection"]]
    top = next((d for d in drivers if "signalId" in d), None)
    isig = next((s for s in proj["input_signals"] if top and s["id"] == top["signalId"]), None)
    ctx = dict(exposed_part=proj["exposed"]["part"],
               top_signal=top["signalId"] if top else None,
               min_proj_cover=min(covers), cover_at=min(range(HORIZON), key=lambda i: covers[i]),
               stop_cause=proj["stop_cause"],
               # the input shortage leads the alert when it empties the cover first, or is the top signal driver
               input=dict(signal=isig or proj["input_signals"][0], fg_days=proj["exposed"]["fg"])
               if proj["input_signals"] and (proj["stop_cause"] == "input" or isig) else None)
    return risk, ctx


def compute_customer(customer, suppliers, parts, signals, settings, as_of=None, factor=None):
    """All risks (and alerts for every non-green one) of a customer.

    suppliers: {supplier_id: supplier dict as in compute_pair} for suppliers that have parts for this customer.
    parts: all parts rows for the customer. factor: road emission factor row (optional). Returns (risk_rows, alert_rows).
    """
    as_of = as_of or date.today()
    if isinstance(as_of, str):
        as_of = date.fromisoformat(as_of)
    sig_by_id = {s["id"]: s for s in signals}
    risks, alerts = [], []
    for sid in sorted(suppliers):
        sp = suppliers[sid]
        sp_parts = [p for p in parts if p["supplier_id"] == sid and p["customer_id"] == customer["id"]]
        if not sp_parts:
            continue
        risk, ctx = compute_pair(customer, sp, sp_parts, signals, settings, as_of, factor)
        risks.append(risk)
        if risk["level"] != "green":
            alerts.append(make_alert(customer, sp, risk, ctx, as_of, sig_by_id))
    alerts.sort(key=lambda a: -a["line_stop_exposure_eur"])
    return risks, alerts
