"""WP1 live sources: merged weather, TomTom incidents, CBP border waits, theft priors. Fixtures + MockTransport, no network."""
import json
import os
from datetime import date, datetime, timezone

import httpx
import pytest

import scheduled
from engine.projection import hit_legs
from sources import CbpSource, TheftSource, TomTomSource, WeatherSource, get_source
from sources import cbp, theft, tomtom
from sources.corridors import border_legs, load_profiles
from tests.test_sources import FakeDB, days, forecast_payload, rain
from tests.test_sources_smn import rec

FIX = os.path.join(os.path.dirname(__file__), "fixtures")
NOW = datetime(2026, 10, 7, 20, 0, tzinfo=timezone.utc)


def fixture(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return json.load(f)


COMPANIES = [
    {"id": "hmo", "city": "Orizaba", "state": "Veracruz", "lat": 18.85, "lon": -97.10, "kind": "supplier"},
    {"id": "edl", "city": "Celaya", "state": "Guanajuato", "lat": 20.52, "lon": -100.81, "kind": "supplier"},
    {"id": "tsr", "city": "Monterrey", "state": "Nuevo León", "lat": 25.67, "lon": -100.31, "kind": "supplier"},
    {"id": "qss", "city": "Querétaro", "state": "Querétaro", "lat": 20.59, "lon": -100.39, "kind": "customer"},
]
PROFILES = load_profiles(None)     # data/supplier_profiles.json: pfl crosses at Nuevo Laredo


# ---- weather (SMN days 1-3 + Open-Meteo days 4-14) ------------------------------------------------------------

def weather_client(om_precip_by_index, smn_records, seen=None, smn_status=200):
    def handler(req: httpx.Request):
        if seen is not None:
            seen.append(req.url.host)
        if req.url.host == "smn.conagua.gob.mx":
            return httpx.Response(smn_status, content=json.dumps(smn_records).encode())
        return httpx.Response(200, json=forecast_payload(req.url.params["latitude"].split(","), om_precip_by_index))
    return httpx.Client(transport=httpx.MockTransport(handler))


ORIZ = [{"id": "hmo", "city": "Orizaba", "state": "Veracruz", "lat": 18.85, "lon": -97.10},
        {"id": "edl", "city": "Celaya", "state": "Guanajuato", "lat": 20.52, "lon": -100.81}]


def test_weather_takes_smn_for_first_three_days_and_open_meteo_after():
    # Open-Meteo is dry on days 1-3 at Orizaba; SMN says 30 mm on each: the merged series has the episode.
    smn = [rec(1, 18.85, -97.10, d, 30) for d in range(4)]
    om = {0: rain((10, 70))}                                    # and an extreme day 11 at Celaya (point 0)
    rows = WeatherSource(client=weather_client(om, smn), companies=ORIZ).fetch()
    by_start = {r["starts_at"]: r for r in rows}
    assert set(by_start) == {"2026-10-05", "2026-10-15"}
    first = by_start["2026-10-05"]
    assert first["ends_at"] == "2026-10-07"                     # day 4 (SMN ndia 3) is not used: Open-Meteo is dry there
    assert first["source"].startswith("SMN/CONAGUA") and first["source_id"] == "weather" and first["id"].startswith("wx-")
    assert first["highways"] == ["MEX-150D"]                    # landslide corridor rule still applies


def test_weather_without_nearby_municipality_is_open_meteo_only():
    smn = [rec(1, 25.0, -105.0, d, 90) for d in range(4)]       # far from both points
    rows = WeatherSource(client=weather_client({0: rain((0, 30), (1, 30), (2, 30))}, smn), companies=ORIZ).fetch()
    (s,) = rows
    assert s["source"] == "Open-Meteo forecast" and s["state"] == "Guanajuato"


def test_weather_falls_back_when_smn_fails_and_ids_are_stable():
    om = {0: rain((0, 30), (1, 30), (2, 30))}   # point 0 = Celaya (points sort by company id)
    src = WeatherSource(client=weather_client(om, [], smn_status=503), companies=ORIZ)
    a = src.fetch()
    assert len(a) == 1 and src.summary["smn_error"] and "503" in src.summary["smn_error"]
    b = WeatherSource(client=weather_client(om, []), companies=ORIZ).fetch()
    assert [r["id"] for r in a] == [r["id"] for r in b] == ["wx-20.52_-100.81-2026-10-05"]


def test_weather_open_meteo_failure_raises():
    def handler(req):
        return httpx.Response(500)
    with pytest.raises(httpx.HTTPStatusError):
        WeatherSource(client=httpx.Client(transport=httpx.MockTransport(handler)), companies=ORIZ, smn_records=[]).fetch()


def test_old_source_names_still_resolve():
    assert get_source("open-meteo").source_id == "open-meteo" and get_source("smn").source_id == "smn"
    assert get_source("weather").source_id == "weather"


# ---- TomTom ---------------------------------------------------------------------------------------------------

def tomtom_source(seen=None, body=None, status=200, key="test-key"):
    def handler(req: httpx.Request):
        if seen is not None:
            seen.append(dict(req.url.params))
        return httpx.Response(status, json=body if body is not None else fixture("tomtom_incidents.json"))
    return TomTomSource(client=httpx.Client(transport=httpx.MockTransport(handler)), companies=COMPANIES,
                        profiles=PROFILES, api_key=key, now=NOW)


def test_parse_highways():
    assert tomtom.parse_highways(["MEX-57D", "57D", "Fed. 85D", "MEX 150D", "I-35", "Carretera Federal 45", "GTO 45", "Av. Juárez"]) == \
        ["MEX-57D", "MEX-85D", "MEX-150D", "I-35", "MEX-45"]


def test_boxes_respect_tomtom_area_limit():
    pts = [{"lat": c["lat"], "lon": c["lon"]} for c in COMPANIES]
    for min_lon, min_lat, max_lon, max_lat in tomtom.boxes(pts):
        from engine.geo import hav
        w = hav(min_lat, min_lon, min_lat, max_lon)
        h = hav(min_lat, min_lon, max_lat, min_lon)
        assert w * h < 10_000


def test_tomtom_maps_closures_blockades_and_drops_the_rest():
    seen = []
    src = tomtom_source(seen)
    rows = {r["external_ref"]: r for r in src.fetch()}
    assert set(rows) == {"1b8a3c7e5f6d4a2b9c0e1f2a3b4c5d6e", "8e2f0a9d-77c1-4e5b-a3f6-0c2d4b9e1a77", "TTI-55f0e1c2-flood"}
    closure = rows["1b8a3c7e5f6d4a2b9c0e1f2a3b4c5d6e"]
    assert closure["kind"] == "road" and closure["highways"] == ["MEX-57D"] and closure["transit_multiplier"] == 1.6
    assert closure["starts_at"] == "2026-10-07" and closure["ends_at"] == "2026-10-08" and closure["provenance"] == "measured"
    assert closure["id"] == "tt-1b8a3c7e5f6d4a2b9c0e1f2a3b4c5d6e" and closure["source_id"] == "tomtom"
    block = rows["8e2f0a9d-77c1-4e5b-a3f6-0c2d4b9e1a77"]
    assert block["kind"] == "blockade" and block["highways"] == ["MEX-150D"] and block["transit_multiplier"] == 2.0
    assert "assumed 24 h" in block["description"] and block["state"] == "Veracruz"
    flood = rows["TTI-55f0e1c2-flood"]
    assert flood["kind"] == "road" and flood["highways"] == ["MEX-85D"] and flood["transit_multiplier"] == 2.0
    assert src.summary["mode"] == "live" and len(seen) == src.summary["boxes"]
    p = seen[0]
    assert p["key"] == "test-key" and p["timeValidityFilter"] == "present,future" and "roadNumbers" in p["fields"]
    assert len(p["bbox"].split(",")) == 4


def test_tomtom_dry_run_without_key_makes_no_request(monkeypatch):
    monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
    seen = []
    src = TomTomSource(client=httpx.Client(transport=httpx.MockTransport(lambda r: seen.append(r) or httpx.Response(500))),
                       companies=COMPANIES, profiles=PROFILES)
    assert src.fetch() == [] and seen == [] and src.summary["mode"] == "dry-run" and src.marks_stale is False


def test_tomtom_error_never_leaks_the_key():
    with pytest.raises(RuntimeError) as e:
        tomtom_source(status=403, key="secret-123").fetch()
    assert "403" in str(e.value) and "secret-123" not in str(e.value)


def test_tomtom_ids_stable_and_incident_in_two_boxes_counted_once():
    a = tomtom_source().fetch()
    b = tomtom_source().fetch()
    assert [r["id"] for r in a] == [r["id"] for r in b] and len({r["id"] for r in a}) == len(a)


def test_tomtom_multiplier_table_by_duration():
    assert tomtom.multiplier_for("closure", 3) == 1.3 and tomtom.multiplier_for("closure", 30) == 1.6
    assert tomtom.multiplier_for("blockade", 72) == 2.5
    assert tomtom.classify({"iconCategory": 7, "magnitudeOfDelay": 1}) is None
    assert tomtom.classify({"iconCategory": 3, "events": [{"description": "Bloqueo de transportistas"}]}) == "blockade"


# ---- CBP ------------------------------------------------------------------------------------------------------

def cbp_source(body=None, seen=None):
    def handler(req):
        if seen is not None:
            seen.append(str(req.url))
        return httpx.Response(200, json=body if body is not None else fixture("cbp_waittimes.json"))
    return CbpSource(client=httpx.Client(transport=httpx.MockTransport(handler)), profiles=PROFILES)


def test_cbp_wait_over_threshold_is_a_customs_signal_on_the_border_leg_only():
    seen = []
    (s,) = cbp_source(seen=seen).fetch()
    assert seen == ["https://bwt.cbp.gov/api/waittimes"]
    assert s["id"] == "cbp-nuevo-laredo" and s["kind"] == "customs" and s["provenance"] == "measured"
    assert s["transit_multiplier"] == 1.8 and s["severity"] == "high" and s["starts_at"] == s["ends_at"] == "2026-10-07"
    assert "3 h 5 min" in s["title"] and "World Trade Bridge" in s["title"] and "US side only" in s["description"]
    pfl = next(p for p in PROFILES if p["supplier_id"] == "pfl")
    assert [leg["kind"] for leg in hit_legs({"lat": 27.53, "lon": -99.49, "route": pfl["route"]}, s)] == ["border"]


def test_cbp_below_threshold_or_no_reading_gives_nothing():
    body = fixture("cbp_waittimes.json")
    for p in body:
        if p["port_number"] == "230404":
            p["commercial_vehicle_lanes"]["standard_lanes"]["delay_minutes"] = "40"
    assert cbp_source(body).fetch() == []
    for p in body:   # no reading at WTB: the next listed crossing (Colombia, 45 min) is used
        if p["port_number"] == "230404":
            p["commercial_vehicle_lanes"]["standard_lanes"]["delay_minutes"] = ""
        if p["port_number"] == "230403":
            p["commercial_vehicle_lanes"]["standard_lanes"]["delay_minutes"] = "260"
    (s,) = cbp_source(body).fetch()
    assert "Colombia" in s["title"] and s["transit_multiplier"] == 2.5 and s["id"] == "cbp-nuevo-laredo"


def test_cbp_no_border_route_makes_no_request():
    seen = []
    src = CbpSource(client=httpx.Client(transport=httpx.MockTransport(lambda r: seen.append(r) or httpx.Response(500))),
                    profiles=[{"supplier_id": "edl", "highways": ["MEX-45D"], "route": []}])
    assert src.fetch() == [] and seen == []


def test_cbp_port_lookup_ignores_accents_and_case():
    assert cbp.crossings_for("Ciudad Juárez")[0][0] == "240203"
    assert cbp.crossings_for("NUEVO LAREDO")[0][0] == "230404"
    assert border_legs(PROFILES)[0]["place"] == "Nuevo Laredo"


# ---- theft ----------------------------------------------------------------------------------------------------

def test_theft_weekday_runs_become_estimated_signals():
    rows = TheftSource(today=date(2026, 10, 7)).fetch()           # a Wednesday
    puebla = [r for r in rows if r["id"].startswith("theft-mex150d-puebla-")]
    assert [(r["starts_at"], r["ends_at"]) for r in puebla] == [("2026-10-07", "2026-10-09"), ("2026-10-12", "2026-10-16"),
                                                                 ("2026-10-19", "2026-10-20")]
    r = puebla[0]
    assert r["kind"] == "theft" and r["provenance"] == "estimated" and r["highways"] == ["MEX-150D"] and r["transit_multiplier"] == 1.15
    assert "Mon–Fri, 18:00–06:00" in r["title"] and "over-haul" not in r["description"] and "Overhaul" in r["description"]
    every_day = [r for r in rows if r["id"].startswith("theft-mex85d-")]
    assert len(every_day) == 1 and every_day[0]["ends_at"] == "2026-10-20"
    assert TheftSource.marks_stale is True


def test_theft_table_is_modest_and_cited():
    for row in theft.load_corridors():
        assert 1.0 < row["multiplier"] <= 1.2 and row["source"] and row["source_url"].startswith("https://")
        assert isinstance(row["verified"], bool) and set(row["weekdays"]) <= set(range(7))
    assert "(figure not verified)" in theft.corridor_signals(theft.load_corridors()[1], date(2026, 10, 7))[0]["description"]


def test_theft_ids_stable_within_the_week():
    a = {r["id"] for r in TheftSource(today=date(2026, 10, 12)).fetch()}
    b = {r["id"] for r in TheftSource(today=date(2026, 10, 12)).fetch()}
    assert a == b and "theft-mex57d-mexico-queretaro-2026-10-12" in a


# ---- the hourly cycle with every live source on fixtures ------------------------------------------------------

def test_hourly_ingest_creates_road_customs_and_theft_signals_and_retires_vanished_ones(monkeypatch):
    db = FakeDB(signals=[{"id": "tt-old", "source_id": "tomtom", "active": True},
                         {"id": "cbp-old", "source_id": "cbp", "active": True}])
    srcs = {"tomtom": tomtom_source(), "cbp": cbp_source(), "theft": TheftSource(today=date(2026, 10, 7))}
    monkeypatch.setattr(scheduled, "get_source", lambda name, payload, db: srcs[name])
    out = scheduled.ingest_signals(db, ["tomtom", "cbp", "theft"], [])
    counts = {k: {f: v[f] for f in ("upserted", "marked_inactive")} for k, v in out.items()}
    assert counts["tomtom"] == {"upserted": 3, "marked_inactive": 1} and counts["cbp"] == {"upserted": 1, "marked_inactive": 1}
    assert out["tomtom"]["status"]["mode"] == "live"
    kinds = {r["kind"] for r in db.t["signals"] if r.get("active")}
    assert {"road", "blockade", "customs", "theft"} <= kinds
    n = len(db.t["signals"])
    scheduled.ingest_signals(db, ["tomtom", "cbp", "theft"], [])     # same fixtures again: no duplicates
    assert len(db.t["signals"]) == n
