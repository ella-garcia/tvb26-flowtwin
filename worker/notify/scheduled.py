"""Time-based notifications (WP5): reminders on unanswered red alerts, the Tier 1 daily digest, weekly supplier check-ins.

run(db, now, client) is called by the hourly run after the alert notifications; it is a no-op until WP5 fills it in.
send_digest(db, job) runs jobs of kind 'send-digest'.
"""


def run(db, now=None, client=None) -> dict:
    return {"skipped": "not implemented (WP5)"}


def send_digest(db, job: dict) -> dict:
    raise NotImplementedError("send-digest is not implemented yet (WP5)")
