"""Open-Meteo mapping, stale marking and the file source's new columns. No network: httpx.MockTransport + a fake DB."""
from datetime import date, timedelta

import httpx

from sources import FileSignalSource, OpenMeteoSource, mark_stale
from sources import open_meteo as om


class FakeDB:
    """In-memory stand-in for db.DB: eq./in./neq filters only, auto ids for insert."""

    def __init__(self, **tables):
        self.t = {k: [dict(r) for r in v] for k, v in tables.items()}
        self.log = []
        self.n = 0

    @staticmethod
    def _match(row, params):
        for k, v in (params or {}).items():
            if k in ("select", "order", "limit"):
                continue
            v = str(v)
            if v.startswith("eq."):
                if str(row.get(k)).lower() != v[3:].lower():
                    return False
            elif v.startswith("in."):
                if str(row.get(k)) not in v[4:-1].split(","):
                    return False
        return True

    def select(self, table, params=None):
        return [dict(r) for r in self.t.get(table, []) if self._match(r, params)]

    def insert(self, table, rows):
        out = []
        for r in rows:
            self.n += 1
            r = {"id": self.n, **r}
            self.t.setdefault(table, []).append(r)
            out.append(dict(r))
        return out

    def upsert(self, table, rows, on_conflict):
        keys = on_conflict.split(",")
        for r in rows:
            for e in self.t.setdefault(table, []):
                if all(e.get(k) == r.get(k) for k in keys):
                    e.update(r)
                    break
            else:
                self.t[table].append(dict(r))

    def update(self, table, match, values):
        out = []
        for r in self.t.get(table, []):
            if self._match(r, {k: (v if str(v).startswith(("eq.", "in.")) else f"eq.{v}") for k, v in match.items()}):
                r.update(values)
                out.append(dict(r))
        self.log.append((table, match, values))
        return out


def days(n=14, start=date(2026, 10, 5)):
    return [start + timedelta(days=i) for i in range(n)]


def rain(*pairs, n=14):
    """rain((2, 30), (3, 45)) -> daily mm list with those day-index values."""
    out = [0.0] * n
    for i, v in pairs:
        out[i] = v
    return out


POINT = dict(name="Orizaba", state="Veracruz", lat=18.85, lon=-97.10)
FLAT = dict(name="Celaya", state="Guanajuato", lat=20.52, lon=-100.81)


def sigs(point, precip):
    return om.rain_signals(point, days(), precip, None, None, source="Open-Meteo forecast", source_id="open-meteo", id_prefix="om")


def test_three_heavy_days_make_a_signal_with_band():
    (s,) = sigs(FLAT, rain((3, 26), (4, 30), (5, 28)))
    assert (s["severity"], s["transit_multiplier"]) == ("medium", 1.3)
    assert (s["starts_at"], s["ends_at"]) == ("2026-10-08", "2026-10-10")
    assert s["title"] == "Heavy rain forecast near Celaya, 8–10 Oct"
    assert s["provenance"] == "measured" and s["radius_km"] == 40 and s["state"] == "Guanajuato"
    assert s["source_id"] == "open-meteo" and s["external_ref"] == "20.52_-100.81:2026-10-08" and s["active"] is True


def test_bands_by_peak_daily_rain():
    assert sigs(FLAT, rain((0, 41), (1, 30), (2, 30)))[0]["transit_multiplier"] == 1.8
    assert sigs(FLAT, rain((0, 41), (1, 30), (2, 30)))[0]["severity"] == "high"
    assert sigs(FLAT, rain((0, 39.9), (1, 25), (2, 25)))[0]["transit_multiplier"] == 1.3


def test_single_extreme_day_is_a_signal_two_moderate_days_are_not():
    (s,) = sigs(FLAT, rain((6, 62)))
    assert s["transit_multiplier"] == 2.6 and s["starts_at"] == s["ends_at"] == "2026-10-11"
    assert sigs(FLAT, rain((0, 30), (1, 35))) == []      # only 2 days
    assert sigs(FLAT, rain((0, 30), (2, 30), (4, 30))) == []   # not consecutive
    assert sigs(FLAT, rain((0, 24.9), (1, 24.9), (2, 24.9))) == []


