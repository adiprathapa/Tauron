"""
backend/tests/test_endpoints.py

FastAPI endpoint tests — runs against mock data (USE_MOCK = True).
No PyTorch, no Ollama, no network required.

Run: pytest backend/tests/test_endpoints.py -v
"""

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

VALID_STATUSES  = {"alert", "watch", "ok"}
VALID_DISEASES  = {"mastitis", "brd", "lameness"}


class TestHerdEndpoint:
    def test_returns_200(self):
        r = client.get("/herd")
        assert r.status_code == 200

    def test_has_required_keys(self):
        body = client.get("/herd").json()
        assert "cows" in body
        assert "adjacency" in body

    def test_cows_is_nonempty_list(self):
        cows = client.get("/herd").json()["cows"]
        assert isinstance(cows, list)
        assert len(cows) > 0

    def test_each_cow_has_required_fields(self):
        cows = client.get("/herd").json()["cows"]
        for cow in cows:
            assert "id"          in cow
            assert "risk_score"  in cow
            assert "status"      in cow
            assert "top_feature" in cow  # may be null — but key must be present

    def test_cow_status_values_are_valid(self):
        cows = client.get("/herd").json()["cows"]
        for cow in cows:
            assert cow["status"] in VALID_STATUSES, (
                f"Cow {cow['id']} has invalid status '{cow['status']}'"
            )

    def test_risk_score_in_range(self):
        cows = client.get("/herd").json()["cows"]
        for cow in cows:
            assert 0.0 <= cow["risk_score"] <= 1.0, (
                f"Cow {cow['id']} risk_score {cow['risk_score']} out of [0, 1]"
            )

    def test_ok_cows_have_null_disease_fields(self):
        cows = client.get("/herd").json()["cows"]
        for cow in cows:
            if cow["status"] == "ok":
                assert cow["top_feature"]      is None, f"ok cow #{cow['id']} has non-null top_feature"
                assert cow["dominant_disease"] is None, f"ok cow #{cow['id']} has non-null dominant_disease"
                assert cow["all_risks"]        is None, f"ok cow #{cow['id']} has non-null all_risks"

    def test_alert_cows_have_disease_fields(self):
        cows = client.get("/herd").json()["cows"]
        for cow in cows:
            if cow["status"] == "alert":
                assert cow["dominant_disease"] in VALID_DISEASES, (
                    f"alert cow #{cow['id']} missing valid dominant_disease"
                )
                assert isinstance(cow["all_risks"], dict), (
                    f"alert cow #{cow['id']} all_risks is not a dict"
                )
                assert set(cow["all_risks"].keys()) == VALID_DISEASES

    def test_all_risk_scores_in_range(self):
        cows = client.get("/herd").json()["cows"]
        for cow in cows:
            if cow["all_risks"] is not None:
                for disease, score in cow["all_risks"].items():
                    assert 0.0 <= score <= 1.0, (
                        f"Cow #{cow['id']} {disease} risk {score} out of [0, 1]"
                    )

    def test_adjacency_is_square(self):
        body = client.get("/herd").json()
        n = len(body["cows"])
        assert len(body["adjacency"]) == n, "Adjacency rows != number of cows"
        for row in body["adjacency"]:
            assert len(row) == n, "Adjacency row length != number of cows"

    def test_adjacency_is_symmetric(self):
        adj = client.get("/herd").json()["adjacency"]
        n = len(adj)
        for i in range(n):
            for j in range(n):
                assert adj[i][j] == adj[j][i], (
                    f"Adjacency not symmetric at [{i}][{j}]"
                )

    def test_adjacency_has_zero_diagonal(self):
        adj = client.get("/herd").json()["adjacency"]
        for i, row in enumerate(adj):
            assert row[i] == 0, f"Diagonal at [{i}][{i}] is non-zero (self-loop)"


