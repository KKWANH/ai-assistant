from aiws import storage
from aiws.domain import usage


def test_monthly_usage_summary_projects_current_month(tmp_path):
    root = tmp_path
    storage.init_workspace(root)
    storage.append_model_usage(
        root,
        {
            "user_id": "kwanho",
            "provider": "gemini",
            "actual_usd": 1.25,
            "estimated_usd": 1.0,
            "created_at": storage.utc_now(),
        },
    )
    storage.append_model_usage(
        root,
        {
            "user_id": "other",
            "provider": "openai",
            "estimated_usd": 2.0,
            "created_at": storage.utc_now(),
        },
    )

    summary = usage.monthly_summary(root, "kwanho", include_all=True)

    assert summary["user"]["month_usd"] == 1.25
    assert summary["user"]["projected_month_usd"] >= 1.25
    assert summary["all_accounts"]["month_usd"] == 3.25
    assert summary["all_accounts"]["providers"][0]["usd"] >= 1.25
