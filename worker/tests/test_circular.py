"""Transport footprint: pallets, trucks, fill, truck-km, CO2e, expedite per short day, route km, estimated flag."""
import math

from engine.circular import DEFAULT_FACTOR, DEFAULT_UNITS_PER_PALLET, pallets_per_week, road_km, transport_footprint
from engine.geo import hav
from engine.profiles import static_profiles

QSS = dict(id="qss", lat=20.59, lon=-100.39)
CELAYA = dict(id="edl", lat=20.52, lon=-100.81)
SETTINGS = dict(pallets_per_truck=24, expedite_trips_per_short_day=1, expedite_fill_rate=0.3, milkrun_radius_km=120)


def part(usage, upp=None):
    return dict(daily_usage=usage, **({"units_per_pallet": upp} if upp else {}))


def test_pallets_per_week_is_five_days_of_usage_over_units_per_pallet():
    assert pallets_per_week([part(1000, 500)]) == 10.0
    assert pallets_per_week([part(1000, 500), part(2000, 1000)]) == 20.0


def test_a_missing_units_per_pallet_uses_the_default():
    assert DEFAULT_UNITS_PER_PALLET == 200
    assert pallets_per_week([part(400)]) == 400 * 5 / 200


def test_trucks_round_up_and_fill_follows():
    fp = transport_footprint(QSS, CELAYA, [part(1000, 100)], SETTINGS)       # 50 pallets -> 3 trucks of 24
    assert fp["palletsPerWeek"] == 50.0 and fp["trucksPerWeek"] == 3
    assert fp["fillRate"] == round(50 / 72, 3)
    exact = transport_footprint(QSS, CELAYA, [part(1000, 200 / 24 * 5 * 5)], SETTINGS)   # exactly 24 pallets
    assert exact["trucksPerWeek"] == 1 and exact["fillRate"] == 1.0


def test_at_least_one_truck_when_there_is_any_freight():
    fp = transport_footprint(QSS, CELAYA, [part(10, 1000)], SETTINGS)        # 0.05 pallet a week
    assert fp["trucksPerWeek"] == 1 and 0 < fp["fillRate"] < 0.01
    assert transport_footprint(QSS, CELAYA, [part(0, 1000)], SETTINGS)["trucksPerWeek"] == 0


def test_truck_km_is_a_round_trip_and_co2e_uses_the_factor():
    fp = transport_footprint(QSS, CELAYA, [part(1000, 100)], SETTINGS)
    km = hav(CELAYA["lat"], CELAYA["lon"], QSS["lat"], QSS["lon"]) * 1.3
    assert fp["roadKm"] == round(km, 1)
    assert math.isclose(fp["truckKmPerWeek"], 3 * km * 2, abs_tol=0.1)
    assert math.isclose(fp["co2ePerWeekKg"], fp["truckKmPerWeek"] * DEFAULT_FACTOR["value"], abs_tol=0.2)
    f2 = dict(DEFAULT_FACTOR, id="ef-test", version=7, value=2.0)
    fp2 = transport_footprint(QSS, CELAYA, [part(1000, 100)], SETTINGS, f2)
    assert math.isclose(fp2["co2ePerWeekKg"], fp2["truckKmPerWeek"] * 2.0, abs_tol=0.2)
    assert (fp2["factorId"], fp2["factorVersion"]) == ("ef-test", 7)


def test_expedite_per_short_day_is_round_trips_of_the_road_km():
    fp = transport_footprint(QSS, CELAYA, [part(1000, 100)], SETTINGS)
    assert math.isclose(fp["expediteKmPerShortDay"], 2 * fp["roadKm"], abs_tol=0.2)
    assert math.isclose(fp["expediteCo2ePerShortDayKg"], fp["expediteKmPerShortDay"] * 1.05, abs_tol=0.2)
    two = transport_footprint(QSS, CELAYA, [part(1000, 100)], dict(SETTINGS, expedite_trips_per_short_day=2))
    assert math.isclose(two["expediteKmPerShortDay"], 4 * fp["roadKm"], abs_tol=0.3)


def test_route_legs_are_summed_for_a_supplier_with_a_route():
    pfl = {**static_profiles()["pfl"], "id": "pfl", "lat": 27.53, "lon": -99.49}
    straight = hav(pfl["lat"], pfl["lon"], QSS["lat"], QSS["lon"])
    pts = [(pfl["lat"], pfl["lon"])] + [(l["lat"], l["lon"]) for l in pfl["route"]] + [(QSS["lat"], QSS["lon"])]
    legs = sum(hav(*a, *b) for a, b in zip(pts, pts[1:]))
    assert legs > straight                      # the route goes through Monterrey, not the straight line
    assert math.isclose(road_km(QSS, pfl), legs * 1.15)
    assert road_km(QSS, {k: v for k, v in pfl.items() if k != "route"}) == straight * 1.3


def test_footprint_is_always_estimated():
    # Modelled trucks and an estimated emission factor: never "measured", even with full pallet data.
    assert transport_footprint(QSS, CELAYA, [part(1000, 100), part(500)], SETTINGS)["provenance"] == "estimated"
    assert transport_footprint(QSS, CELAYA, [part(1000, 100), part(500, 50)], SETTINGS)["provenance"] == "estimated"


def test_footprint_has_exactly_the_contract_keys():
    fp = transport_footprint(QSS, CELAYA, [part(1000, 100)], SETTINGS)
    assert set(fp) == {"roadKm", "trucksPerWeek", "palletsPerWeek", "fillRate", "truckKmPerWeek", "co2ePerWeekKg",
                       "expediteKmPerShortDay", "expediteCo2ePerShortDayKg", "factorId", "factorVersion", "provenance"}


def test_the_seed_carries_the_engine_footprint(seed):
    qss = {r["supplierId"]: r["circular"] for r in seed["risks"] if r["customerId"] == "qss"}
    assert qss["pfl"]["roadKm"] > 800 and qss["pfl"]["provenance"] == "estimated"       # imports via Nuevo Laredo, default units on two parts
    assert all(c["factorId"] == "ef-road-artic" for c in qss.values())
