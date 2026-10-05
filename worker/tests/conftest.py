import json
import os

import pytest

from naming import to_snake

SEED = os.path.join(os.path.dirname(__file__), "..", "..", "app", "src", "data", "seed", "seed.json")


@pytest.fixture(scope="session")
def seed():
    with open(SEED, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def db_rows(seed):
    """seed.json inputs reshaped to DB rows (snake_case); `short` kept on signals so driver labels match the seed."""
    return dict(
        companies=seed["companies"],
        parts=[to_snake(p) for p in seed["parts"]],
        signals=[to_snake(s) for s in seed["signals"]],
        settings=to_snake(seed["settings"]),
        lanes=seed["lanes"], partners=seed["partners"], machines=seed["machines"],
    )
