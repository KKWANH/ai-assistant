import pytest
from pydantic import BaseModel, ValidationError

from aiws.domain.ids import ProjectPath, Slug, StableId


class SlugModel(BaseModel):
    slug: Slug


class PathModel(BaseModel):
    path: ProjectPath


class IdModel(BaseModel):
    id: StableId


def test_slug_accepts_lowercase_kebab_case() -> None:
    assert SlugModel(slug="research-brief").slug == "research-brief"


@pytest.mark.parametrize("slug", ["Research", "-bad", "bad-", "bad--slug", "bad_slug", ""])
def test_slug_rejects_invalid_values(slug: str) -> None:
    with pytest.raises(ValidationError):
        SlugModel(slug=slug)


def test_project_path_allows_two_levels() -> None:
    assert PathModel(path="parent/child").path == "parent/child"


@pytest.mark.parametrize("path", ["", "/project", "project/", "a/b/c", "a//b", "bad_name"])
def test_project_path_rejects_invalid_values(path: str) -> None:
    with pytest.raises(ValidationError):
        PathModel(path=path)


def test_stable_id_allows_provider_style_ids() -> None:
    assert IdModel(id="run_01HX:abc.def").id == "run_01HX:abc.def"
