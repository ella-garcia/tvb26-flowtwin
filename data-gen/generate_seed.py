#!/usr/bin/env python3
"""FlowTwin v0 seed + risk engine. Standard library only, deterministic.

Run:  python3 data-gen/generate_seed.py      (writes app/src/data/seed/seed.json)
See data-gen/README.md for the model.
"""
import json, math, random, os, sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "worker"))
from engine.flex import run_flex  # the worker engine (stdlib only) is the one risk model
from engine.geo import clamp, hash_seed, hav, pct
from engine.otif import otif_series

ASOF = date(2026, 10, 5)
HORIZON = 14
RUNS = 500
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "src", "data", "seed", "seed.json")
RNG = random.Random(20261005)

SETTINGS = {"lineStopCostEurPerMinute": 15000, "contractDemandSwing": 0.15, "lineHoursPerDay": 16}
SHIFT_MIN = 480  # a stoppage is capped at one 8-hour shift
CRIT_W = {"line-stopper": 1.0, "high": 0.4, "normal": 0.05}


def iso(d): return d.isoformat()
def D(s): return date.fromisoformat(s)


# ----------------------------------------------------------------- customers
CUSTOMERS = [
    dict(id="qss", name="QRO Seating Systems", city="Querétaro", state="Querétaro", lat=20.59, lon=-100.39,
         sizeBand="large", employees=2400, scian="336360",
         contact=dict(name="Alejandra Ruiz", email="a.ruiz@qss.example", role="Supplier development manager")),
    dict(id="slp-interiors", name="SLP Interiors México", city="San Luis Potosí", state="San Luis Potosí", lat=22.15, lon=-100.98,
         sizeBand="large", employees=1650, scian="336360",
         contact=dict(name="Mauricio Del Valle", email="m.delvalle@slp-interiors.example", role="Purchasing director")),
]
CUST = {c["id"]: c for c in CUSTOMERS}

# ----------------------------------------------------------------- vehicle programmes (fictional OEMs and models)
# A Tier 1 seating plant builds for several models at once (e.g. one seat plant, a compact SUV and a sedan line).
PROGRAMS = [
    dict(id="prog-qss-k3", customerId="qss", oem="OEM A", model="K3 compact SUV", oemPlant="Silao, Guanajuato", dailyVehicles=1150),
    dict(id="prog-qss-m5", customerId="qss", oem="OEM B", model="M5 midsize sedan", oemPlant="Aguascalientes, Aguascalientes", dailyVehicles=620),
    dict(id="prog-qss-t1", customerId="qss", oem="OEM A", model="T1 pickup", oemPlant="Silao, Guanajuato", dailyVehicles=380),
    dict(id="prog-slp-c2", customerId="slp-interiors", oem="OEM C", model="C2 crossover", oemPlant="San Luis Potosí, San Luis Potosí", dailyVehicles=900),
]
# Part number -> programmes. Parts not listed go into every programme of their customer (screws, resin, springs...).
# Story: the lumbar air line at risk (Orizaba) is a premium-seat part used only on the K3, so the M5 line is safe.
PART_PROGRAMS = {
    "QSS-6120-LMB": ["prog-qss-k3"],
    "QSS-6140-CLH": ["prog-qss-k3", "prog-qss-t1"],
    "QSS-4480-RCP": ["prog-qss-k3", "prog-qss-m5"],
    "QSS-4492-XMB": ["prog-qss-k3", "prog-qss-t1"],
    "QSS-7205-TRM": ["prog-qss-m5"],
    "QSS-7218-HDL": ["prog-qss-k3", "prog-qss-m5"],
    "QSS-3108-LTH": ["prog-qss-t1"],
    "QSS-8401-HRN": ["prog-qss-k3", "prog-qss-t1"],
    "QSS-2306-HNG": ["prog-qss-k3", "prog-qss-m5"],
}


def program_ids(cid, number):
    return PART_PROGRAMS.get(number) or [g["id"] for g in PROGRAMS if g["customerId"] == cid]

# ----------------------------------------------------------------- suppliers
# part tuple: (number, name, unitCostMxn, dailyUsage, coverDays, singleSource, criticality)
# otif: (start, end, kind) weekly series; hw = main highways of the lane to the customer
S = []
def sup(**k): S.append(k)

sup(id="edl", name="Estampados del Laja", city="Celaya", state="Guanajuato", lat=20.52, lon=-100.81, size="medium", emp=118,
    scian="336370", status="connected", cv=0.38, hw=["MEX-45D"], bn="Press 4 (400 t)", util=0.88, ceil=0.95, fg=0.5,
    contact=dict(name="Roberto Laja", email="roberto@edl.example", role="Owner"),
    otif=(0.968, 0.915, "decline"),
    cust={"qss": dict(share=0.41, parts=[
        ("QSS-4471-BRK", "Seat track bracket", 38.5, 3600, 4.0, False, "high"),
        ("QSS-4480-RCP", "Recliner mounting plate", 52.0, 1800, 1.2, True, "line-stopper"),
        ("QSS-4492-XMB", "Cross member, rear seat frame", 96.0, 1800, 5.0, False, "high")])})
