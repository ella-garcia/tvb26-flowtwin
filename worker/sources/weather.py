"""Merged weather source: SMN/CONAGUA for the first days where an SMN municipality is close, Open-Meteo for the rest.

Per sample point (company locations, as in open_meteo.py):
  days 1-SMN_DAYS   SMN municipal forecast of the nearest municipality within smn.MAX_MUNICIPALITY_KM (official, local);
                    Open-Meteo where no municipality is that close or SMN has no record for the day
  days SMN_DAYS+1-14  Open-Meteo
The merged daily series then goes through the same heavy-rain rule (open_meteo.rain_signals), so bands, landslide
corridors and wording are identical to the single sources. Ids are 'wx-<lat>_<lon>-<first day>' with source_id
'weather': stable across runs as long as the episode starts on the same day, and independent of which feed supplied it.

SMN is best effort: if its download fails the run uses Open-Meteo alone and says so in `summary` (no error); if
Open-Meteo fails the fetch raises (the caller records it and leaves the current signals alone).

SMN warnings (avisos) and tropical cyclone bulletins: the SMN web service documents only the municipal forecasts
(method 1, daily; method 3, 48 h hourly; https://smn.conagua.gob.mx/es/web-service-api, checked 2026-10-07). A CAP
alert feed is listed elsewhere (correo1.conagua.gob.mx/feedsmn/feedalert.aspx) but is not documented by SMN and did not
resolve when checked, so warnings and bulletins are not implemented.
"""
import httpx

from db import DB
from . import smn
from .open_meteo import OpenMeteoSource, rain_signals, sample_points

SMN_DAYS = 3   # forecast days taken from SMN where available (day 1 = first forecast day)


def merge_point(om: dict, smn_days: list[dict] | None) -> tuple[list, list, list, int]:
    """Open-Meteo series with the first SMN_DAYS days replaced by SMN values. Returns (precip, prob, gust, days from SMN)."""
    precip, prob, gust = list(om["precip"]), list(om["prob"] or [None] * len(om["dates"])), list(om["gust"] or [None] * len(om["dates"]))
    used = 0
    if smn_days:
        idx = {d: i for i, d in enumerate(om["dates"][:SMN_DAYS])}
        for rec in smn_days:
            i = idx.get(smn.day_of(rec))
            if i is None:
                continue
            precip[i], prob[i], gust[i] = float(rec["prec"]), float(rec["probprec"]), float(rec["raf"])
            used += 1
    return precip, prob, gust, used


class WeatherSource:
    name = "weather"
    source_id = "weather"
    marks_stale = True

    def __init__(self, db: DB | None = None, client: httpx.Client | None = None, companies: list[dict] | None = None,
                 smn_records: list[dict] | None = None, smn_client: httpx.Client | None = None):
        self._db, self._client, self._companies = db, client, companies
        self._smn_records, self._smn_client = smn_records, smn_client
        self.summary: dict = {}

    def _smn_municipalities(self):
        try:
            src = smn.SmnConaguaSource(client=self._smn_client or self._client, records=self._smn_records)
            return smn.municipalities(src._load()), None
        except Exception as e:  # noqa: BLE001 - SMN is optional: fall back to Open-Meteo for every day
            return [], f"{type(e).__name__}: {e}"[:300]

    def fetch(self) -> list[dict]:
        companies = self._companies if self._companies is not None else (self._db or DB()).select("companies")
        pts = sample_points(companies)
        series = OpenMeteoSource(client=self._client, companies=companies).daily(pts)   # raises: nothing to fall back on
        muns, smn_error = self._smn_municipalities()
        rows, smn_points = [], 0
        for pt, om in zip(pts, series):
            precip, prob, gust, used = merge_point(om, smn.nearest_days(muns, pt) if muns else None)
            smn_points += used > 0
            source = "SMN/CONAGUA (days 1–3) and Open-Meteo forecast" if used else "Open-Meteo forecast"
            rows += rain_signals(pt, om["dates"], precip, prob, gust, source=source, source_id=self.source_id, id_prefix="wx")
        self.summary = {"points": len(pts), "points_with_smn": smn_points, "smn_error": smn_error}
        return rows
