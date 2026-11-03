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
    summary_input: str | None = None  # cache key — invalidate summary if this changes

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


VALID_LANDMARK_ICONS = ("castle", "city", "town", "bridge", "lighthouse")


@dataclass
class Landmark:
    id: str
    icon: str
    position: tuple[float, float]
    thoughts: str = ""
    pending: bool = False  # True when proposed by Mapmaker in Stage 3, awaiting user confirmation

    @staticmethod
    def new(icon: str, position: tuple[float, float], thoughts: str = "", pending: bool = False) -> "Landmark":
        return Landmark(id=uuid4().hex[:12], icon=icon, position=position, thoughts=thoughts, pending=pending)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "icon": self.icon,
            "position": list(self.position),
            "thoughts": self.thoughts,
            "pending": self.pending,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "Landmark":
        return Landmark(
            id=data["id"],
            icon=data["icon"],
            position=tuple(data["position"]),
            thoughts=data.get("thoughts", ""),
            pending=data.get("pending", False),
        )


@dataclass
class PathStep:
    """One argument move in the user's essay. The main river is the sequence of
    these in order. Steps no longer reference landmarks directly — connections
    to landmarks/regions are expressed as Tributaries instead."""
    id: str
    essay_span: str
    evocative_sentence: str

    @staticmethod
    def new(essay_span: str, evocative_sentence: str) -> "PathStep":
        return PathStep(
            id=uuid4().hex[:12],
            essay_span=essay_span,
            evocative_sentence=evocative_sentence,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "PathStep":
        # Tolerate legacy keys (landmark_id, is_uncharted) silently.
        return PathStep(
            id=data["id"],
            essay_span=data.get("essay_span", ""),
            evocative_sentence=data.get("evocative_sentence", ""),
        )


@dataclass
class Tributary:
    """A side stream connecting an existing Region/Landmark/Document to the main
    river, representing that the source material informed the related argument
    step. For region tributaries, contributing_doc_ids lists the specific docs
    in that region that the Mapmaker matched — so the renderer can show
    drainage streams from those docs into a collection point at the region's
    edge before the main stream flows to the river."""
    id: str
    step_id: str           # which PathStep this tributary feeds (joins above it)
    source_type: str       # "region" | "landmark" | "doc"
    source_id: str
    contributing_doc_ids: list[str] = field(default_factory=list)

    @staticmethod
    def new(step_id: str, source_type: str, source_id: str,
            contributing_doc_ids: list[str] | None = None) -> "Tributary":
        return Tributary(
            id=uuid4().hex[:12],
            step_id=step_id,
            source_type=source_type,
            source_id=source_id,
            contributing_doc_ids=list(contributing_doc_ids or []),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "Tributary":
        return Tributary(
            id=data["id"],
            step_id=data["step_id"],
            source_type=data["source_type"],
            source_id=data["source_id"],
            contributing_doc_ids=list(data.get("contributing_doc_ids") or []),
        )


@dataclass
class Path:
    id: str
    steps: list[PathStep] = field(default_factory=list)
    tributaries: list[Tributary] = field(default_factory=list)

    @staticmethod
    def new() -> "Path":
        return Path(id=uuid4().hex[:12], steps=[], tributaries=[])

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "steps": [s.to_dict() for s in self.steps],
            "tributaries": [t.to_dict() for t in self.tributaries],
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "Path":
        return Path(
            id=data["id"],
            steps=[PathStep.from_dict(s) for s in data.get("steps", [])],
            tributaries=[Tributary.from_dict(t) for t in data.get("tributaries", [])],
        )


@dataclass
class Landscape:
    documents: dict[str, Document] = field(default_factory=dict)
    regions: dict[str, Region] = field(default_factory=dict)
    landmarks: dict[str, Landmark] = field(default_factory=dict)
    path: Path | None = None
    is_dirty: bool = True

    def add_document(self, doc: Document) -> None:
        self.documents[doc.id] = doc
        self.is_dirty = True

    def add_region(self, region: Region) -> None:
        self.regions[region.id] = region

    def add_landmark(self, landmark: Landmark) -> None:
        self.landmarks[landmark.id] = landmark

    def to_dict(self) -> dict[str, Any]:
        return {
            "documents": {doc_id: doc.to_dict() for doc_id, doc in self.documents.items()},
            "regions": {region_id: region.to_dict() for region_id, region in self.regions.items()},
            "landmarks": {lm_id: lm.to_dict() for lm_id, lm in self.landmarks.items()},
            "path": self.path.to_dict() if self.path else None,
            "is_dirty": self.is_dirty,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "Landscape":
        landscape = Landscape(is_dirty=data.get("is_dirty", True))
        for doc_id, doc_data in data.get("documents", {}).items():
            landscape.documents[doc_id] = Document.from_dict(doc_data)
        for region_id, region_data in data.get("regions", {}).items():
            landscape.regions[region_id] = Region.from_dict(region_data)
        for lm_id, lm_data in data.get("landmarks", {}).items():
            landscape.landmarks[lm_id] = Landmark.from_dict(lm_data)
        if data.get("path"):
            landscape.path = Path.from_dict(data["path"])
        return landscape
