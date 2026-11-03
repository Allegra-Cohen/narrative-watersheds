"""The path algorithm: turn an essay into a sinuous river of argument steps,
then find tributaries from existing regions/landmarks that relate to each step.

Backend produces only the data (PathSteps + Tributaries). The frontend handles
geometry — sinuous river curves, tributary join points, etc."""
from __future__ import annotations

import json
from typing import Any

import numpy as np

from collections import defaultdict

from cluster import Embedder
from llm import LLMClient
from models import Document, Landmark, Path, PathStep, Region, Tributary


ARGUMENT_EXTRACTION_PROMPT = """Analyze the essay below and identify the sequence of argument MOVES it makes. An argument move is a distinct step in the essay's reasoning — typically a paragraph or two of contiguous text. The full sequence of moves is the spine of the essay's argument.

For each move, identify two things:

1. essay_span: the exact verbatim text from the essay (a paragraph or contiguous chunk that constitutes this move). Copy it word-for-word; do not paraphrase or summarize.

2. evocative_sentence: a single sentence selected verbatim from that span that most captures the move's essence — the sentence you'd quote if you had to point to "this is what this part of the essay is doing."

Output ONLY a JSON object, no preamble, no code fences:

{{"steps": [{{"essay_span": "...", "evocative_sentence": "..."}}]}}

Steps appear in the order they appear in the essay. Use only verbatim text from the essay.

ESSAY:
<essay>
{essay}
</essay>"""


TRIBUTARY_JUDGMENT_PROMPT = """You are identifying which of the user's individual research documents and named concepts (landmarks) are EXPLICITLY RELATED to a specific argument step in their essay.

THE STEP being analyzed:
"{evocative}"

Surrounding context (how this step fits the larger argument):
PREVIOUS STEP: "{prev}"
NEXT STEP: "{next_step}"

Full text of THIS step:
"{essay_span}"

CANDIDATES (already pre-filtered by semantic similarity — these are the most likely matches). Each is either a DOCUMENT (a single paper, article, or page from the user's reading) or a LANDMARK (a named concept the user has placed):
{candidates}

For each candidate, decide whether it is EXPLICITLY related to THIS STEP. A candidate counts as EXPLICITLY related only if the step and the candidate:
- use the same terminology, OR
- make the same point.

Distant thematic resemblance ("both about X") is NOT enough. Shared high-level topic without shared terminology or argument does NOT count. When in doubt, answer no.

Output ONLY a JSON object, no preamble, no code fences:

{{"related": [{{"id": "<candidate-id>", "explicit": true}}]}}

Include ONLY candidates you judge explicitly related. The list may be empty."""


def _parse_json(text: str) -> dict[str, Any]:
    s = text.strip()
    if s.startswith("```"):
        nl = s.find("\n")
        if nl > 0:
            s = s[nl + 1:]
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3].rstrip()
    return json.loads(s)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def extract_arguments(essay: str, llm: LLMClient) -> list[PathStep]:
    """Step 1: have the Mapmaker identify the sequence of argument moves and
    select an evocative sentence for each. Both fields are verbatim from the
    essay — the Mapmaker never writes its own prose."""
    prompt = ARGUMENT_EXTRACTION_PROMPT.format(essay=essay)
    response = llm.complete(prompt)
    data = _parse_json(response)
    steps: list[PathStep] = []
    for step_data in data.get("steps", []):
        span = (step_data.get("essay_span") or "").strip()
        evocative = (step_data.get("evocative_sentence") or "").strip()
        if not span or not evocative:
            continue
        steps.append(PathStep.new(essay_span=span, evocative_sentence=evocative))
    return steps


def _format_candidates(candidates: list[dict[str, Any]]) -> str:
    lines = []
    for i, c in enumerate(candidates, 1):
        kind = c["type"]
        label = c["label"]
        content = c["content"]
        snippet = content if len(content) <= 400 else content[:397] + "…"
        lines.append(f'{i}. [id={c["id"]}] [{kind}] {label}\n   {snippet}')
    return "\n\n".join(lines) or "(no candidates)"


