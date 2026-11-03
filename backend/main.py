from __future__ import annotations

import hashlib
import os
from pathlib import Path

# Silence the noisy "tokenizers parallelism" warning from HuggingFace,
# which fires every time FastEmbed is used after uvicorn forks workers.
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ingest import ingest_file
from models import Landmark, Landscape, VALID_LANDMARK_ICONS
from storage import cleanup_landscape, load_landscape, load_view, save_landscape, save_view
from views import SimilarityView

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
DATA_DIR = REPO_ROOT / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
LANDSCAPE_FILE = DATA_DIR / "landscape.json"
VIEW_FILE = DATA_DIR / "view.json"
FRONTEND_DIR = REPO_ROOT / "frontend"

ALLOWED_EXTENSIONS = {".pdf", ".html", ".htm", ".md", ".markdown", ".txt"}
MIN_RAW_TEXT_CHARS = 500

app = FastAPI(title="Narrative Watersheds")

landscape: Landscape = load_landscape(LANDSCAPE_FILE)
view: SimilarityView = load_view(VIEW_FILE)

_embedder = None
_summarizer = None
_llm = None

# Swap to "sentence_transformers" if you want the torch-based embedder instead.
EMBEDDER_KIND = "fastembed"

# All LLM calls go through this. "claude_code" uses the user's Max subscription
# via subprocess; "anthropic" uses the API (billed). Flip to "anthropic" when
# moving past development.
LLM_KIND = "claude_code"

# "hard": each doc gets at most one cluster. "soft": each doc has weights across
# clusters (filtered by min_membership). Toggle to compare.
CLUSTERER_MODE = "hard"


def get_embedder():
    """Lazy-load the embedder on first use."""
    global _embedder
    if _embedder is None:
        if EMBEDDER_KIND == "fastembed":
            from cluster import FastEmbedEmbedder
            _embedder = FastEmbedEmbedder()
        elif EMBEDDER_KIND == "sentence_transformers":
            from cluster import SentenceTransformerEmbedder
            _embedder = SentenceTransformerEmbedder()
        else:
            raise ValueError(f"unknown EMBEDDER_KIND: {EMBEDDER_KIND}")
    return _embedder


def get_summarizer():
    """Lazy-load the summarizer on first use."""
    global _summarizer
    if _summarizer is None:
        from summarize import LLMSummarizer
        _summarizer = LLMSummarizer(get_llm())
    return _summarizer


def get_llm():
    """Lazy-load the configured LLM client on first use."""
    global _llm
    if _llm is None:
        if LLM_KIND == "claude_code":
            from llm import ClaudeCodeLLM
            _llm = ClaudeCodeLLM()
        elif LLM_KIND == "anthropic":
            from llm import AnthropicLLM
            _llm = AnthropicLLM()
        else:
            raise ValueError(f"unknown LLM_KIND: {LLM_KIND}")
    return _llm


def region_centroids() -> dict[str, tuple[float, float]]:
    """Compute the normalized [0,1] centroid of each region from member doc positions."""
    result: dict[str, tuple[float, float]] = {}
    for region in landscape.regions.values():
        coords = [view.positions[doc_id] for doc_id in region.members if doc_id in view.positions]
        if not coords:
            continue
        cx = sum(c[0] for c in coords) / len(coords)
        cy = sum(c[1] for c in coords) / len(coords)
        result[region.id] = (cx, cy)
    return result


def landscape_payload() -> dict:
    return {
        "documents": [doc.public_view() for doc in landscape.documents.values()],
        "regions": [
            {
                "id": region.id,
                "name": region.name,
                "members": region.members,
                "summary": region.summary,
            }
            for region in landscape.regions.values()
        ],
        "landmarks": [lm.to_dict() for lm in landscape.landmarks.values()],
        "path": landscape.path.to_dict() if landscape.path else None,
        "positions": {doc_id: list(pos) for doc_id, pos in view.positions.items()},
        "is_dirty": landscape.is_dirty,
    }


@app.post("/api/documents")
async def upload_documents(files: list[UploadFile] = File(...)) -> dict:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    added: list[dict] = []
    skipped: list[dict] = []

    existing_filenames = {d.source_filename for d in landscape.documents.values() if d.source_filename}
    existing_hashes = {d.content_hash for d in landscape.documents.values() if d.content_hash}

    for upload in files:
        original_name = Path(upload.filename or "unnamed").name
        ext = Path(original_name).suffix.lower()

        if ext not in ALLOWED_EXTENSIONS:
            skipped.append({"name": original_name, "reason": f"unsupported extension: {ext or '(none)'}"})
            continue

        file_bytes = await upload.read()
        content_hash = hashlib.sha256(file_bytes).hexdigest()

        if original_name in existing_filenames:
            skipped.append({"name": original_name, "reason": "duplicate (same filename)"})
            continue
        if content_hash in existing_hashes:
            skipped.append({"name": original_name, "reason": "duplicate (same content)"})
            continue

        temp_path = UPLOADS_DIR / f"_incoming_{original_name}"
        temp_path.write_bytes(file_bytes)

        try:
            doc = ingest_file(temp_path)
        except Exception as e:
            temp_path.unlink(missing_ok=True)
            skipped.append({"name": original_name, "reason": f"ingestion failed: {e}"})
            continue

        if len(doc.raw_text) < MIN_RAW_TEXT_CHARS:
            temp_path.unlink(missing_ok=True)
            skipped.append({"name": original_name, "reason": f"too little text ({len(doc.raw_text)} chars)"})
            continue

        final_path = UPLOADS_DIR / f"{doc.id}_{original_name}"
        temp_path.rename(final_path)
        doc.source_filename = original_name
        doc.content_hash = content_hash
        landscape.add_document(doc)
        added.append(doc.public_view())

        existing_filenames.add(original_name)
        existing_hashes.add(content_hash)

    cleanup_landscape(landscape)
    save_landscape(landscape, LANDSCAPE_FILE)
    return {"added": added, "skipped": skipped, "is_dirty": landscape.is_dirty}


