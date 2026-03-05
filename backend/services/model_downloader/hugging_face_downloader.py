"""Hugging Face model download service wrapper."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from threading import Lock
from typing import Any

from huggingface_hub import hf_hub_download, snapshot_download  # type: ignore[reportUnknownVariableType]
from tqdm.auto import tqdm as tqdm_auto  # type: ignore[reportUnknownVariableType]


def _make_progress_tqdm_class(callback: Callable[[int, int], None]) -> type:
    """Return a tqdm subclass that reports aggregated progress via *callback*.

    ``snapshot_download`` spawns one tqdm instance per file in the snapshot.
    All instances created from a single factory call share this mutable dict
    so the callback reports total progress across all files in that snapshot.
    """
    # Shared across all tqdm instances created within one download call.
    # Protected by a lock because snapshot_download runs parallel threads.
    lock = Lock()
    shared: dict[str, int] = {"downloaded": 0, "total": 0}

    class _ProgressTqdm(tqdm_auto):  # type: ignore[reportUntypedBaseClass]
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            kwargs["disable"] = True
            super().__init__(*args, **kwargs)  # type: ignore[reportUnknownMemberType]
            if self.total is not None:
                with lock:
                    shared["total"] += int(self.total)

        def update(self, n: float | int | None = 1) -> bool | None:  # type: ignore[reportIncompatibleMethodOverride]
            result = super().update(n)
            if n is not None:
                with lock:
                    shared["downloaded"] += int(n)
                    downloaded, total = shared["downloaded"], shared["total"]
                callback(downloaded, total)
            return result

    return _ProgressTqdm


class HuggingFaceDownloader:
    """Wraps huggingface_hub download functions."""

    def download_file(
        self,
        repo_id: str,
        filename: str,
        local_dir: str,
        on_progress: Callable[[int, int], None] | None = None,
    ) -> Path:
        tqdm_class = _make_progress_tqdm_class(on_progress) if on_progress is not None else None
        download_kwargs: dict[str, Any] = {
            "repo_id": repo_id,
            "filename": filename,
            "local_dir": local_dir,
        }
        if tqdm_class is not None:
            download_kwargs["tqdm_class"] = tqdm_class
        path: str = hf_hub_download(**download_kwargs)  # type: ignore[reportUnknownVariableType]
        return Path(path)  # type: ignore[reportUnknownArgumentType]

    def download_snapshot(
        self,
        repo_id: str,
        local_dir: str,
        on_progress: Callable[[int, int], None] | None = None,
    ) -> Path:
        tqdm_class = _make_progress_tqdm_class(on_progress) if on_progress is not None else None
        download_kwargs: dict[str, Any] = {
            "repo_id": repo_id,
            "local_dir": local_dir,
        }
        if tqdm_class is not None:
            download_kwargs["tqdm_class"] = tqdm_class
        path: str = snapshot_download(**download_kwargs)  # type: ignore[reportUnknownVariableType]
        return Path(path)  # type: ignore[reportUnknownArgumentType]
