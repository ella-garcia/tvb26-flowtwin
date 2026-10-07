"""Transport footprint of one (key customer, supplier) pair: road km, trucks, pallets, fill, truck-km and kg CO2e.

Pure functions on DB-shaped dicts (snake_case top level; the returned block uses camelCase keys, like `risks.flex`).
Everything here is a model, so the result is a physical-unit ESTIMATE that never touches the risk score or level:

  pallets/week   = sum over parts of daily_usage x 5 / units_per_pallet   (5 delivery days a week)
  trucks/week    = ceil(pallets / pallets_per_truck), at least 1 when there are pallets
  fill           = pallets / (trucks x pallets_per_truck)
  truck-km/week  = trucks x road km x 2                                   (round trip: the truck comes back)
  kg CO2e/week   = truck-km x emission factor (kg CO2e per vehicle-km)
  expedite       = expedite_trips_per_short_day x 2 x road km per line-down day; each expedite is one extra truck trip
                   that goes there and back (it often returns empty), so its CO2e uses the same per-km factor.
                   The app multiplies it by the short days a scenario avoids: "resilience pays twice".

Road km: the sum of the supplier's route legs when it has a route with coordinates (the supplier, each leg point, then the
customer, x 1.15 for the road being longer than the straight line between those points), otherwise the straight line to the
customer x 1.3 (the same road factor `projection.project` uses for normal transit).

Provenance is 'estimated' unless every part has `units_per_pallet`. Parts without it use DEFAULT_UNITS_PER_PALLET.
"""
import math

from .geo import hav

DEFAULT_UNITS_PER_PALLET = 200  # used (and the footprint marked estimated) when a part has no units_per_pallet
WORKING_DAYS_PER_WEEK = 5
ROAD_FACTOR = 1.3               # road km ~ 1.3 x straight line (same as projection.project)
ROUTE_ROAD_FACTOR = 1.15        # a route's waypoints already follow the corridor, so less detour is left to add

DEFAULT_FACTOR = dict(
    id="ef-road-artic", version=1, name="Road freight, articulated truck (diesel)", value=1.05, unit="kg CO2e/vehicle-km",
    scope=3, source="Estimate: about 33 L diesel per 100 km × 3.17 kg CO2e/L well-to-wheel; confirm against GLEC Framework v3",
    year=2026)

DEFAULT_PALLETS_PER_TRUCK = 24
DEFAULT_EXPEDITE_TRIPS_PER_SHORT_DAY = 1


def _units_per_pallet(part):
    u = part.get("units_per_pallet")
    return float(u) if u else float(DEFAULT_UNITS_PER_PALLET)


def pallets_per_week(parts):
    """Pallets a supplier ships to the customer in a week."""
    return sum(float(p.get("daily_usage") or 0) * WORKING_DAYS_PER_WEEK / _units_per_pallet(p) for p in parts)


def road_km(customer, supplier):
    """One-way road km supplier -> customer (see module docstring)."""
    route = supplier.get("route")
    if route and all(leg.get("lat") is not None and leg.get("lon") is not None for leg in route):
        pts = [(supplier["lat"], supplier["lon"])] + [(leg["lat"], leg["lon"]) for leg in route] + [(customer["lat"], customer["lon"])]
        return sum(hav(a[0], a[1], b[0], b[1]) for a, b in zip(pts, pts[1:])) * ROUTE_ROAD_FACTOR
    return hav(supplier["lat"], supplier["lon"], customer["lat"], customer["lon"]) * ROAD_FACTOR


def transport_footprint(customer, supplier, parts, settings, factor=None):
    """The `risks.circular` block for one pair. factor: an emission_factors row (id, version, value); default DEFAULT_FACTOR."""
    factor = factor or DEFAULT_FACTOR
    cap = float(settings.get("pallets_per_truck") or DEFAULT_PALLETS_PER_TRUCK)
    exp_trips = float(settings.get("expedite_trips_per_short_day", DEFAULT_EXPEDITE_TRIPS_PER_SHORT_DAY))
    value = float(factor["value"])
    pallets = pallets_per_week(parts)
    trucks = max(1, math.ceil(pallets / cap - 1e-9)) if pallets > 0 else 0
    km = road_km(customer, supplier)
    truck_km = trucks * km * 2
    exp_km = exp_trips * 2 * km
    return dict(roadKm=round(km, 1), trucksPerWeek=trucks, palletsPerWeek=round(pallets, 1),
                fillRate=round(pallets / (trucks * cap), 3) if trucks else 0.0,
                truckKmPerWeek=round(truck_km, 1), co2ePerWeekKg=round(truck_km * value, 1),
                expediteKmPerShortDay=round(exp_km, 1), expediteCo2ePerShortDayKg=round(exp_km * value, 1),
                factorId=factor["id"], factorVersion=int(factor["version"]),
                # Always estimated: the trucks are modelled from demand and the CO2e factor is an estimate,
                # even when every part has its own units per pallet.
                provenance="estimated")
