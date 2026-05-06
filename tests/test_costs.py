from aiws import costs


def test_model_cost_estimate_for_local_model_is_zero():
    estimate = costs.estimate_cost("ollama", "qwen3:8b", 1000, 1000)

    assert estimate["known"] is True
    assert estimate["estimated_cost"] == 0.0


def test_unknown_model_cost_is_explicit():
    estimate = costs.estimate_cost("x", "y", 1000, 1000)

    assert estimate["known"] is False
    assert estimate["estimated_cost"] is None


def test_rough_token_count_is_stable():
    assert costs.rough_token_count("abcd" * 10) == 10
