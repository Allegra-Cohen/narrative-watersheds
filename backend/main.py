from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ingest import ingest_file
from models import Landscape
from storage import cleanup_landscape, load_landscape, load_view, save_landscape, save_view
from views import SimilarityView

BACKEND_DIR = Path(__file__).resolve().parent
ROOT = BACKEND_DIR.parent
DATA_DIR = ROOT / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
LANDSCAPE_FILE = DATA_DIR / "landscape.json"
VIEW_FILE = DATA_DIR / "view.json"
FRONTEND_DIR = ROOT / "frontend"

ALLOWED_EXTENSIONS = {".pdf", ".html", ".htm", ".md", ".markdown", ".txt"}
MIN_RAW_TEXT_CHARS = 500

app = FastAPI(title="Narrative Watersheds")

landscape: Landscape = load_landscape(LANDSCAPE_FILE)
view: SimilarityView = load_view(VIEW_FILE)

_embedder = None
_summarizer = None

# Swap to "sentence_transformers" if you want the torch-based embedder instead.
EMBEDDER_KIND = "fastembed"

# All LLM calls go through this. "claude_code" uses the user's Max subscription
# via subprocess; "anthropic" uses the API (billed). Flip to "anthropic" when
# moving past development.
LLM_KIND = "claude_code"


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
        if LLM_KIND == "claude_code":
            from llm import ClaudeCodeLLM
            _summarizer = LLMSummarizer(ClaudeCodeLLM())
        elif LLM_KIND == "anthropic":
            from llm import AnthropicLLM
            _summarizer = LLMSummarizer(AnthropicLLM())
        else:
            raise ValueError(f"unknown LLM_KIND: {LLM_KIND}")
    return _summarizer


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


@app.post("/api/cluster")
async def trigger_cluster() -> dict:
    global view
    from cluster import HDBSCANClusterer, UMAPLayout, run_clustering
    summarizer = get_summarizer()
    embedder = get_embedder()
    view = run_clustering(landscape, summarizer, embedder, HDBSCANClusterer(), UMAPLayout())
    save_landscape(landscape, LANDSCAPE_FILE)
    save_view(view, VIEW_FILE)
    return landscape_payload()


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