@app.get("/api/documents")
async def list_documents() -> dict:
    return {"documents": [doc.public_view() for doc in landscape.documents.values()]}


@app.get("/api/landscape")
async def get_landscape() -> dict:
    return landscape_payload()


@app.post("/api/landmarks")
async def create_landmark(payload: dict) -> dict:
    icon = payload.get("icon")
    position = payload.get("position")
    if icon not in VALID_LANDMARK_ICONS:
        raise HTTPException(status_code=400, detail=f"icon must be one of {VALID_LANDMARK_ICONS}")
    if not isinstance(position, list) or len(position) != 2:
        raise HTTPException(status_code=400, detail="position must be [x, y]")
    landmark = Landmark.new(icon=icon, position=(float(position[0]), float(position[1])))
    landscape.add_landmark(landmark)
    save_landscape(landscape, LANDSCAPE_FILE)
    return landmark.to_dict()


@app.patch("/api/landmarks/{landmark_id}")
async def update_landmark(landmark_id: str, payload: dict) -> dict:
    landmark = landscape.landmarks.get(landmark_id)
    if not landmark:
        raise HTTPException(status_code=404, detail="landmark not found")
    if "icon" in payload:
        if payload["icon"] not in VALID_LANDMARK_ICONS:
            raise HTTPException(status_code=400, detail=f"icon must be one of {VALID_LANDMARK_ICONS}")
        landmark.icon = payload["icon"]
    if "position" in payload:
        position = payload["position"]
        if not isinstance(position, list) or len(position) != 2:
            raise HTTPException(status_code=400, detail="position must be [x, y]")
        landmark.position = (float(position[0]), float(position[1]))
    if "thoughts" in payload:
        landmark.thoughts = str(payload["thoughts"])
    save_landscape(landscape, LANDSCAPE_FILE)
    return landmark.to_dict()


@app.delete("/api/landmarks/{landmark_id}")
async def delete_landmark(landmark_id: str) -> dict:
    if landmark_id not in landscape.landmarks:
        raise HTTPException(status_code=404, detail="landmark not found")
    del landscape.landmarks[landmark_id]
    # Drop any tributaries that referenced this landmark.
    if landscape.path:
        landscape.path.tributaries = [
            t for t in landscape.path.tributaries
            if not (t.source_type == "landmark" and t.source_id == landmark_id)
        ]
    save_landscape(landscape, LANDSCAPE_FILE)
    return {"status": "deleted", "id": landmark_id}


@app.post("/api/landmarks/{landmark_id}/confirm")
async def confirm_landmark(landmark_id: str) -> dict:
    landmark = landscape.landmarks.get(landmark_id)
    if not landmark:
        raise HTTPException(status_code=404, detail="landmark not found")
    landmark.pending = False
    save_landscape(landscape, LANDSCAPE_FILE)
    return landmark.to_dict()


@app.post("/api/path/trace")
async def trace_path_endpoint(payload: dict) -> dict:
    from path_algorithm import run_path_algorithm

    essay = (payload.get("essay") or "").strip()
    print(f"[trace] received request, essay length: {len(essay)} chars", flush=True)
    if not essay:
        raise HTTPException(status_code=400, detail="essay text required")

    landscape.path = None
    try:
        landscape.path = run_path_algorithm(
            essay,
            list(landscape.documents.values()),
            list(landscape.regions.values()),
            list(landscape.landmarks.values()),
            get_llm(),
            get_embedder(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"trace failed: {e}")

    save_landscape(landscape, LANDSCAPE_FILE)
    return landscape_payload()


@app.get("/api/path")
async def get_path() -> dict:
    return {"path": landscape.path.to_dict() if landscape.path else None}


@app.delete("/api/path")
async def clear_path() -> dict:
    # Also remove pending landmarks (they were proposed for this path)
    pending_ids = [lid for lid, lm in landscape.landmarks.items() if lm.pending]
    for lid in pending_ids:
        del landscape.landmarks[lid]
    landscape.path = None
    save_landscape(landscape, LANDSCAPE_FILE)
    return {"status": "cleared", "removed_pending_landmarks": len(pending_ids)}


@app.post("/api/cluster")
async def trigger_cluster() -> dict:
    global view
    from cluster import HDBSCANClusterer, UMAPLayout, run_clustering
    summarizer = get_summarizer()
    embedder = get_embedder()
    clusterer = HDBSCANClusterer(mode=CLUSTERER_MODE)
    view = run_clustering(landscape, summarizer, embedder, clusterer, UMAPLayout())
    save_landscape(landscape, LANDSCAPE_FILE)
    save_view(view, VIEW_FILE)
    return landscape_payload()


@app.post("/api/landmarks/relocate")
async def relocate_landmarks_endpoint() -> dict:
    from relocate import relocate_landmarks
    n = relocate_landmarks(landscape, view, get_embedder())
    save_landscape(landscape, LANDSCAPE_FILE)
    return {"relocated": n}


@app.get("/api/documents/{doc_id}")
async def get_document(doc_id: str) -> dict:
    doc = landscape.documents.get(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="document not found")
    return doc.to_dict()


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "documents": len(landscape.documents), "regions": len(landscape.regions)}


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