sup(id="hmo", name="Hules y Mangueras de Orizaba", city="Orizaba", state="Veracruz", lat=18.85, lon=-97.10, size="medium", emp=210,
    scian="326220", status="connected", cv=0.25, hw=["MEX-150D"], bn="Extrusion line 2", util=0.91, ceil=0.95, fg=1.0,
    contact=dict(name="Gloria Montiel", email="gmontiel@hmo.example", role="Sales and logistics manager"),
    otif=(0.972, 0.93, "dip"),
    cust={"qss": dict(share=0.55, parts=[
        ("QSS-6120-LMB", "Lumbar air line, 6 mm hose assembly", 21.4, 1800, 3.0, True, "line-stopper"),
        ("QSS-6133-GRM", "Seat track rubber grommet", 3.2, 7200, 8.0, False, "normal"),
        ("QSS-6140-CLH", "Hose clamp and sleeve kit", 9.8, 1800, 5.0, False, "high")])})
sup(id="tsr", name="Tornillos y Sujetadores Regiomontanos", city="Monterrey", state="Nuevo León", lat=25.67, lon=-100.31, size="small", emp=64,
    scian="332722", status="connected", cv=0.30, hw=["MEX-57D"], bn="Cold heading machines", util=0.78, ceil=0.95, fg=2.0,
    contact=dict(name="Ernesto Garza", email="egarza@tsr.example", role="General manager"),
    otif=(0.978, 0.955, "decline"),
    cust={"qss": dict(share=0.62, parts=[
        ("QSS-9011-FLS", "M6 flange screw, zinc-nickel", 0.62, 14400, 1.5, True, "line-stopper"),
        ("QSS-9027-CLP", "Trim retaining clip", 0.38, 14400, 6.0, False, "high"),
        ("QSS-9033-WSH", "Anti-rattle washer", 0.11, 14400, 9.0, False, "normal")])})
sup(id="pip", name="Plásticos Inyectados de Puebla", city="Puebla", state="Puebla", lat=19.04, lon=-98.20, size="medium", emp=150,
    scian="326199", status="connected", cv=0.22, hw=["MEX-190", "MEX-57D"], bn="Injection press 7 (450 t)", util=0.82, ceil=0.95, fg=1.5,
    contact=dict(name="Verónica Sandoval", email="vsandoval@pip.example", role="Operations director"),
    otif=(0.975, 0.955, "decline"),
    cust={"qss": dict(share=0.38, parts=[
        ("QSS-7205-TRM", "Seat side trim cover", 44.0, 1800, 1.5, True, "line-stopper"),
        ("QSS-7218-HDL", "Recline handle", 18.6, 1800, 3.0, False, "high")])})
sup(id="rdp", name="Resinas del Pacífico", city="Manzanillo", state="Colima", lat=19.11, lon=-104.34, size="small", emp=72,
    scian="325211", status="connected", cv=0.28, hw=["MEX-200", "MEX-15D"], bn="Imported resin supply (port)", util=0.74, ceil=0.95, fg=2.0,
    contact=dict(name="Julián Barragán", email="jbarragan@rdp.example", role="Owner"),
    otif=(0.976, 0.955, "decline"),
    cust={"qss": dict(share=0.30, parts=[
        ("QSS-5310-PAB", "PA6 glass-filled resin, seat base compound", 62.0, 900, 2.0, True, "line-stopper"),
        ("QSS-5322-PPC", "PP copolymer masterbatch, black", 31.0, 1100, 7.0, False, "normal")])})
sup(id="etb", name="Espumas y Tapizados del Bajío", city="León", state="Guanajuato", lat=21.12, lon=-101.68, size="medium", emp=240,
    scian="326150", status="connected", cv=0.12, hw=["MEX-45D"], bn="Foam pouring line 1", util=0.70, ceil=0.95, fg=1.5,
    contact=dict(name="Patricia Olvera", email="polvera@etb.example", role="Commercial manager"),
    otif=(0.985, 0.984, "flat"),
    cust={"qss": dict(share=0.28, parts=[
        ("QSS-3101-FMC", "Seat cushion foam pad", 74.0, 1800, 4.0, False, "high"),
        ("QSS-3108-LTH", "Leather trim set, front seat", 410.0, 1800, 6.0, False, "high")])})
sup(id="cha", name="Cableados Hidrocálidos", city="Aguascalientes", state="Aguascalientes", lat=21.88, lon=-102.29, size="medium", emp=180,
    scian="335930", status="invited", cv=0.15, hw=["MEX-45D"], bn="Harness assembly cells", util=0.72, ceil=0.95, fg=1.0,
    contact=dict(name="Rocío Calderón", email="rcalderon@cha.example", role="Plant manager"),
    otif=(0.95, 0.95, "flat"),
    cust={"qss": dict(share=0.20, parts=[
        ("QSS-8401-HRN", "Seat heater wiring harness", 135.0, 1800, 5.0, False, "high"),
        ("QSS-8409-SNS", "Occupancy sensor cable", 48.0, 1800, 7.0, False, "normal")])})
