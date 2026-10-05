"""Stub for the real Mexican public feeds. Not implemented: raises so a job fails visibly instead of silently doing nothing.

TODO (real feed):
- SMN (Servicio Meteorologico Nacional) publishes tropical-cyclone bulletins, daily forecasts and warning maps
  (smn.conagua.gob.mx). Parse the bulletin/CAP alerts -> one signal per affected state/region, kind 'weather',
  centre lat/lon + radius from the warning polygon, starts_at/ends_at from the validity window.
- CONAGUA seasonal outlooks / reservoir and rain data for slower-moving signals (rainy-season landslide risk).
- Map severity (aviso color: verde/amarillo/naranja/rojo -> low/medium/high) and a transit_multiplier. The multiplier
  needs calibration against carrier transit-time data; the v0 values are hand-set.
- Keep ids stable per event (e.g. 'smn-<bulletin id>-<state>') so upserts update rather than duplicate; end-date
  expired signals instead of deleting them. Set provenance 'measured', source 'SMN/CONAGUA <bulletin url>'.
- Road/blockade/theft/port signals need other feeds (Capufe/SCT, carrier reports, API Manzanillo); not SMN.
"""


class SmnConaguaSource:
    name = "smn-conagua"

    def fetch(self) -> list[dict]:
        raise NotImplementedError("SMN/CONAGUA feed is not implemented yet; see TODO notes in worker/sources/smn.py")
