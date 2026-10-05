"""Environment configuration. Values are read lazily; secrets are never logged."""
import os


class ConfigError(RuntimeError):
    pass


def supabase_url() -> str:
    v = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not v:
        raise ConfigError("SUPABASE_URL is not set")
    return v


def service_role_key() -> str:
    v = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not v:
        raise ConfigError("SUPABASE_SERVICE_ROLE_KEY is not set")
    return v


def worker_token() -> str:
    """Optional shared secret protecting the job endpoints (Authorization: Bearer <token>)."""
    return os.environ.get("WORKER_TOKEN", "")


def signals_file() -> str:
    return os.environ.get("SIGNALS_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "seed_signals.json"))