sup(id="mds", name="Mecanizados de Silao", city="Silao", state="Guanajuato", lat=20.94, lon=-101.43, size="small", emp=85,
    scian="332710", status="connected", cv=0.10, hw=["MEX-45D"], bn="CNC cell B", util=0.66, ceil=0.95, fg=2.0,
    contact=dict(name="Héctor Ibarra", email="hibarra@mds.example", role="Owner"),
    otif=(0.988, 0.986, "flat"),
    cust={"qss": dict(share=0.35, parts=[
        ("QSS-2210-PVT", "Recliner pivot pin, machined", 14.5, 3600, 8.0, False, "high"),
        ("QSS-2215-SPC", "Spacer bushing", 4.1, 3600, 10.0, False, "normal")]),
          "slp-interiors": dict(share=0.12, parts=[
        ("SLP-2210-PVT", "Door trim pivot pin", 11.9, 2200, 9.0, False, "high")])})
sup(id="fdt", name="Forjas de Toluca", city="Toluca", state="México", lat=19.29, lon=-99.65, size="medium", emp=130,
    scian="332111", status="invited", cv=0.14, hw=["MEX-15D", "MEX-57D"], bn="Forging press 3", util=0.75, ceil=0.95, fg=1.5,
    contact=dict(name="Armando Peña", email="apena@fdt.example", role="Sales manager"),
    otif=(0.955, 0.955, "flat"),
    cust={"qss": dict(share=0.18, parts=[
        ("QSS-2301-FRG", "Seat adjuster forged lever", 66.0, 1800, 9.0, False, "high"),
        ("QSS-2306-HNG", "Hinge forging blank", 29.0, 1800, 11.0, False, "normal")])})
sup(id="rpo", name="Resortes Potosinos", city="San Luis Potosí", state="San Luis Potosí", lat=22.17, lon=-100.93, size="medium", emp=96,
    scian="332612", status="connected", cv=0.11, hw=["MEX-57D"], bn="Coiling line 4", util=0.68, ceil=0.95, fg=2.0,
    contact=dict(name="Lucía Navarro", email="lnavarro@rpo.example", role="Operations manager"),
    otif=(0.989, 0.987, "flat"),
    cust={"qss": dict(share=0.33, parts=[
        ("QSS-2401-SPR", "Seat back compression spring", 8.6, 3600, 9.0, False, "high"),
        ("QSS-2407-ZSP", "S-spring zigzag, cushion", 12.2, 3600, 12.0, False, "normal")]),
          "slp-interiors": dict(share=0.22, parts=[
        ("SLP-2401-SPR", "Door armrest return spring", 5.1, 2600, 10.0, False, "normal")])})
sup(id="tps", name="Tubería y Perfiles de Saltillo", city="Saltillo", state="Coahuila", lat=25.42, lon=-101.00, size="medium", emp=140,
    scian="331210", status="public-only", cv=0.20, hw=["MEX-57D"], bn="Roll-forming line (estimated)", util=0.76, ceil=0.95, fg=1.5,
    contact=dict(name="Sergio Treviño", email="strevino@tps.example", role="Sales manager"),
    otif=(0.955, 0.95, "flat"),
    cust={"qss": dict(share=0.25, parts=[
        ("QSS-1101-TUB", "Seat frame tube, 22 mm", 28.0, 1800, 8.0, False, "high"),
        ("QSS-1108-PRF", "Rail profile, roll formed", 41.0, 1800, 10.0, False, "normal")]),
          "slp-interiors": dict(share=0.30, parts=[
        ("SLP-1101-TUB", "Instrument panel support tube", 56.0, 1300, 6.0, True, "high")])})
sup(id="pis", name="Pinturas Industriales de San Luis", city="San Luis Potosí", state="San Luis Potosí", lat=22.12, lon=-101.02, size="small", emp=58,
    scian="325510", status="connected", cv=0.13, hw=["MEX-57D"], bn="Powder-coat line", util=0.71, ceil=0.95, fg=1.0,
    contact=dict(name="Diana Ochoa", email="dochoa@pis.example", role="Owner"),
    otif=(0.982, 0.98, "flat"),
    cust={"slp-interiors": dict(share=0.60, parts=[
        ("SLP-5101-PWD", "Powder coat, textured black (kg)", 96.0, 480, 12.0, False, "normal"),
        ("SLP-5110-CPT", "Coated door support bracket", 7.4, 2600, 4.0, False, "high")])})
SUP = {s["id"]: s for s in S}


def eng_supplier(sp):
    """Supplier spec -> engine supplier dict (companies row merged with its profile)."""
    return dict(id=sp["id"], name=sp["name"], city=sp["city"], lat=sp["lat"], lon=sp["lon"], highways=sp["hw"],
                lead_time_variability=sp["cv"], utilization=sp["util"], ceiling=sp["ceil"], fg_days=sp["fg"],
                bottleneck=sp["bn"], otif=sp["otif"], data_status=sp["status"])

