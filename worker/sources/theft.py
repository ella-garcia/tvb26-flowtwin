"""Cargo-theft corridor priors: standing, estimated signals from data/theft_corridors.json. No live feed.

Each table row is a corridor (highways, states, centre and radius), the weekdays and hour band when theft concentrates,
a modest hand-set transit multiplier (escorts, convoy waits, detours; not a loss probability) and the published figure
and source it rests on (`verified` false where the figure is second-hand or could not be confirmed).

For the next HORIZON_DAYS days, every run of consecutive risky weekdays becomes one `theft` signal (provenance
'estimated'), id 'theft-<row id>-<first day>': stable for the week, so past runs are marked inactive by the hourly
cycle (marks_stale) and new weeks appear as they enter the horizon. The engine works by day; the hour band is in the
text only. Theft signals slow road legs only (engine.projection.SIGNAL_LEGS).
"""
import json
import os
from datetime import date, datetime, timedelta, timezone

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "theft_corridors.json")
HORIZON_DAYS = 14
LOCAL = timezone(timedelta(hours=-6))
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def load_corridors(path: str = PATH) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)["corridors"]


def fmt_days(weekdays: list[int]) -> str:
    ws = sorted(set(weekdays))
    if len(ws) == 7:
        return "every day"
    if ws == list(range(ws[0], ws[-1] + 1)) and len(ws) > 2:
        return f"{DAY_NAMES[ws[0]]}–{DAY_NAMES[ws[-1]]}"
    return ", ".join(DAY_NAMES[w] for w in ws)


def fmt_hours(h: list[int]) -> str:
    return f"{h[0]:02d}:00–{h[1] % 24:02d}:00"


def runs(today: date, weekdays: list[int], horizon: int = HORIZON_DAYS) -> list[tuple[date, date]]:
    """(first, last) of each run of consecutive days in the horizon whose weekday is in `weekdays`."""
    days = [today + timedelta(days=i) for i in range(horizon)]
    out, start = [], None
    for d in days:
        if d.weekday() in weekdays:
            start = start or d
            last = d
        elif start:
            out.append((start, last))
            start = None
    if start:
        out.append((start, last))
    return out


def corridor_signals(row: dict, today: date) -> list[dict]:
    hw = ", ".join(row["highways"])
    when = f"{fmt_days(row['weekdays'])}, {fmt_hours(row['hours'])}"
    desc = (f"Standing cargo-theft prior for {row['corridor']} ({hw}): theft concentrates {when}. {row['figure']} "
            f"Source: {row['source']}{'' if row['verified'] else ' (figure not verified)'}. Not a live report; the transit "
            f"effect (escorts, convoy waits, detours) is a hand-set estimate.")
    return [dict(
        id=f"theft-{row['id']}-{a.isoformat()}", kind="theft", title=f"Cargo theft risk on {hw}, {when}",
        short_label=f"Theft risk, {hw}", description=desc, state=" / ".join(row["states"]), lat=row["lat"], lon=row["lon"],
        radius_km=row["radius_km"], highways=list(row["highways"]), starts_at=a.isoformat(), ends_at=b.isoformat(),
        severity=row["severity"], transit_multiplier=row["multiplier"], source="Cargo-theft corridor priors", provenance="estimated",
        source_id="theft", external_ref=f"{row['id']}:{a.isoformat()}", active=True)
        for a, b in runs(today, row["weekdays"])]


class TheftSource:
    name = "theft"
    source_id = "theft"
    marks_stale = True

    def __init__(self, path: str | None = None, today: date | None = None):
        self.path, self._today = path or PATH, today
        self.summary: dict = {}

    def fetch(self) -> list[dict]:
        today = self._today or datetime.now(LOCAL).date()
        rows = []
        corridors = load_corridors(self.path)
        for row in corridors:
            rows += corridor_signals(row, today)
        self.summary = {"corridors": len(corridors), "signals": len(rows)}
        return rows
