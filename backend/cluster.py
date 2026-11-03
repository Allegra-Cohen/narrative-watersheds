from __future__ import annotations

import math
from typing import Protocol

import numpy as np

from models import Document, Landscape, Region
from summarize import Summarizer, build_summary_input
from views import SimilarityView


def build_embedding_input(doc: Document) -> str:
    """Concatenate the metadata fields plus the LLM summary for the embedder."""
    parts: list[str] = []
    title = doc.metadata.get("title")
    author = doc.metadata.get("author")
    if title:
        parts.append(f"Title: {title}")
    if author:
        parts.append(f"Author: {author}")
    if doc.summary:
        parts.append(f"Summary: {doc.summary}")
    elif doc.raw_text:
        # Fallback if summary hasn't been computed yet
        parts.append(f"Excerpt: {doc.raw_text[:500]}")
    return "\n".join(parts)


class Embedder(Protocol):
    def embed(self, text: str) -> list[float]: ...


class SentenceTransformerEmbedder:
    """Torch-based embedder. Often best quality but heavy install."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        from sentence_transformers import SentenceTransformer
        self._model = SentenceTransformer(model_name)

    def embed(self, text: str) -> list[float]:
        vec = self._model.encode(text, normalize_embeddings=True)
        return vec.tolist()


class FastEmbedEmbedder:
    """ONNX-based embedder. No torch dependency; works on platforms torch dropped (e.g. Intel Mac)."""

    def __init__(self, model_name: str = "BAAI/bge-small-en-v1.5"):
        from fastembed import TextEmbedding
        self._model = TextEmbedding(model_name=model_name)

    def embed(self, text: str) -> list[float]:
        vec = next(self._model.embed([text]))
        return vec.tolist()


class Clusterer(Protocol):
    def cluster(self, embeddings: dict[str, list[float]]) -> dict[str, dict[int, float]]:
        """Return {doc_id: {cluster_index: weight}} for soft cluster membership."""
        ...


class HDBSCANClusterer:
    """HDBSCAN with a hard/soft membership toggle.

    mode="hard": each doc gets exactly one cluster (or none, if HDBSCAN labels it noise).
    mode="soft": each doc gets a probability across clusters (filtered by min_membership).
    """

    def __init__(
        self,
        min_cluster_size: int = 2,
        min_membership: float = 0.05,
        cluster_selection_method: str = "leaf",
        mode: str = "hard",
    ):
        if mode not in ("hard", "soft"):
            raise ValueError(f"unknown HDBSCANClusterer mode: {mode}")
        self.min_cluster_size = min_cluster_size
        self.min_membership = min_membership
        self.cluster_selection_method = cluster_selection_method
        self.mode = mode

    def cluster(self, embeddings: dict[str, list[float]]) -> dict[str, dict[int, float]]:
        import hdbscan
        ids = list(embeddings.keys())
        if len(ids) < self.min_cluster_size:
            return {doc_id: {} for doc_id in ids}

        X = np.array([embeddings[i] for i in ids])
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=self.min_cluster_size,
            cluster_selection_method=self.cluster_selection_method,
            prediction_data=True,
        )
        clusterer.fit(X)

        if self.mode == "hard":
            return self._hard_assignments(ids, clusterer)
        return self._soft_assignments(ids, clusterer)

    def _hard_assignments(self, ids, clusterer) -> dict[str, dict[int, float]]:
        result: dict[str, dict[int, float]] = {}
        for i, doc_id in enumerate(ids):
            label = int(clusterer.labels_[i])
            result[doc_id] = {label: 1.0} if label >= 0 else {}
        return result

    def _soft_assignments(self, ids, clusterer) -> dict[str, dict[int, float]]:
        import hdbscan
        try:
            soft = hdbscan.all_points_membership_vectors(clusterer)
        except Exception:
            soft = None

        result: dict[str, dict[int, float]] = {}
        for i, doc_id in enumerate(ids):
            weights: dict[int, float] = {}
            if soft is not None and getattr(soft, "ndim", 0) == 2 and soft.shape[1] > 0:
                row = soft[i]
                weights = {int(j): float(w) for j, w in enumerate(row) if w >= self.min_membership}
            if not weights:
                label = int(clusterer.labels_[i])
                if label >= 0:
                    weights = {label: 1.0}
            result[doc_id] = weights
        return result


class Layout(Protocol):
    def layout(self, embeddings: dict[str, list[float]]) -> dict[str, tuple[float, float]]: ...


class UMAPLayout:
    def __init__(
        self,
        n_neighbors: int = 5,
        min_dist: float = 0.1,
        random_state: int = 42,
        margin: float = 0.06,
    ):
        self.n_neighbors = n_neighbors
        self.min_dist = min_dist
        self.random_state = random_state
        self.margin = margin

    def layout(self, embeddings: dict[str, list[float]]) -> dict[str, tuple[float, float]]:
        ids = list(embeddings.keys())
        n = len(ids)
        if n == 0:
            return {}
        if n == 1:
            return {ids[0]: (0.5, 0.5)}
        if n < self.n_neighbors + 1:
            # Too few points for UMAP — arrange in a circle
            return {
                doc_id: (
                    0.5 + 0.3 * math.cos(2 * math.pi * i / n),
                    0.5 + 0.3 * math.sin(2 * math.pi * i / n),
                )
                for i, doc_id in enumerate(ids)
            }

        import umap
        X = np.array([embeddings[i] for i in ids])
        reducer = umap.UMAP(
            n_neighbors=min(self.n_neighbors, n - 1),
            min_dist=self.min_dist,
            n_components=2,
            random_state=self.random_state,
        )
        coords = reducer.fit_transform(X)

        mins = coords.min(axis=0)
        spans = coords.max(axis=0) - mins
        spans[spans == 0] = 1.0
        normalized = (coords - mins) / spans
        normalized = self.margin + normalized * (1 - 2 * self.margin)

        return {doc_id: (float(normalized[i, 0]), float(normalized[i, 1])) for i, doc_id in enumerate(ids)}


def run_clustering(
    landscape: Landscape,
    summarizer: Summarizer,
    embedder: Embedder,
    clusterer: Clusterer,
    layout: Layout,
) -> SimilarityView:
    """Summarize, embed, cluster, lay out, replace landscape.regions."""
    docs = list(landscape.documents.values())

    # 1. Summarize any docs that need it
    # Use summary_input as the sole cache key — empty summaries from "no substantive
    # content" docs are valid cached results and shouldn't trigger re-summarization.
    needs_summary = [d for d in docs if d.summary_input != build_summary_input(d)]
    if needs_summary:
        print(f"[cluster] summarizing {len(needs_summary)} docs...")
        for i, doc in enumerate(needs_summary, 1):
            title = doc.metadata.get("title", doc.id)[:50]
            print(f"[cluster]   ({i}/{len(needs_summary)}) {title}")
            doc.summary = summarizer.summarize(doc)
            doc.summary_input = build_summary_input(doc)

    # 2. Embed any docs whose embedding input has changed
    for doc in docs:
        input_str = build_embedding_input(doc)
        if doc.embedding is None or doc.embedding_input != input_str:
            doc.embedding = embedder.embed(input_str)
            doc.embedding_input = input_str

    embeddings = {
        doc.id: doc.embedding
        for doc in landscape.documents.values()
        if doc.embedding
    }

    if not embeddings:
        landscape.regions = {}
        landscape.is_dirty = False
        return SimilarityView()

    soft_assignments = clusterer.cluster(embeddings)
    positions = layout.layout(embeddings)

    landscape.regions.clear()
    cluster_indices = sorted({idx for weights in soft_assignments.values() for idx in weights.keys()})
    cluster_to_region: dict[int, Region] = {}
    for idx in cluster_indices:
        region = Region.new(name=None)
        cluster_to_region[idx] = region
        landscape.regions[region.id] = region

    for doc_id, weights in soft_assignments.items():
        for cluster_idx, weight in weights.items():
            cluster_to_region[cluster_idx].add_member(doc_id, weight)

    landscape.is_dirty = False
    return SimilarityView(positions=positions)
