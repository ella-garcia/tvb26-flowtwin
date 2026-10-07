"""AI on the mobile reply page (WP7): turn a supplier's free text or Excel into a proposed update they confirm.

extract(db, job) runs jobs of kind 'extract-reply'; the page calls POST /reply/{token}/extract (main.py).
"""


def extract(db, job: dict) -> dict:
    raise NotImplementedError("extract-reply is not implemented yet (WP7)")
