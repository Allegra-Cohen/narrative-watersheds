from __future__ import annotations

from typing import Protocol

from llm import LLMClient
from models import Document


CHUNK_CHARS = 50_000

SUMMARY_PROMPT = """Summarize the document below in 3–4 sentences. Focus on its main argument, claims, and key concepts. Be specific — name the ideas the document is actually about, not generic descriptions like "this paper discusses X."

The text was extracted automatically and may be dirty: it can contain residual HTML, navigation menus, cookie banners, footers, citation lists, page numbers, headers/footers from PDFs, or other non-content noise. Ignore that material entirely. Summarize only the substantive content of the document. If a chunk contains no substantive content, respond with exactly: "(no substantive content)".

<document>
{text}
</document>"""


META_SUMMARY_PROMPT = """Below are summaries of consecutive chunks of one long document. Combine them into a single 3–4 sentence summary of the whole document. Focus on the document's main argument, claims, and key concepts. Do not list the chunks or describe them separately — produce one cohesive summary of the document as a whole.

<chunk-summaries>
{summaries}
</chunk-summaries>"""


def build_summary_input(doc: Document) -> str:
    """Cache key for summary — invalidate if raw_text or hash changes."""
    return f"chars={len(doc.raw_text)}|hash={doc.content_hash or 'none'}"


class Summarizer(Protocol):
    def summarize(self, doc: Document) -> str: ...


class LLMSummarizer:
    """Generic summarizer that delegates the actual LLM call to any LLMClient.
    Long docs are chunked and per-chunk summaries are concatenated."""

    def __init__(self, llm: LLMClient, chunk_chars: int = CHUNK_CHARS):
        self._llm = llm
        self._chunk_chars = chunk_chars

    def summarize(self, doc: Document) -> str:
        text = doc.raw_text or ""
        if not text.strip():
            return ""
        chunks = [text[i:i + self._chunk_chars] for i in range(0, len(text), self._chunk_chars)]
        summaries: list[str] = []
        for i, chunk in enumerate(chunks):
            try:
                prompt = SUMMARY_PROMPT.format(text=chunk)
                summaries.append(self._llm.complete(prompt))
            except Exception as e:
                print(f"[summarize] chunk {i+1}/{len(chunks)} of {doc.id} failed: {e}")
        keep = [s for s in summaries if s and s.strip() != "(no substantive content)"]
        if not keep:
            return ""
        if len(keep) == 1:
            return keep[0]
        try:
            meta_prompt = META_SUMMARY_PROMPT.format(summaries="\n\n---\n\n".join(keep))
            return self._llm.complete(meta_prompt).strip()
        except Exception as e:
            print(f"[summarize] meta-summary of {doc.id} failed: {e}")
            return "\n\n".join(keep)
