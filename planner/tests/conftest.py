import pytest


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    """Every test gets its own data directory and an empty project registry."""
    from wpm import workspace
    monkeypatch.setenv("WPM_DATA_DIR", str(tmp_path / "data"))
    workspace._projects.clear()
    yield
    workspace._projects.clear()
