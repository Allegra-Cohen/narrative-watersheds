"""Sanity-check the summarization pipeline on a few docs without mutating state.

Picks the shortest, median-length, and longest docs from the saved landscape,
runs each through the configured LLM summarizer, and prints the results.

Run from the project root with the conda env active:
    python backend/test_summarize.py
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

from llm import ClaudeCodeLLM
from storage import load_landscape
from summarize import LLMSummarizer

LANDSCAPE_FILE = BACKEND_DIR.parent / "data" / "landscape.json"


def main() -> None:
    landscape = load_landscape(LANDSCAPE_FILE)
    docs = list(landscape.documents.values())
    if len(docs) < 3:
        print(f"Need at least 3 docs in landscape, got {len(docs)}.")
        return

    sorted_docs = sorted(docs, key=lambda d: len(d.raw_text))
    samples = [
        ("shortest", sorted_docs[0]),
        ("median",   sorted_docs[len(sorted_docs) // 2]),
        ("longest",  sorted_docs[-1]),
    ]

    summarizer = LLMSummarizer(ClaudeCodeLLM())

    for label, doc in samples:
        title = doc.metadata.get("title", "(no title)")[:80]
        chars = len(doc.raw_text)
        print(f"\n=== {label}: {title} ({chars:,} chars) ===")
        t0 = time.time()
        summary = summarizer.summarize(doc)
        elapsed = time.time() - t0
        print(f"({elapsed:.1f}s)\n")
        print(summary or "(empty summary)")


if __name__ == "__main__":
    main()
