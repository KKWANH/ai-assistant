from aiws import openclaw


def test_parse_gateway_status_extracts_safe_summary():
    output = """Service: LaunchAgent (not loaded)
Gateway: bind=loopback (127.0.0.1), port=18789 (env/config)
Dashboard: http://127.0.0.1:18789/
Connectivity probe: failed
Capability: unknown
"""

    summary = openclaw.parse_gateway_status(output)

    assert summary["service"] == "LaunchAgent (not loaded)"
    assert summary["gateway"].startswith("bind=loopback")
    assert summary["dashboard"] == "http://127.0.0.1:18789/"
    assert summary["connectivity_probe"] == "failed"
