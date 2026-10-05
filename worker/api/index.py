"""Vercel entry point: serves the same FastAPI app as main.py (used by Docker/Cloud Run)."""
import os
import sys

# The worker's modules (config, jobs, engine, …) live one folder up.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app  # noqa: E402,F401