def find_related(
    steps: list[PathStep],
    documents: list[Document],
    regions: list[Region],
    landmarks: list[Landmark],
    embedder: Embedder,
    llm: LLMClient,
    top_k: int = 20,
) -> list[Tributary]:
    """Doc-level relatedness with drainage-basin grouping per region.

    Per step: top_k docs by embedding similarity + every non-empty landmark.
    LLM returns a binary explicit yes/no per candidate (same terminology or
    same point as the step). Post-process: for each region with 2+ matched
    docs feeding this step, emit ONE region tributary (with
    contributing_doc_ids for drainage rendering). Single matched docs become
    individual doc tributaries. Landmarks always emit their own tributaries."""
    if not steps:
        return []

    docs_by_id = {d.id: d for d in documents}

    # Build candidate pool: per-document candidates + landmark candidates.
    # Region summaries are NOT candidates anymore — too generic.
    candidates: list[dict[str, Any]] = []
    for doc in documents:
        meta = doc.metadata or {}
        title = meta.get("title") or doc.source_filename or "Untitled"
        author = meta.get("author") or ""
        text_parts = [f"Title: {title}"]
        if author:
            text_parts.append(f"Author: {author}")
        if doc.summary:
            text_parts.append(f"Summary: {doc.summary}")
        text = "\n".join(text_parts)
        candidates.append({
            "id": doc.id,
            "type": "doc",
            "label": title,
            "content": doc.summary or "(no summary)",
            "embedding": np.asarray(embedder.embed(text)),
        })
    for lm in landmarks:
        if lm.pending:
            continue
        thoughts = (lm.thoughts or "").strip()
        if not thoughts:
            continue
        candidates.append({
            "id": lm.id,
            "type": "landmark",
            "label": f"landmark ({lm.icon})",
            "content": thoughts,
            "embedding": np.asarray(embedder.embed(thoughts)),
        })

    if not candidates:
        return []

    # Map doc -> region (each doc may belong to one region in current model).
    doc_to_region: dict[str, str] = {}
    region_doc_ids: dict[str, list[str]] = defaultdict(list)
    for r in regions:
        for doc_id in r.members:
            doc_to_region[doc_id] = r.id
            region_doc_ids[r.id].append(doc_id)

    tributaries: list[Tributary] = []
    for i, step in enumerate(steps):
        step_text = f"{step.evocative_sentence}\n{step.essay_span}"
        step_emb = np.asarray(embedder.embed(step_text))

        scored = sorted(candidates, key=lambda c: -_cosine(step_emb, c["embedding"]))
        top = scored[:top_k]

        prev_ev = steps[i - 1].evocative_sentence if i > 0 else "(none — first step)"
        next_ev = steps[i + 1].evocative_sentence if i + 1 < len(steps) else "(none — last step)"
        prompt = TRIBUTARY_JUDGMENT_PROMPT.format(
            evocative=step.evocative_sentence,
            prev=prev_ev,
            next_step=next_ev,
            essay_span=step.essay_span,
            candidates=_format_candidates(top),
        )
        try:
            response = llm.complete(prompt)
            data = _parse_json(response)
        except Exception as e:
            print(f"[path] LLM judge failed on step {i+1}: {e}", flush=True)
            continue

        # Collect raw matches by type — binary explicit yes/no.
        matched_docs: set[str] = set()
        matched_landmarks: set[str] = set()
        for rel in data.get("related", []):
            if not bool(rel.get("explicit", False)):
                continue
            cid = rel.get("id")
            cand = next((c for c in top if c["id"] == cid), None)
            if not cand:
                continue
            if cand["type"] == "doc":
                matched_docs.add(cand["id"])
            elif cand["type"] == "landmark":
                matched_landmarks.add(cand["id"])

        # Drainage grouping: per region, if 2+ matched docs feed this step,
        # emit a single region tributary that carries the contributing doc ids
        # (so the renderer can draw drainage streams). Single matched docs in
        # a region become individual doc tributaries.
        consumed_doc_ids: set[str] = set()
        merged_regions = 0
        for region_id, member_ids in region_doc_ids.items():
            in_region_matched = [d for d in member_ids if d in matched_docs]
            if len(in_region_matched) < 2:
                continue
            tributaries.append(Tributary.new(
                step_id=step.id, source_type="region",
                source_id=region_id,
                contributing_doc_ids=in_region_matched,
            ))
            consumed_doc_ids.update(in_region_matched)
            merged_regions += 1

        # Individual doc tributaries for matched docs not part of any drainage.
        doc_tribs = 0
        for doc_id in matched_docs:
            if doc_id in consumed_doc_ids:
                continue
            tributaries.append(Tributary.new(
                step_id=step.id, source_type="doc",
                source_id=doc_id,
            ))
            doc_tribs += 1

        # Landmark tributaries (never merged).
        for landmark_id in matched_landmarks:
            tributaries.append(Tributary.new(
                step_id=step.id, source_type="landmark",
                source_id=landmark_id,
            ))
        landmark_tribs = len(matched_landmarks)

        print(
            f"[path] step {i+1}/{len(steps)}: "
            f"{merged_regions} region(s), {doc_tribs} doc(s), {landmark_tribs} landmark(s)",
            flush=True,
        )

    return tributaries


def run_path_algorithm(
    essay: str,
    landscape_documents: list[Document],
    landscape_regions: list[Region],
    landscape_landmarks: list[Landmark],
    llm: LLMClient,
    embedder: Embedder,
) -> Path:
    """End-to-end: essay → Path with steps + tributaries."""
    print("[path] extracting arguments from essay...", flush=True)
    steps = extract_arguments(essay, llm)
    print(f"[path] extracted {len(steps)} argument steps", flush=True)

    print(
        f"[path] finding tributaries: top-20 doc/landmark prefilter, LLM binary "
        f"explicit-related judge, region-merge if >=2 docs match...",
        flush=True,
    )
    tributaries = find_related(
        steps, landscape_documents, landscape_regions, landscape_landmarks,
        embedder, llm,
    )
    print(f"[path] {len(tributaries)} tributaries total", flush=True)

    path = Path.new()
    path.steps = steps
    path.tributaries = tributaries
    return path
