"""Connections to ERPs and CFDI providers (WP4b): read-only syncs into the intake tables.

run_sync(db, job) runs jobs of kind 'sync-connection' for one row of `connections`. Secrets come from the worker's
environment by `connections.secret_ref`, never from the database.
"""


def run_sync(db, job: dict) -> dict:
    raise NotImplementedError("sync-connection is not implemented yet (WP4b)")
