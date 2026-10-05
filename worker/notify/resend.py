"""Email through Resend (POST https://api.resend.com/emails). Without RESEND_API_KEY nothing is sent: status 'dry-run'."""
import os

import httpx

RESEND_URL = "https://api.resend.com/emails"
DEFAULT_FROM = "FlowTwin <alerts@flowtwin.example>"


def api_key() -> str:
    return os.environ.get("RESEND_API_KEY", "")


def sender() -> str:
    return os.environ.get("NOTIFY_FROM", "") or DEFAULT_FROM


def app_url() -> str:
    return os.environ.get("APP_URL", "").rstrip("/")


def send_email(to: str, subject: str, text: str, html: str, client: httpx.Client | None = None) -> tuple[str, str | None]:
    """Returns (status, error): ('sent', None), ('dry-run', None) or ('failed', message). Never raises, never logs the key."""
    key = api_key()
    if not key:
        return "dry-run", None
    try:
        c = client or httpx.Client(timeout=15.0)
        r = c.post(RESEND_URL, headers={"Authorization": f"Bearer {key}"},
                   json={"from": sender(), "to": [to], "subject": subject, "text": text, "html": html})
        if r.status_code >= 400:
            return "failed", f"Resend {r.status_code}: {r.text[:300]}"
        return "sent", None
    except Exception as e:  # noqa: BLE001
        return "failed", f"{type(e).__name__}: {e}"[:300]
