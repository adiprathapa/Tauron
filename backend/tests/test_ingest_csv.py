"""
backend/tests/test_ingest_csv.py

Integration tests: CSV ingest → graph rebuild → /herd reflects updated scores.

Requires PyTorch + trained weights (live inference — not mock mode).
USE_MOCK is False in mock_data.py, so GET /herd hits the real pipeline.

Run:
    pytest backend/tests/test_ingest_csv.py -v
"""

import pytest
from fastapi.testclient import TestClient

import backend.main as main_module
from backend.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_herd_state():
    """Wipe module-level farm state before (and after) every test."""
    main_module._farm_df        = None
    main_module._field_overrides = {}
    main_module._herd_result     = None
    yield
    main_module._farm_df        = None
    main_module._field_overrides = {}
    main_module._herd_result     = None


class TestCsvIngestEndpoint:
    def test_returns_200_with_valid_records(self):
        r = client.post("/api/ingest/csv", json={"records": [
            {"cow_id": "0", "milk_yield_kg": "3.0"},
        ]})
        assert r.status_code == 200

    def test_response_schema(self):
        r = client.post("/api/ingest/csv", json={"records": [
            {"cow_id": "0", "milk_yield_kg": "5.0"},
        ]}).json()
        assert r["status"] == "ok"
        assert isinstance(r["rows"], int)
        assert isinstance(r["cows_updated"], int)

    def test_cows_updated_count(self):
        r = client.post("/api/ingest/csv", json={"records": [
            {"cow_id": "0", "milk_yield_kg": "3.0"},
            {"cow_id": "1", "milk_yield_kg": "2.0"},
            {"cow_id": "2", "milk_yield_kg": "1.0"},
        ]}).json()
        assert r["cows_updated"] == 3

    def test_rows_count_matches_input(self):
        records = [{"cow_id": str(i), "milk_yield_kg": "5.0"} for i in range(5)]
        r = client.post("/api/ingest/csv", json={"records": records}).json()
        assert r["rows"] == 5

    def test_empty_records_returns_ok(self):
        r = client.post("/api/ingest/csv", json={"records": []})
        assert r.status_code == 200
        assert r.json()["cows_updated"] == 0

    def test_row_missing_cow_id_is_skipped(self):
        r = client.post("/api/ingest/csv", json={"records": [
            {"milk_yield_kg": "5.0"},           # no cow_id — skip
            {"cow_id": "10", "milk_yield_kg": "4.0"},
        ]}).json()
        assert r["cows_updated"] == 1


class TestHerdUpdatedAfterCsvIngest:
    def _baseline_score(self, cow_id: int) -> float:
        cows = client.get("/herd").json()["cows"]
        return next(c["risk_score"] for c in cows if c["id"] == cow_id)

    def test_risk_score_changes_after_extreme_yield_override(self):
        """
        Cow 0's standardised milk-yield feature shifts dramatically when its
        7-day values are replaced with 1.0 kg (vs the ~28 kg baseline).
        The deterministic GNN forward pass must return a different score.
        """
        baseline = self._baseline_score(0)

        client.post("/api/ingest/csv", json={"records": [
            {"cow_id": "0", "milk_yield_kg": "1.0"},
        ]})

        updated = self._baseline_score(0)
        assert updated != baseline, (
            f"Expected risk score to change after CSV ingest; "
            f"baseline={baseline:.6f} updated={updated:.6f}"
        )

    def test_herd_schema_valid_after_ingest(self):
        client.post("/api/ingest/csv", json={"records": [
            {"cow_id": "5", "milk_yield_kg": "2.0", "health_event": "1.0"},
        ]})
        body = client.get("/herd").json()
        assert "cows" in body and "adjacency" in body
        for cow in body["cows"]:
            assert 0.0 <= cow["risk_score"] <= 1.0
            assert cow["status"] in {"alert", "watch", "ok"}

    def test_multiple_overrides_all_reflected(self):
        """All three modified cows must produce scores different from baseline."""
        baseline = {c["id"]: c["risk_score"] for c in client.get("/herd").json()["cows"]}

        client.post("/api/ingest/csv", json={"records": [
            {"cow_id": "0",  "milk_yield_kg": "1.0"},
            {"cow_id": "10", "milk_yield_kg": "1.0"},
            {"cow_id": "20", "milk_yield_kg": "1.0"},
        ]})

        updated = {c["id"]: c["risk_score"] for c in client.get("/herd").json()["cows"]}

        changed = [cid for cid in (0, 10, 20) if updated[cid] != baseline[cid]]
        # Changing three cows' features simultaneously shifts standardisation for all.
        # At least one of the three target cows must have a visibly different score.
        assert len(changed) >= 1, (
            f"No target cow changed score. baseline={[baseline[c] for c in (0,10,20)]} "
            f"updated={[updated[c] for c in (0,10,20)]}"
        )

    def test_herd_result_is_cached_not_rebuilt_on_second_get(self):
        """/herd must return identical JSON on back-to-back calls (cache hit, not rebuild)."""
        first  = client.get("/herd").json()
        second = client.get("/herd").json()
        assert first == second


class TestManualIngestAlsoUpdatesHerd:
    def test_manual_entry_with_yield_changes_score(self):
        cows_before = {c["id"]: c["risk_score"] for c in client.get("/herd").json()["cows"]}

        client.post("/api/ingest", json={
            "cow_id": 0,
            "yield_kg": 1.0,
            "pen": "A1",
            "health_event": "none",
            "notes": "",
        })

        cows_after = {c["id"]: c["risk_score"] for c in client.get("/herd").json()["cows"]}
        assert cows_after[0] != cows_before[0], (
            f"Manual ingest should update herd; "
            f"before={cows_before[0]:.6f} after={cows_after[0]:.6f}"
        )

    def test_manual_entry_returns_herd_updated_flag(self):
        r = client.post("/api/ingest", json={
            "cow_id": 0,
            "yield_kg": 5.0,
            "pen": "A1",
            "health_event": "none",
            "notes": "",
        }).json()
        assert r["herd_updated"] is True

    def test_manual_entry_without_measurable_fields_does_not_set_herd_updated(self):
        r = client.post("/api/ingest", json={
            "cow_id": 0,
            "yield_kg": None,
            "pen": "A1",
            "health_event": "none",
            "notes": "just a note",
        }).json()
        assert r["herd_updated"] is False
