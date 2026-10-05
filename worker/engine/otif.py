"""Synthetic 12-week OTIF series (until real OTIF arrives through kpis). Same generator as the v0 seed."""
import random

from .geo import clamp, hash_seed


def otif_series(supplier_id, spec):
    a, b, kind = spec
    rng = random.Random(hash_seed(supplier_id, "otif"))
    out = []
    for w in range(12):
        t = w / 11
        if kind == "decline":
            v = a + (b - a) * (t ** 1.3)
        elif kind == "dip":
            v = a - 0.004 * t + (-0.03 if w >= 9 else 0) * ((w - 8) / 3 if w >= 9 else 0) * 1.0
        else:
            v = a
        out.append(round(clamp(v + rng.gauss(0, 0.004), 0.5, 0.999), 3))
    if kind == "dip":
        out[-1] = min(out[-1], 0.935)
    return out
