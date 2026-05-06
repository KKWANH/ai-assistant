import pytest

from aiws import search, storage


def test_search_mode_validation_and_decision():
    assert search.should_search("off", "latest news") is False
    assert search.should_search("always", "hello") is True
    assert search.should_search("auto", "latest news") is True
    assert search.should_search("auto", "hello") is False

    with pytest.raises(storage.WorkspaceError):
        search.should_search("bad", "hello")


def test_search_context_and_metadata():
    result = search.SearchResult(title="Example", url="https://example.com", snippet="Snippet")

    context = search.format_search_context([result])
    metadata = search.results_metadata("always", [result])

    assert "## Search Context" in context
    assert "https://example.com" in context
    assert metadata["sources"][0]["title"] == "Example"
