import json
import os

import pytest

SEED = os.path.join(os.path.dirname(__file__), "..", "..", "app", "src", "data", "seed", "seed.json")

PART_MAP = dict(supplierId="supplier_id", customerId="customer_id", unitCostMxn="unit_cost_mxn", dailyUsage="daily_usage",
                onHand="on_hand", daysOfCover="days_of_cover", singleSource="single_source")
SIG_MAP = dict(radiusKm="radius_km", startsAt="starts_at", endsAt="ends_at", transitMultiplier="transit_multiplier")


def rename(row, mapping):
    return {mapping.get(k, k): v for k, v in row.items()}


@pytest.fixture(scope="session")
def seed():
    with open(SEED, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def db_rows(seed):
    """seed.json inputs reshaped to DB rows (snake_case); `short` kept on signals so driver labels match the seed."""
    return dict(
        companies=seed["companies"],
        parts=[rename(p, PART_MAP) for p in seed["parts"]],
        signals=[rename(s, SIG_MAP) for s in seed["signals"]],
        settings=dict(line_stop_cost_eur_per_minute=seed["settings"]["lineStopCostEurPerMinute"],
                      contract_demand_swing=seed["settings"]["contractDemandSwing"],
                      line_hours_per_day=seed["settings"]["lineHoursPerDay"]),
        lanes=seed["lanes"], partners=seed["partners"], machines=seed["machines"],
    )
