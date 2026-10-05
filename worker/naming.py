"""camelCase (seed.json, app) <-> snake_case (DB columns, engine) key helpers. Stdlib only."""
import re


def camel(s):
    head, *rest = s.split("_")
    return head + "".join(p.title() for p in rest)


def snake(s):
    return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()


def to_camel(row):
    return {camel(k): v for k, v in row.items()}


def to_snake(row):
    return {snake(k): v for k, v in row.items()}
