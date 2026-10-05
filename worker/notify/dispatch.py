"""Alert notifications: decide who gets what after a recompute, send once, record every attempt.

Reasons: 'new-alert' and 'level-up' go to the key customer and the supplier; 'supplier-responded' and 'auto-resolved'
go to the key customer only. (alert_id, reason, recipient) is sent at most once: attempts with status sent, dry-run or
skipped are never repeated; a 'failed' attempt is retried on the next run.
"""
import html as _html

from . import resend

RANK = {"green": 0, "amber": 1, "red": 2}
HEADLINE = {"new-alert": "New alert", "level-up": "Alert escalated", "supplier-responded": "Supplier responded",
            "auto-resolved": "Alert resolved"}


def _contact_email(company: dict | None) -> str | None:
    c = (company or {}).get("contact") or {}
    return (c.get("email") or "").strip() or None


def compose(alert: dict, reason: str, audience: str, risk: dict | None, companies: dict) -> tuple[str, str, str]:
    """(subject, text, html). Link goes to #alerts for the customer, #my-risk for the supplier."""
    base = resend.app_url()
    link = f"{base}/#{'alerts' if audience == 'customer' else 'my-risk'}" if base else ""
    dtls = (risk or {}).get("days_to_line_stop")
    stop = f"about {float(dtls):g} days" if dtls is not None else "no line stop expected in the next 14 days"
    level = alert["level"].upper() if reason != "auto-resolved" else "GREEN"
    supplier = (companies.get(alert["supplier_id"]) or {}).get("name", alert["supplier_id"])
    lines = [alert["title"], "", alert["message"], "", f"Supplier: {supplier}", f"Days to line stop: {stop}"]
    if reason == "supplier-responded":
        resp = alert.get("supplier_response") or {}
        if resp.get("message"):
            lines += ["", f"{resp.get('by') or supplier} replied: {resp['message']}"]
    if reason == "auto-resolved":
        lines = [alert["title"], "", f"The risk for {supplier} is back to green, so the engine closed this alert."]
    if link:
        lines += ["", f"Open FlowTwin: {link}"]
    text = "\n".join(lines)
    e = _html.escape
    body = "".join(f"<p>{e(l)}</p>" if l else "" for l in lines if not l.startswith("Open FlowTwin"))
    if link:
        body += f'<p><a href="{e(link)}">Open FlowTwin</a></p>'
    page = f'<div style="font-family:sans-serif;max-width:560px"><p><strong>{e(HEADLINE[reason])} ({e(level)})</strong></p>{body}</div>'
    return f"[FlowTwin] {HEADLINE[reason]}: {alert['title']}", text, page


def _already(existing: set, alert_id, reason, recipient) -> bool:
    return (alert_id, reason, recipient) in existing


def send_for(db, alert: dict, reason: str, audiences: tuple[str, ...], companies: dict, risks: dict, existing: set,
             client=None) -> list[dict]:
    """Notify the audiences of one alert for one reason. Returns the recorded rows (new attempts only)."""
    out = []
    risk = risks.get((alert["customer_id"], alert["supplier_id"]))
    for audience in audiences:
        cid = alert["customer_id"] if audience == "customer" else alert["supplier_id"]
        to = _contact_email(companies.get(cid))
        recipient = to or "(no contact email)"
        if _already(existing, alert["id"], reason, recipient):
            continue
        if to is None:
            status, err = "skipped", f"{cid} has no contact email"
        else:
            subject, text, page = compose(alert, reason, audience, risk, companies)
            status, err = resend.send_email(to, subject, text, page, client)
        row = dict(alert_id=alert["id"], channel="email", recipient=recipient, audience=audience, status=status, reason=reason, error=err)
        out += db.insert("alert_notifications", [row])
        if status != "failed":
            existing.add((alert["id"], reason, recipient))
    return out


def load_existing(db) -> set:
    rows = db.select("alert_notifications")
    return {(r["alert_id"], r["reason"], r["recipient"]) for r in rows if r["status"] != "failed"}


def notify_after_recompute(db, before: dict, client=None) -> dict:
    """before: {alert_id: {level, status}} snapshot taken before the recompute. Handles new-alert, level-up, supplier-responded."""
    alerts = db.select("alerts")
    companies = {c["id"]: c for c in db.select("companies")}
    risks = {(r["customer_id"], r["supplier_id"]): r for r in db.select("risks")}
    existing = load_existing(db)
    counts = {"new-alert": 0, "level-up": 0, "supplier-responded": 0}
    rows = []
    for a in alerts:
        if a["status"] == "resolved":
            continue
        prev = before.get(a["id"])
        if prev is None:
            reason = "new-alert"
        elif RANK[a["level"]] > RANK[prev["level"]]:
            reason = "level-up"
        else:
            reason = None
        if reason:
            made = send_for(db, a, reason, ("customer", "supplier"), companies, risks, existing, client)
            counts[reason] += len(made)
            rows += made
        if a["status"] == "supplier-responded":
            made = send_for(db, a, "supplier-responded", ("customer",), companies, risks, existing, client)
            counts["supplier-responded"] += len(made)
            rows += made
    by_status: dict[str, int] = {}
    for r in rows:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
    return {"recorded": len(rows), "by_reason": counts, "by_status": by_status}
