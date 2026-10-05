"""Alert generation. Text is built from the risk record so numbers always match."""
from datetime import timedelta

DEFAULT_ACTIONS = [
    ("Ask for a confirmed ship plan", "Ask {supplier} for a daily ship plan until the situation is stable."),
    ("Pull the next order forward", "Ask {supplier} to ship the next order early to build cover."),
    ("Add safety stock", "Raise safety stock of the exposed part until the signals clear."),
]

# Scripted actions per supplier id (from the v0 demo); other suppliers get DEFAULT_ACTIONS.
ACTIONS = {
    "hmo": [("Pull the next order forward", "Ask Hules y Mangueras de Orizaba to ship the next two orders before the rain peaks, adding about 1.5 days of cover."),
            ("Add 2 days of safety stock", "Raise the lumbar air line safety stock to 5 days until the rainy season ends (about MX$38k of inventory)."),
            ("Use the alternative route via Tehuacán", "Route trucks through Tehuacán and Cuacnopalan (MEX-150 free road) to avoid the landslide-prone Orizaba–Puebla toll stretch."),
            ("Qualify the second source", "Start a second-source qualification for the lumbar air hose; PPAP level 3 takes about 10 weeks.")],
    "tsr": [("Pull the next order forward", "Ask Tornillos y Sujetadores to ship Thursday's flange screw order on Tuesday."),
            ("Add 3 days of safety stock", "Buy a one-off buffer of M6 flange screws; at MX$0.62 each this is under MX$30k for 3 days."),
            ("Qualify the second source", "Flange screws are single-source. Qualify a second heading shop in the Bajío.")],
    "edl": [("Ask for a confirmed ship plan", "Ask Estampados del Laja for a daily ship plan until Press 4 is stable."),
            ("Move departures to daytime", "Agree that loads for QSS leave between 06:00 and 18:00 to avoid the MEX-45D night theft risk."),
            ("Add 2 days of safety stock", "Hold 2 extra days of the recliner mounting plate while Press 4 recovers.")],
    "pip": [("Pull the next order forward", "Ask Plásticos Inyectados de Puebla to ship one day early, before the blockade peaks."),
            ("Use the alternative route via MEX-150D", "Reroute through MEX-150D toll road, bypassing the Amozoc–Tlaxcala corridor."),
            ("Add 2 days of safety stock", "Build 2 days of cover on the seat side trim cover; it is single-source and a line-stopper.")],
    "rdp": [("Ask for resin on hand", "Ask Resinas del Pacífico to confirm how many days of PA6 compound it has outside the port."),
            ("Add 3 days of safety stock", "Raise PA6 compound stock at QSS to 6 days while the port clears."),
            ("Qualify the second source", "Qualify a domestic PA6 compound source so a port delay does not reach the line.")],
}


def money(x):
    if x < 1000:
        return "under €1k"
    return f"€{x/1e6:.1f}M" if x >= 1e6 else f"€{x/1e3:.0f}k"


def fdate(d):
    return f"{d.day} {d.strftime('%b %Y')}"


def make_alert(customer, supplier, risk, ctx, as_of, signals_by_id):
    """Build an alert row (DB column shape, status 'new') for a non-green risk.

    ctx comes from engine.risk.compute_pair: exposed part, top signal id, min projected cover and its day index.
    """
    ex = ctx["exposed_part"]
    c0 = float(ex["days_of_cover"])
    norm, exp_ = risk["normal_transit_days"], risk["expected_transit_days"]
    sig = signals_by_id.get(ctx["top_signal"]) if ctx["top_signal"] else None
    dtls = risk["days_to_line_stop"]
    nm = customer["name"]
    if dtls is not None:
        sd = as_of + timedelta(days=dtls)
        title = f"Transit from {supplier['city']} goes from {norm} to {round(exp_):g} days"
        msg = (f"{nm} holds {c0:g} days of cover of {ex['name'].lower()} ({ex['number']}). With transit at {round(exp_):g} days "
               f"(up to {risk['worst_case_transit_days']:g} in the worst case) and nothing done, cover runs out in about {dtls} days, "
               f"around {fdate(sd)}. Expected line-stop exposure: {money(risk['line_stop_exposure_eur'])}.")
        shortfall = sd.isoformat()
    else:
        title = (f"Transit from {supplier['city']} goes from {norm} to {round(exp_):g} days" if exp_ - norm >= 0.9
                 else (sig["title"] if sig else f"Delivery risk: {supplier['name']}"))
        ld = as_of + timedelta(days=ctx["cover_at"])
        msg = (f"{nm} holds {c0:g} days of cover of {ex['name'].lower()} ({ex['number']}). Transit is {exp_:g} days against {norm} planned "
               f"(up to {risk['worst_case_transit_days']:g} in the worst case). Without action, projected cover falls to {ctx['min_proj_cover']:g} days around {fdate(ld)}; "
               f"no stop is expected in the next 14 days, but a bad week could stop the line. Expected line-stop exposure: {money(risk['line_stop_exposure_eur'])}.")
        shortfall = None
    scripted = ACTIONS.get(supplier["id"], [(l, d.format(supplier=supplier["name"])) for l, d in DEFAULT_ACTIONS])
    acts = [dict(id=f"act-{supplier['id']}-{i+1}", label=l, description=d) for i, (l, d) in enumerate(scripted[:3])]
    return dict(id=f"alert-{supplier['id']}-{customer['id']}", customer_id=customer["id"], supplier_id=supplier["id"],
                part_ids=[ex["id"]], signal_id=sig["id"] if sig else None, level=risk["level"], title=title, message=msg,
                created_at=as_of.isoformat(), expected_shortfall_date=shortfall, line_stop_exposure_eur=risk["line_stop_exposure_eur"],
                status="new", actions=acts, chosen_action_id=None, supplier_response=None)
