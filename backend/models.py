from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any
from uuid import uuid4


@dataclass
class Document:
    id: str
    raw_text: str
    metadata: dict[str, Any] = field(default_factory=dict)
    summary: str = ""
    user_notes: str = ""
    source_filename: str | None = None
    embedding: list[float] | None = None
    embedding_input: str | None = None
    summary_input: str | None = None
    content_hash: str | None = None

    @staticmethod
    def new(raw_text: str, metadata: dict[str, Any], source_filename: str | None = None) -> "Document":
        return Document(
            id=uuid4().hex[:12],
            raw_text=raw_text,
            metadata=metadata,
            source_filename=source_filename,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "Document":
        return Document(**data)

    def public_view(self) -> dict[str, Any]:
        """A trimmed dict suitable for sending to the frontend (no full raw_text)."""
        return {
            "id": self.id,
            "metadata": self.metadata,
            "summary": self.summary,
            "user_notes": self.user_notes,
            "source_filename": self.source_filename,
            "raw_text_chars": len(self.raw_text),
        }


@dataclass
class Region:
    id: str
    name: str | None = None
    members: dict[str, float] = field(default_factory=dict)
    summary: str = ""

    @staticmethod
    def new(name: str | None = None) -> "Region":
        return Region(id=uuid4().hex[:12], name=name)

    def add_member(self, doc_id: str, weight: float = 1.0) -> None:
        self.members[doc_id] = weight

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "Region":
        return Region(**data)


@dataclass
class Landscape:
    documents: dict[str, Document] = field(default_factory=dict)
    regions: dict[str, Region] = field(default_factory=dict)
    is_dirty: bool = True

    def add_document(self, doc: Document) -> None:
        self.documents[doc.id] = doc
        self.is_dirty = True

    def add_region(self, region: Region) -> None:
        self.regions[region.id] = region

    def to_dict(self) -> dict[str, Any]:
        return {
            "documents": {doc_id: doc.to_dict() for doc_id, doc in self.documents.items()},
            "regions": {region_id: region.to_dict() for region_id, region in self.regions.items()},
            "is_dirty": self.is_dirty,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "Landscape":
        landscape = Landscape(is_dirty=data.get("is_dirty", True))
        for doc_id, doc_data in data.get("documents", {}).items():
            landscape.documents[doc_id] = Document.from_dict(doc_data)
        for region_id, region_data in data.get("regions", {}).items():
            landscape.regions[region_id] = Region.from_dict(region_data)
        return landscape
