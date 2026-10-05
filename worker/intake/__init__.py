"""Tier 1 data intake: parse an uploaded CSV/XLSX, validate it, write it to the database."""
from .runner import KINDS, run_parse_upload  # noqa: F401
