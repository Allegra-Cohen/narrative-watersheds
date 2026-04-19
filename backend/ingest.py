from __future__ import annotations

from pathlib import Path
from typing import Any

import frontmatter
import trafilatura
from bs4 import BeautifulSoup
from pypdf import PdfReader

from models import Document


def ingest_file(path: Path) -> Document:
    """Read a file from disk, extract text + metadata, return a Document."""
    ext = path.suffix.lower()
    if ext == ".pdf":
        raw_text, metadata = _ingest_pdf(path)
    elif ext in (".html", ".htm"):
        raw_text, metadata = _ingest_html(path)
    elif ext in (".md", ".markdown"):
        raw_text, metadata = _ingest_markdown(path)
    else:
        raw_text, metadata = _ingest_text(path)

    metadata.setdefault("title", path.stem)
    return Document.new(raw_text=raw_text, metadata=metadata, source_filename=path.name)


def _ingest_pdf(path: Path) -> tuple[str, dict[str, Any]]:
    reader = PdfReader(str(path))

    text_chunks: list[str] = []
    for page in reader.pages:
        try:
            text_chunks.append(page.extract_text() or "")
        except Exception:
            continue
    raw_text = "\n".join(text_chunks).strip()

    metadata: dict[str, Any] = {}
    info = reader.metadata
    if info:
        if info.title:
            metadata["title"] = str(info.title).strip()
        if info.author:
            metadata["author"] = str(info.author).strip()
        if info.subject:
            metadata["subject"] = str(info.subject).strip()
        if getattr(info, "creation_date", None):
            metadata["year"] = info.creation_date.year

    return raw_text, metadata


def _ingest_html(path: Path) -> tuple[str, dict[str, Any]]:
    html = path.read_text(encoding="utf-8", errors="replace")
    soup = BeautifulSoup(html, "html.parser")

    metadata: dict[str, Any] = {}

    if soup.title and soup.title.string:
        metadata["title"] = soup.title.string.strip()

    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        metadata.setdefault("title", og_title["content"].strip())

    author_meta = soup.find("meta", attrs={"name": "author"})
    if author_meta and author_meta.get("content"):
        metadata["author"] = author_meta["content"].strip()

    description = soup.find("meta", attrs={"name": "description"})
    if description and description.get("content"):
        metadata["abstract"] = description["content"].strip()

    raw_text = trafilatura.extract(html) or ""
    if not raw_text:
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        raw_text = soup.get_text(separator="\n", strip=True)

    return raw_text, metadata


def _ingest_markdown(path: Path) -> tuple[str, dict[str, Any]]:
    post = frontmatter.load(path)
    metadata: dict[str, Any] = dict(post.metadata)
    raw_text = post.content
    return raw_text, metadata


def _ingest_text(path: Path) -> tuple[str, dict[str, Any]]:
    raw_text = path.read_text(encoding="utf-8", errors="replace")
    return raw_text, {}
