from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SimilarityView:
    """2D positions for documents, computed by UMAP on their embeddings.

    Used in stages 1 and 2. Positions are normalized to [0, 1] in both axes.
    """

    positions: dict[str, tuple[float, float]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "similarity",
            "positions": {doc_id: list(pos) for doc_id, pos in self.positions.items()},
        }

    @staticmethod
    def from_dict(data: dict[str, Any] | None) -> "SimilarityView":
        if not data:
            return SimilarityView()
        positions = data.get("positions", {})
        return SimilarityView(
            positions={doc_id: tuple(pos) for doc_id, pos in positions.items()},
        )
