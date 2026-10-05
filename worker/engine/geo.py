"""Small shared helpers (distance, clamp, deterministic seeds). Ported from data-gen/generate_seed.py."""
import math


def hav(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def hash_seed(*a):
    """Deterministic (process independent) seed, identical to the v0 seed generator."""
    return sum(ord(c) * (i + 7) for i, c in enumerate("|".join(a))) + 1000003


def pct(sorted_vals, p):
    return sorted_vals[min(len(sorted_vals) - 1, int(p * len(sorted_vals)))]
