"""Reposition landmarks based on semantic similarity between their `thoughts`
and region summaries. Used after the layout changes (e.g. after re-clustering)
so landmarks don't get stranded at coordinates that no longer correspond to
anything meaningful."""
from __future__ import annotations

import math

import numpy as np

from cluster import Embedder
from models import Landscape
from views import SimilarityView


JITTER_RADIUS = 0.04  # normalized — small ring for multiple landmarks in the same region


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def relocate_landmarks(landscape: Landscape, view: SimilarityView, embedder: Embedder) -> int:
    """Move each landmark to the centroid of its most semantically similar region
    (matched on landmark.thoughts vs region.summary). Landmarks with empty
    thoughts go to canvas center. Returns the number of landmarks repositioned."""
    if not landscape.landmarks or not landscape.regions:
        return 0

    # Compute each region's centroid from its member doc positions in the view.
    region_centroids: dict[str, tuple[float, float]] = {}
    for region in landscape.regions.values():
        pts = [view.positions[did] for did in region.members if did in view.positions]
        if not pts:
            continue
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        region_centroids[region.id] = (cx, cy)

    # Embed each region's summary once.
    region_embeddings: dict[str, np.ndarray] = {}
    for region in landscape.regions.values():
        if not region.summary or region.id not in region_centroids:
            continue
        text = f"Title: {region.name or ''}\nSummary: {region.summary}"
        region_embeddings[region.id] = np.asarray(embedder.embed(text))

    if not region_embeddings:
        return 0

    # For each landmark with thoughts, find the most similar region.
    landmarks_per_region: dict[str, list[str]] = {}
    fallback_count = 0
    for lm in landscape.landmarks.values():
        thoughts = (lm.thoughts or "").strip()
        if not thoughts:
            lm.position = (0.5, 0.5)
            fallback_count += 1
            continue
        lm_emb = np.asarray(embedder.embed(thoughts))
        best_rid: str | None = None
        best_score = -1.0
        for rid, r_emb in region_embeddings.items():
            score = _cosine(lm_emb, r_emb)
            if score > best_score:
                best_score = score
                best_rid = rid
        if best_rid:
            landmarks_per_region.setdefault(best_rid, []).append(lm.id)

    # Place landmarks at their region's centroid; ring-distribute if multiple.
    repositioned = fallback_count
    for rid, lm_ids in landmarks_per_region.items():
        center = region_centroids[rid]
        n = len(lm_ids)
        for i, lm_id in enumerate(lm_ids):
            if n == 1:
                offset = (0.0, 0.0)
            else:
                angle = 2 * math.pi * i / n
                offset = (JITTER_RADIUS * math.cos(angle), JITTER_RADIUS * math.sin(angle))
            landscape.landmarks[lm_id].position = (
                center[0] + offset[0],
                center[1] + offset[1],
            )
            repositioned += 1
    return repositioned
