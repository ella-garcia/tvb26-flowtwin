import gzip
import json

import httpx

from sources import SmnConaguaSource
from sources.smn import parse_payload

COMPANIES = [{"id": "hmo", "city": "Orizaba", "state": "Veracruz", "lat": 18.85, "lon": -97.10}]


def rec(idmun, lat, lon, ndia, prec):
    return dict(ides="30", idmun=str(idmun), lat=str(lat), lon=str(lon), ndia=str(ndia), dloc=f"202610{5 + ndia:02d}T00",
                prec=str(prec), probprec="90", raf="30", nes="Veracruz", nmun="Orizaba")


def test_parse_handles_gzip_and_plain():
    data = [rec(1, 18.8, -97.1, 0, 3)]
    assert parse_payload(gzip.compress(json.dumps(data).encode())) == data
    assert parse_payload(json.dumps(data).encode()) == data


def test_nearest_municipality_drives_signal():
    recs = [rec(1, 18.85, -97.10, d, 30) for d in range(4)] + [rec(2, 20.5, -100.8, d, 90) for d in range(4)]
    (s,) = SmnConaguaSource(records=recs, companies=COMPANIES).fetch()
    assert s["source_id"] == "smn" and s["id"].startswith("smn-") and s["transit_multiplier"] == 2.6 and s["highways"] == ["MEX-150D"]
    assert s["starts_at"] == "2026-10-05" and s["ends_at"] == "2026-10-08"


def test_no_municipality_in_range_or_dry_forecast_gives_nothing():
    assert SmnConaguaSource(records=[rec(2, 20.5, -100.8, 0, 90)], companies=COMPANIES).fetch() == []
    assert SmnConaguaSource(records=[rec(1, 18.85, -97.1, d, 2) for d in range(4)], companies=COMPANIES).fetch() == []


def test_downloads_method_1_from_mock():
    body = gzip.compress(json.dumps([rec(1, 18.85, -97.10, d, 40) for d in range(4)]).encode())
    seen = []

    def handler(req):
        seen.append(str(req.url))
        return httpx.Response(200, content=body)

    src = SmnConaguaSource(client=httpx.Client(transport=httpx.MockTransport(handler)), companies=COMPANIES)
    assert len(src.fetch()) == 1 and "method=1" in seen[0]
