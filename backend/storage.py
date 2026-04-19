from __future__ import annotations

import json
from pathlib import Path

from models import Document, Landscape
from views import SimilarityView


DEFAULT_MIN_RAW_TEXT_CHARS = 500


def cleanup_landscape(landscape: Landscape, min_raw_text_chars: int = DEFAULT_MIN_RAW_TEXT_CHARS) -> int:
    """Drop too-short docs and duplicates (by source_filename or content_hash).

    Mutates landscape in place. Removes orphaned IDs from region.members.
    Sets is_dirty=True if anything was removed. Returns the number removed.
    """
    seen_filenames: set[str] = set()
    seen_hashes: set[str] = set()
    keep: dict[str, Document] = {}
    removed_ids: set[str] = set()

    for doc_id, doc in landscape.documents.items():
        if len(doc.raw_text) < min_raw_text_chars:
            removed_ids.add(doc_id)
            continue
        if doc.source_filename and doc.source_filename in seen_filenames:
            removed_ids.add(doc_id)
            continue
        if doc.content_hash and doc.content_hash in seen_hashes:
            removed_ids.add(doc_id)
            continue
        keep[doc_id] = doc
        if doc.source_filename:
            seen_filenames.add(doc.source_filename)
        if doc.content_hash:
            seen_hashes.add(doc.content_hash)

    if removed_ids:
        landscape.documents = keep
        for region in landscape.regions.values():
            region.members = {k: v for k, v in region.members.items() if k not in removed_ids}
        landscape.is_dirty = True

    return len(removed_ids)


def save_landscape(landscape: Landscape, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(landscape.to_dict(), indent=2, default=str))


def load_landscape(path: Path) -> Landscape:
    if not path.exists():
        return Landscape()
    landscape = Landscape.from_dict(json.loads(path.read_text()))
    removed = cleanup_landscape(landscape)
    if removed:
        save_landscape(landscape, path)
        print(f"[cleanup] removed {removed} docs on load")
    return landscape


def save_view(view: SimilarityView, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(view.to_dict(), indent=2))


def load_view(path: Path) -> SimilarityView:
    if not path.exists():
        return SimilarityView()
    return SimilarityView.from_dict(json.loads(path.read_text()))