# ----------------------------------------------------------------- signals
SIGNALS = [
    dict(id="sig-rain-veracruz", kind="weather", short="Rainy season",
         title="Heavy rain and landslide risk, central Veracruz",
         description="Late rainy season: saturated slopes on the Orizaba–Puebla stretch of MEX-150D. Trucks queue at partial closures and transit from Orizaba stretches from 2 to about 5 days.",
         state="Veracruz", lat=18.85, lon=-97.10, radiusKm=90, highways=["MEX-150D"], startsAt="2026-09-28", endsAt="2026-10-20",
         severity="high", transitMultiplier=2.6, source="SMN/CONAGUA seasonal outlook (seeded for demo)"),
    dict(id="sig-hurricane-gulf", kind="weather", short="Hurricane watch",
         title="Hurricane watch, Gulf of Mexico coast",
         description="A tropical system is forecast to approach the Veracruz coast; heavy rain inland on 8–12 Oct. A watch, not a warning.",
         state="Veracruz", lat=19.20, lon=-96.13, radiusKm=120, highways=[], startsAt="2026-10-08", endsAt="2026-10-12",
         severity="medium", transitMultiplier=1.3, source="SMN tropical cyclone bulletin (seeded for demo)"),
    dict(id="sig-closure-57d", kind="road", short="Partial closure on MEX-57D",
         title="Road closure, MEX-57D near Palmillas",
         description="Lane closure for bridge repair; trucks are diverted for a few hours at a time.",
         state="Querétaro", lat=20.37, lon=-99.95, radiusKm=25, highways=["MEX-57D"], startsAt="2026-10-03", endsAt="2026-10-08",
         severity="medium", transitMultiplier=1.3, source="Capufe / SCT road report (seeded for demo)"),
    dict(id="sig-blockade-puebla", kind="blockade", short="Highway blockade near Puebla and Tlaxcala",
         title="Highway blockade, Puebla–Tlaxcala corridor",
         description="Community blockade on MEX-119 and MEX-190 near Amozoc. Cargo is held or rerouted through side roads.",
         state="Puebla", lat=19.05, lon=-98.05, radiusKm=60, highways=["MEX-119", "MEX-190"], startsAt="2026-10-04", endsAt="2026-10-09",
         severity="medium", transitMultiplier=1.7, source="Local news and carrier reports (seeded for demo)"),
    dict(id="sig-theft-45d57d", kind="theft", short="Night cargo theft on MEX-45D / MEX-57D",
         title="Cargo theft hotspot, MEX-45D / MEX-57D at night",
         description="Reported hijackings on the Celaya–Querétaro and Querétaro–San Luis Potosí stretches between 20:00 and 05:00. Carriers add escorts or hold trucks until daylight.",
         state="Guanajuato", lat=20.50, lon=-100.60, radiusKm=70, highways=["MEX-45D", "MEX-57D"], startsAt="2026-09-20", endsAt="2026-11-15",
         severity="medium", transitMultiplier=1.06, source="Carrier incident reports (seeded for demo)"),
    dict(id="sig-port-manzanillo", kind="port", short="Port congestion at Manzanillo",
         title="Container congestion, Port of Manzanillo",
         description="Yard saturation and customs queues delay container release by 3–5 days; imported resin reaches the supplier late and outbound loads slip.",
         state="Colima", lat=19.05, lon=-104.32, radiusKm=80, highways=["MEX-200"], startsAt="2026-09-25", endsAt="2026-10-18",
         severity="medium", transitMultiplier=1.5, source="API Manzanillo terminal notice (seeded for demo)"),
    dict(id="sig-press-edl", kind="supplier", short="Press 4 unplanned stop at Estampados del Laja",
         title="Press 4 breakdown, Estampados del Laja",
         description="Die change overran on Press 4 (400 t). Output is being recovered with overtime; outbound shipments leave later in the day, and more of them at night.",
         state="Guanajuato", lat=20.52, lon=-100.81, radiusKm=5, highways=[], startsAt="2026-10-04", endsAt="2026-10-12",
         severity="medium", transitMultiplier=1.3, source="Supplier-reported through FlowTwin (seeded for demo)"),
    dict(id="sig-rain-toluca", kind="weather", short="Heavy rain in the Toluca valley",
         title="Heavy afternoon rain, Toluca valley",
         description="Daily storms flood low-lying roads around Toluca and slow trucks on MEX-15D.",
         state="México", lat=19.29, lon=-99.65, radiusKm=50, highways=[], startsAt="2026-09-30", endsAt="2026-10-15",
         severity="low", transitMultiplier=1.1, source="SMN daily forecast (seeded for demo)"),
]
for s in SIGNALS: s["provenance"] = "estimated"
SIG = {s["id"]: s for s in SIGNALS}


def affects(sp, sig):
    return hav(sp["lat"], sp["lon"], sig["lat"], sig["lon"]) <= sig["radiusKm"] or bool(set(sp["hw"]) & set(sig["highways"]))


def active_on(sig, d): return D(sig["startsAt"]) <= d <= D(sig["endsAt"])


def mult_on(sp, d):
    m = 1.0
    for sig in SIGNALS:
        if affects(sp, sig) and active_on(sig, d): m *= sig["transitMultiplier"]
    return m