def test_landslide_corridor_gets_top_multiplier_and_highway():
    (s,) = sigs(POINT, rain((0, 26), (1, 26), (2, 26)))
    assert s["transit_multiplier"] == 2.6 and s["severity"] == "high" and s["highways"] == ["MEX-150D"]


def test_two_separate_episodes_have_distinct_stable_ids():
    a = sigs(FLAT, rain((0, 30), (1, 30), (2, 30), (8, 70)))
    assert len(a) == 2 and len({s["id"] for s in a}) == 2
    assert a == sigs(FLAT, rain((0, 30), (1, 30), (2, 30), (8, 70)))


def forecast_payload(latitudes, precip_by_index):
    out = []
    for i, _ in enumerate(latitudes):
        t = [d.isoformat() for d in days()]
        out.append({"daily": {"time": t, "precipitation_sum": precip_by_index.get(i, [0.0] * 14),
                              "precipitation_probability_max": [90] * 14, "wind_gusts_10m_max": [40] * 14}})
    return out if len(out) > 1 else out[0]


COMPANIES = [
    {"id": "hmo", "city": "Orizaba", "state": "Veracruz", "lat": 18.85, "lon": -97.10, "kind": "supplier"},
    {"id": "edl", "city": "Celaya", "state": "Guanajuato", "lat": 20.52, "lon": -100.81, "kind": "supplier"},
    {"id": "tsr", "city": "Celaya", "state": "Guanajuato", "lat": 20.52, "lon": -100.81, "kind": "supplier"},  # same place
    {"id": "qss", "city": "Hermosillo", "state": "Sonora", "lat": 29.07, "lon": -110.96, "kind": "customer"},
]


def make_source(precip_by_index, seen=None):
    def handler(req: httpx.Request):
        lats = req.url.params["latitude"].split(",")
        if seen is not None:
            seen.append(dict(req.url.params))
        return httpx.Response(200, json=forecast_payload(lats, precip_by_index))
    return OpenMeteoSource(client=httpx.Client(transport=httpx.MockTransport(handler)), companies=COMPANIES)


def test_fetch_batches_points_and_dedupes_shared_locations():
    seen = []
    rows = make_source({0: rain((0, 30), (1, 30), (2, 30))}, seen).fetch()
    assert len(seen) == 1 and len(seen[0]["latitude"].split(",")) == 3          # 4 companies, 3 distinct places
    assert seen[0]["timezone"] == "America/Mexico_City" and seen[0]["forecast_days"] == "14"
    assert "wind_gusts_10m_max" in seen[0]["daily"]
    assert len(rows) == 1 and rows[0]["title"].startswith("Heavy rain forecast near")


def test_fetch_http_error_raises_for_caller_to_record():
    src = OpenMeteoSource(client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))), companies=COMPANIES)
    try:
        src.fetch()
        raise AssertionError("expected an error")
    except httpx.HTTPStatusError:
        pass


def test_mark_stale_deactivates_missing_open_meteo_signals_only():
    db = FakeDB(signals=[
        {"id": "om-a", "source_id": "open-meteo", "active": True},
        {"id": "om-b", "source_id": "open-meteo", "active": True},
        {"id": "sig-x", "source_id": "file", "active": True},
        {"id": "om-old", "source_id": "open-meteo", "active": False},
    ])
    assert mark_stale(db, "open-meteo", {"om-a"}) == 1
    active = {r["id"]: r["active"] for r in db.t["signals"]}
    assert active == {"om-a": True, "om-b": False, "sig-x": True, "om-old": False}
    assert len(db.t["signals"]) == 4          # nothing deleted


def test_rerun_upserts_instead_of_duplicating():
    db = FakeDB(signals=[])
    rows = make_source({0: rain((0, 30), (1, 30), (2, 30))}).fetch()
    db.upsert("signals", rows, "id")
    db.upsert("signals", make_source({0: rain((0, 30), (1, 30), (2, 30))}).fetch(), "id")
    assert len(db.t["signals"]) == 1


def test_file_source_carries_new_columns():
    rows = FileSignalSource().fetch()
    r = next(x for x in rows if x["id"] == "sig-rain-veracruz")
    assert r["short_label"] == "Rainy season" and r["source_id"] == "file" and r["external_ref"] == r["id"] and r["active"] is True