class TestExplainEndpoint:
    def test_known_cow_returns_200(self):
        r = client.get("/explain/47")
        assert r.status_code == 200

    def test_unknown_cow_returns_404(self):
        r = client.get("/explain/9999")
        assert r.status_code == 404

    def test_response_has_all_required_keys(self):
        body = client.get("/explain/47").json()
        required_keys = {
            "cow_id", "risk_score", "top_edge", "top_feature",
            "feature_delta", "alert_text",
            "dominant_disease", "all_risks",  # new multi-disease fields
        }
        for key in required_keys:
            assert key in body, f"Missing key: {key}"

    def test_cow_id_matches_request(self):
        body = client.get("/explain/47").json()
        assert body["cow_id"] == 47

    def test_top_edge_has_required_keys(self):
        top_edge = client.get("/explain/47").json()["top_edge"]
        assert "from"   in top_edge
        assert "to"     in top_edge
        assert "weight" in top_edge

    def test_top_edge_from_matches_cow(self):
        body = client.get("/explain/47").json()
        assert body["top_edge"]["from"] == body["cow_id"]

    def test_edge_weight_in_range(self):
        weight = client.get("/explain/47").json()["top_edge"]["weight"]
        assert 0.0 <= weight <= 1.0

    def test_alert_text_is_nonempty_string(self):
        alert = client.get("/explain/47").json()["alert_text"]
        assert isinstance(alert, str)
        assert len(alert) > 0

    def test_alert_text_names_the_cow(self):
        """Alert text must reference the cow ID so farmers can act immediately."""
        body  = client.get("/explain/47").json()
        alert = body["alert_text"]
        assert "47" in alert, f"Alert text does not name cow #47: '{alert}'"

    def test_dominant_disease_is_valid_or_none(self):
        body = client.get("/explain/47").json()
        if body["dominant_disease"] is not None:
            assert body["dominant_disease"] in VALID_DISEASES

    def test_all_risks_covers_all_diseases(self):
        body = client.get("/explain/47").json()
        if body["all_risks"] is not None:
            assert set(body["all_risks"].keys()) == VALID_DISEASES
            for score in body["all_risks"].values():
                assert 0.0 <= score <= 1.0

    def test_feature_delta_is_float(self):
        delta = client.get("/explain/47").json()["feature_delta"]
        assert isinstance(delta, float)

    def test_all_mock_cows_have_explain(self):
        """Every cow in /herd should have a corresponding /explain entry."""
        cows = client.get("/herd").json()["cows"]
        for cow in cows:
            r = client.get(f"/explain/{cow['id']}")
            assert r.status_code == 200, (
                f"Cow {cow['id']} in /herd but missing from /explain"
            )


class TestImpactEndpoint:
    REQUIRED_KEYS = {
        "antibiotic_doses_avoided",
        "milk_yield_saved_usd",
        "avg_lead_time_hours",
        "alerts_confirmed_pct",
    }

    def test_returns_200(self):
        r = client.get("/api/impact")
        assert r.status_code == 200

    def test_has_all_required_keys(self):
        body = client.get("/api/impact").json()
        for key in self.REQUIRED_KEYS:
            assert key in body, f"Missing key: {key}"

    def test_numeric_fields_are_non_negative_or_null(self):
        body = client.get("/api/impact").json()
        for key in ("antibiotic_doses_avoided", "milk_yield_saved_usd", "avg_lead_time_hours"):
            val = body[key]
            if val is not None:
                assert val >= 0, f"{key} should be non-negative, got {val}"

    def test_alerts_confirmed_pct_is_pct_or_null(self):
        val = client.get("/api/impact").json()["alerts_confirmed_pct"]
        if val is not None:
            assert 0 <= val <= 100, f"alerts_confirmed_pct out of [0,100]: {val}"

    def test_mock_values_are_representative(self):
        """In mock mode the metrics should be non-zero so the UI is populated."""
        body = client.get("/api/impact").json()
        assert body["antibiotic_doses_avoided"] > 0
        assert body["milk_yield_saved_usd"] > 0
        assert body["avg_lead_time_hours"] > 0