# ----------------------------------------------------------------- risk engine
def assess(cid, sp, cinfo):
    cust = CUST[cid]
    rng = random.Random(hash_seed(cid, sp["id"], "mc"))
    parts = cinfo["parts"]
    km = hav(sp["lat"], sp["lon"], cust["lat"], cust["lon"]) * 1.3  # road km ~ 1.3 x straight line
    normal = max(1, math.ceil(km / 400))                              # ~1 day per 400 km incl. loading, min 1
    sigma = 0.6 * sp["cv"]
    days = [ASOF + timedelta(days=i) for i in range(HORIZON)]
    M = [mult_on(sp, d) for d in days]

    # --- per-day transit percentiles (independent draws, RUNS per day)
    proj_t = []
    for m in M:
        xs = sorted(normal * m * math.exp(sigma * rng.gauss(0, 1)) for _ in range(RUNS))
        proj_t.append((pct(xs, .1), pct(xs, .5), pct(xs, .9)))
    gap_med = [normal * (m - 1) for m in M]                           # median extra days vs plan

    # --- per-part cover and stop exposure (one noise draw per run, applied over all 14 days)
    zs = [rng.gauss(0, 1) for _ in range(RUNS)]
    cost = SETTINGS["lineStopCostEurPerMinute"]; lhd = SETTINGS["lineHoursPerDay"]
    info = []
    for (num, name, ucost, usage, c0, single, crit) in parts:
        cover_d = [max(0.0, c0 - min(g, i + 1)) for i, g in enumerate(gap_med)]
        tot, stops = 0.0, 0
        for z in zs:
            short = 0.0
            for i, m in enumerate(M):
                gap = max(0.0, normal * m * math.exp(sigma * z) - normal)
                short = max(short, min(gap, i + 1) - c0)
            if short > 0:
                stops += 1
            tot += min(SHIFT_MIN, max(0.0, short) * lhd * 60)
        expo = CRIT_W[crit] * (tot / RUNS) * cost
        stop_day = next((i for i, c in enumerate(cover_d) if c <= 0.05), None) if crit in ("line-stopper", "high") else None
        info.append(dict(part=(num, name, ucost, usage, c0, single, crit), cover_d=cover_d, expo=expo, stop_day=stop_day, pstop=stops / RUNS))
    exposed = max(info, key=lambda x: (round(x["expo"], -3), -x["part"][4]))
    exposure = round(sum([exposed["expo"]]) / 1000) * 1000
    stop_days = [x["stop_day"] for x in info if x["stop_day"] is not None]
    dtls = min(stop_days) if stop_days else None
    part_stops = {f"part-{x['part'][0].lower()}": x["stop_day"] for x in info if x["stop_day"] is not None}
    min_cover = min(p[4] for p in parts)

    projection = [dict(date=iso(d), transitP10=round(t[0], 1), transitP50=round(t[1], 1), transitP90=round(t[2], 1),
                       coverDays=round(exposed["cover_d"][i], 1)) for i, (d, t) in enumerate(zip(days, proj_t))]
    p50s = sorted(t[1] for t in proj_t)
    expected = round(p50s[len(p50s) // 2], 1)
    worst = round(max(t[2] for t in proj_t), 1)

    flex = run_flex(eng_supplier(sp), SETTINGS["contractDemandSwing"])
    otif = otif_series(sp["id"], sp["otif"])
    decline = sum(otif[:4]) / 4 - sum(otif[-4:]) / 4

    # --- score drivers (points)
    drivers = []  # (label, kind, signalId, points)
    ex_part = exposed["part"]; c0 = ex_part[4]
    gap90 = max(0.0, max(t[2] for t in proj_t) - normal)
    delay_pts = 45 * clamp(gap90 / max(c0, 0.5) / 2.0)
    sigs = [s for s in SIGNALS if affects(sp, s) and any(active_on(s, d) for d in days)]
    if sigs and delay_pts > 0.5:
        w = {s["id"]: math.log(s["transitMultiplier"]) for s in sigs}
        tw = sum(w.values())
        for s in sigs:
            extra = normal * (s["transitMultiplier"] - 1)
            if s["kind"] == "supplier":
                lab = f"{s['short']} delays outbound loads by about {extra:.1f} days"
            elif s["kind"] == "theft":
                lab = f"{s['short']} adds about {extra:.1f} days (escorts, daytime-only departures)"
            else:
                lab = f"{s['short']} adds {extra:.1f} days to transit from {sp['city']}"
            drivers.append((lab, s["kind"], s["id"], delay_pts * w[s["id"]] / tw))
    elif delay_pts > 0.5:
        drivers.append((f"Normal transit variability against {c0:g} days of cover", "cover", None, delay_pts))
    cw = CRIT_W[ex_part[6]]
    crit_pts = {"line-stopper": 10, "high": 5, "normal": 1}[ex_part[6]] + (6 if ex_part[5] else 0)
    lab = f"{ex_part[1]} is a {'single-source ' if ex_part[5] else ''}{ex_part[6].replace('-', ' ')} part"
    drivers.append((lab, "cover", None, crit_pts))
    if ex_part[6] in ("line-stopper", "high"):
        thin = 8 * clamp((5 - c0) / 4)
        if thin > 0.5: drivers.append((f"Only {c0:g} days of cover at {cust['name']}", "cover", None, thin))
    if not flex["canAbsorb"]:
        fp = 14 * clamp((0.99 - flex["serviceLevel"]) / 0.08)
        drivers.append((f"Cannot absorb +15% demand: service level {flex['serviceLevel']*100:.0f}% at {flex['bottleneck']}", "flex", None, max(fp, 3)))
    op = 10 * clamp(decline / 0.06)
    if op > 0.5: drivers.append((f"On-time-in-full fell {decline*100:.1f} points over 12 weeks", "history", None, op))
    vp = 8 * clamp(sp["cv"] / 0.4)
    if vp > 0.5: drivers.append((f"Lead-time variability of {sp['cv']*100:.0f}%", "history", None, vp))
    if sp["status"] == "invited": drivers.append(("No data from the supplier yet (invited); score uses public signals only", "history", None, 8))
    if sp["status"] == "public-only": drivers.append(("Supplier not on FlowTwin; score uses public signals only", "history", None, 6))

    total = sum(d[3] for d in drivers)
    scale = 100 / total if total > 100 else 1
    pts = [d[3] * scale for d in drivers]
    score = int(round(sum(pts)))
    fl = [int(math.floor(p)) for p in pts]
    rem = score - sum(fl)
    for i in sorted(range(len(pts)), key=lambda i: pts[i] - fl[i], reverse=True)[:max(0, rem)]: fl[i] += 1
    out_drivers = [dict(label=d[0], kind=d[1], **({"signalId": d[2]} if d[2] else {}), contribution=c)
                   for d, c in zip(drivers, fl) if c > 0]
    out_drivers.sort(key=lambda x: -x["contribution"])

    level = "red" if (score >= 65 or (dtls is not None and dtls <= 3)) else "amber" if score >= 35 else "green"
    return dict(
        risk=dict(customerId=cid, supplierId=sp["id"], level=level, score=score, normalTransitDays=normal,
                  expectedTransitDays=expected, worstCaseTransitDays=worst, minCoverDays=min_cover, daysToLineStop=dtls, partStopDays=part_stops,
                  lineStopExposureEur=exposure, drivers=out_drivers, flex=flex, otifTrend=otif, projection=projection,
                  dataStatus=sp["status"], updatedAt=iso(ASOF)),
        exposed=ex_part, top_signal=next((d["signalId"] for d in out_drivers if "signalId" in d), None),
        min_proj_cover=min(p["coverDays"] for p in projection), cover_at=min(range(HORIZON), key=lambda i: projection[i]["coverDays"]))


# ----------------------------------------------------------------- build
def pipeline(sp, usage, risk):
    """Stock beyond the key customer's own: on the road and at the supplier, plus the next delivery date.

    Only a connected supplier shares ASNs and finished goods, so the other fields stay absent (unknown / not shared)
    and the app estimates the next delivery from expected transit. One truck is on the road per day of normal
    transit beyond the first (a 2-day lane has one day of usage in transit); it lands after the expected transit.
    """
    if sp["status"] != "connected":
        return {}
    norm = risk["normalTransitDays"]
    return dict(inTransit=int(round(usage * max(0, norm - 1))), supplierFgOnHand=int(round(usage * sp["fg"])),
                nextDeliveryDate=iso(ASOF + timedelta(days=math.ceil(risk["expectedTransitDays"]))))


def build():
    companies, rels, parts_out, risks_out, assessments = [], [], [], [], {}
    for c in CUSTOMERS:
        companies.append(dict(id=c["id"], name=c["name"], city=c["city"], state=c["state"], lat=c["lat"], lon=c["lon"], kind="customer",
                              sizeBand=c["sizeBand"], employees=c["employees"], scian=c["scian"], packIds=["auto"], synthetic=True, contact=c["contact"]))
    for sp in S:
        companies.append(dict(id=sp["id"], name=sp["name"], city=sp["city"], state=sp["state"], lat=sp["lat"], lon=sp["lon"], kind="supplier",
                              sizeBand=sp["size"], employees=sp["emp"], scian=sp["scian"], packIds=["auto"], synthetic=True, contact=sp["contact"]))
        for cid, ci in sp["cust"].items():
            rels.append(dict(supplierId=sp["id"], customerId=cid, chainPosition="sub", shareOfSales=ci["share"],
                             requirements=dict(otifTarget=0.98, ppmTarget=50, approvalLevel=3, certifications=["IATF 16949"])))
            a = assess(cid, sp, ci)
            assessments[(cid, sp["id"])] = a
            risks_out.append(a["risk"])
            for (num, name, ucost, usage, c0, single, crit) in ci["parts"]:
                parts_out.append(dict(id=f"part-{num.lower()}", number=num, name=name, supplierId=sp["id"], customerId=cid, unitCostMxn=ucost,
                                      dailyUsage=usage, onHand=int(round(usage * c0)), daysOfCover=round(c0, 2), singleSource=single, criticality=crit,
                                      **pipeline(sp, usage, a["risk"]), programIds=program_ids(cid, num)))
    return companies, rels, parts_out, risks_out, assessments


def fdate(d): return f"{d.day} {d.strftime('%b %Y')}"


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


def make_alert(cid, sp, a, status, created, extra=None):
    r = a["risk"]; ex = a["exposed"]
    c0 = ex[4]; norm = r["normalTransitDays"]; exp_ = r["expectedTransitDays"]
    sig = SIG.get(a["top_signal"]) if a["top_signal"] else None
    if r["daysToLineStop"] is not None:
        sd = ASOF + timedelta(days=r["daysToLineStop"])
        title = f"Transit from {sp['city']} goes from {norm} to {round(exp_):g} days"
        msg = (f"{CUST[cid]['name']} holds {c0:g} days of cover of {ex[1].lower()} ({ex[0]}). With transit at {round(exp_):g} days "
               f"(up to {r['worstCaseTransitDays']:g} in the worst case) and nothing done, cover runs out in about {r['daysToLineStop']} days, "
               f"around {fdate(sd)}.")
        shortfall = iso(sd)
    else:
        title = (f"Transit from {sp['city']} goes from {norm} to {round(exp_):g} days" if exp_ - norm >= 0.9
                 else (sig["title"] if sig else f"Delivery risk: {sp['name']}"))
        low = a["min_proj_cover"]; ld = ASOF + timedelta(days=a["cover_at"])
        msg = (f"{CUST[cid]['name']} holds {c0:g} days of cover of {ex[1].lower()} ({ex[0]}). Transit is {exp_:g} days against {norm} planned "
               f"(up to {r['worstCaseTransitDays']:g} in the worst case). Without action, projected cover falls to {low:g} days around {fdate(ld)}; "
               f"no stop is expected in the next 14 days, but a bad week could stop the line.")
        shortfall = None
    acts = [dict(id=f"act-{sp['id']}-{i+1}", label=l, description=d) for i, (l, d) in enumerate(ACTIONS[sp["id"]][:3])]
    al = dict(id=f"alert-{sp['id']}-{cid}", customerId=cid, supplierId=sp["id"], partIds=[f"part-{ex[0].lower()}"],
              level=r["level"], title=title, message=msg, createdAt=created, lineStopExposureEur=r["lineStopExposureEur"],
              status=status, actions=acts)
    if sig: al["signalId"] = sig["id"]
    if shortfall: al["expectedShortfallDate"] = shortfall
    if extra: al.update(extra)
    return al


def edl_operating(companies_extra):
    E = "edl"
    sites = [dict(id="edl-plant", companyId=E, name="Planta Celaya", type="plant", city="Celaya", lat=20.52, lon=-100.81, palletPositions=900, rentedPositions=0),
             dict(id="edl-wh", companyId=E, name="Bodega rentada Apaseo el Grande", type="warehouse", city="Apaseo el Grande", lat=20.55, lon=-100.69, palletPositions=420, rentedPositions=420)]
    P = lambda i, n, role, city, lat, lon, **k: dict(id=f"edl-p-{i}", companyId=E, name=n, role=role, city=city, lat=lat, lon=lon, **k)
    partners = [
        P("coil-mty", "Aceros del Norte", "supplier", "Monterrey", 25.69, -100.32, material="steel-coil", leadTimeDays=9, leadTimeVariability=0.38),
        P("coil-slp", "Laminados Potosinos", "supplier", "San Luis Potosí", 22.15, -100.98, material="steel-coil", leadTimeDays=4, leadTimeVariability=0.15),
        P("fast-qro", "Sujetadores del Bajío", "supplier", "Querétaro", 20.59, -100.39, material="fasteners", leadTimeDays=3, leadTimeVariability=0.10),
        P("pack-leon", "Empaques Leoneses", "supplier", "León", 21.12, -101.68, material="packaging", leadTimeDays=2, leadTimeVariability=0.08),
        P("qss", "QRO Seating Systems", "customer", "Querétaro", 20.59, -100.39, linkedCompanyId="qss"),
        P("cust-ags", "Carrocerías del Centro", "customer", "Aguascalientes", 21.88, -102.29),
        P("cust-silao", "Sistemas de Escape Bajío", "customer", "Silao", 20.94, -101.43),
    ]
    L = lambda i, f, t, dr, hw, km, tr, fill, theft, night, cost: dict(id=f"edl-lane-{i}", companyId=E, fromId=f, toId=t, direction=dr, highway=hw,
                                                                       km=km, tripsPerWeek=tr, fillRate=fill, theftRisk=theft, nightShare=night, costPerTripMxn=cost)
    lanes = [
        L("coil-mty", "edl-p-coil-mty", "edl-plant", "inbound", "MEX-57D", 760, 6, 0.92, "high", 0.55, 24500),
        L("coil-slp", "edl-p-coil-slp", "edl-plant", "inbound", "MEX-57D", 330, 3, 0.90, "medium", 0.30, 11800),
        L("fast-qro", "edl-p-fast-qro", "edl-plant", "inbound", "MEX-45D", 60, 2, 0.70, "low", 0.05, 2900),
        L("pack-leon", "edl-p-pack-leon", "edl-plant", "inbound", "MEX-45D", 95, 2, 0.85, "low", 0.10, 3600),
        L("to-qss", "edl-plant", "edl-p-qss", "outbound", "MEX-45D", 65, 12, 0.88, "high", 0.60, 4100),
        L("to-ags", "edl-plant", "edl-p-cust-ags", "outbound", "MEX-45D", 230, 4, 0.81, "medium", 0.35, 8200),
        L("to-silao", "edl-plant", "edl-p-cust-silao", "outbound", "MEX-45D", 85, 5, 0.84, "low", 0.15, 3300),
        L("wh", "edl-plant", "edl-wh", "internal", None, 18, 14, 0.75, "low", 0.0, 1200),
    ]
    for l in lanes:
        if l["highway"] is None: del l["highway"]
    caps = [200, 200, 300, 400, 500, 600]; ut = [0.62, 0.58, 0.71, 0.88, 0.64, 0.51]; sh = [12, 12, 12, 15, 12, 9]
    machines = [dict(id=f"edl-press-{i+1}", companyId=E, name=f"Press {i+1} ({caps[i]} t)", capacityTonnes=caps[i], shiftsPerWeek=sh[i], utilization=ut[i]) for i in range(6)]
    certs = [dict(companyId=E, name="IATF 16949", validUntil="2027-03-14"), dict(companyId=E, name="ISO 9001", validUntil="2027-03-14")]
    U = lambda k, f, rows, src, st, at=None: dict(companyId=E, kind=k, fileName=f, rows=rows, source=src, status=st, **({"uploadedAt": at} if at else {}))
    uploads = [U("sales-orders", "pedidos_clientes_2026.xlsx", 4820, "Excel", "uploaded", "2026-09-21"),
               U("purchase-orders", "compras_CONTPAQi_sep26.csv", 2310, "CONTPAQi export", "uploaded", "2026-09-21"),
               U("inventory", "inventario_semanal.xlsx", 1264, "Excel", "uploaded", "2026-10-02"),
               U("item-master", "catalogo_piezas.xlsx", 386, "Excel", "uploaded", "2026-09-18"),
               U("quality", "rechazos_2026.xlsx", 740, "Excel", "uploaded", "2026-09-28"),
               U("freight", "fletes_sep26.xlsx", 612, "Excel", "uploaded", "2026-10-01"),
               U("energy", "recibos_CFE_2026.pdf", 0, "CFE bills", "waiting"),
               U("fuel", "diesel_flotilla_2026.xlsx", 0, "Excel", "waiting")]
    return sites, partners, lanes, machines, certs, uploads


def main():
    companies, rels, parts, risks, ass = build()
    sites, partners, lanes, machines, certs, uploads = edl_operating(None)

    # --- alerts: one per red and per significant amber
    alerts = []
    meta = {"hmo": ("new", "2026-10-05"), "tsr": ("new", "2026-10-04"), "edl": ("supplier-responded", "2026-10-04"),
            "pip": ("acknowledged", "2026-10-03"), "rdp": ("new", "2026-10-02")}
    for (cid, sid), a in sorted(ass.items(), key=lambda kv: -kv[1]["risk"]["lineStopExposureEur"]):
        r = a["risk"]
        if r["level"] == "green" or sid not in meta: continue
        st, created = meta[sid]
        extra = None
        if sid == "edl":
            extra = dict(supplierResponse=dict(by="Roberto Laja", at="2026-10-05",
                         message="Press 4 is back in production since Monday night. We confirm capacity for the next two QSS orders and will add a Saturday shift if the +15% arrives. Departures for QSS will leave before 18:00.",
                         confirmedCapacity=True))
        if sid == "pip":
            extra = dict(chosenActionId="act-pip-1")
        alerts.append(make_alert(cid, SUP[sid], a, st, created, extra))
    alerts.sort(key=lambda x: -x["lineStopExposureEur"])

    invites = [dict(id=f"inv-{s}", customerId="qss", supplierId=s, supplierName=SUP[s]["name"], contactEmail=SUP[s]["contact"]["email"],
                    sentAt=d, status="sent", plan="sponsored") for s, d in (("cha", "2026-09-29"), ("fdt", "2026-10-01"))]

    seed = dict(generatedAt="2026-10-05T07:00:00Z", asOf=iso(ASOF), companies=companies, relationships=rels, sites=sites, partners=partners,
                lanes=lanes, machines=machines, certifications=certs, kpis=[], energy=[], materials=[], shipments=[], emissionFactors=[],
                twins=[], requests=[], shares=[], uploads=uploads, settings=SETTINGS, parts=parts, programs=PROGRAMS, signals=SIGNALS, risks=risks,
                alerts=alerts, invites=invites)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False, indent=1, allow_nan=False)
        f.write("\n")

    print(f"wrote {os.path.relpath(OUT)}  ({os.path.getsize(OUT)/1024:.0f} KB)")
    print(f"{'cust':14}{'id':5}{'city':17}{'lvl':6}{'score':>6}{'dtls':>5}{'exposure':>12}  status  flex")
    for (cid, sid), a in sorted(ass.items(), key=lambda kv: (kv[0][0], -kv[1]["risk"]["score"])):
        r = a["risk"]
        print(f"{cid:14}{sid:5}{SUP[sid]['city']:17}{r['level']:6}{r['score']:>6}{str(r['daysToLineStop']):>5}{r['lineStopExposureEur']:>12,}  {r['dataStatus']:10}"
              f" tr {r['normalTransitDays']}->{r['expectedTransitDays']}/{r['worstCaseTransitDays']} cover {r['minCoverDays']} flex {r['flex']['canAbsorb']} {r['flex']['serviceLevel']}")
    for al in alerts: print(al["level"], al["status"], "|", al["title"], "|", al["lineStopExposureEur"])


if __name__ == "__main__":
    main()
