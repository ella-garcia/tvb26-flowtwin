"""EDI copy from the Tier 1 (WP4a): X12 830/862/856 and EDIFACT DELFOR/DELJIT/DESADV into releases and shipment notices.

run(db, job) runs jobs of kind 'ingest-edi'. Writes go through intake.ingest_rows(..., source="edi") and shipment_notices.
"""


def run(db, job: dict) -> dict:
    raise NotImplementedError("ingest-edi is not implemented yet (WP4a)")
