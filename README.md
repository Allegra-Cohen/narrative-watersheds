# Narrative Watersheds

> **Core principle.** The Scribe must NEVER propose landmarks or paths itself. It is fine to summarize documents associated with a region, but it must never suggest names for landmarks or connections between them. This tool must provide as much space as possible for humans to make connections themselves.

The broad idea is a tool that helps visualize your argument as you write an essay. We're going to use the metaphor of a map, where the "landscape" has information I did not write myself (like journal articles and blog posts) arranged into "regions"; key concepts are "landmarks" on the map represented by city and town icons; and arguments are represented as "paths" that visit different regions before striking out into uncharted territory.

## Stages

The tool unfolds in three stages:

1. **Getting the lay of the land** — take in a set of references and visualize the landscape with regions.
2. **Setting the scene** — place landmarks on the map.
3. **Argument building** — visualize the argument traveling through the landscape. The landscape is *re-visualized* in this stage: the y-axis represents chronological argument steps, rather than similarity as in stages 1 and 2.

The map view toggles between two perspectives:

- **Their world** (stages 1 & 2) — the landscape as the source material organizes itself, by similarity.
- **Your world** (stage 3) — the same content re-laid out by your argument's chronology.

## Classes

**Data**
- `Landscape` — top-level container.
- `Document` — a single source item. Holds `raw_text` (used by the Scribe for search), a `metadata` dict (`title`, `author`, `year`, `source`, `abstract`, etc., extracted heuristically on ingest), a `summary` (written by the clustering pipeline, not the Scribe), and `user_notes` (free text, writable by the Scribe via tool or by the user clicking the document — UI for editing deferred).
- `Region` — belongs to a `Landscape`. `members` is a `{doc_id: weight}` map (soft clustering). Holds a `summary` written by the clustering pipeline.
- `UnchartedRegion` — sibling of `Region` (not a subclass). Holds the user's original ideas / serves as the destination for path steps not grounded in any source. Rendered transparently so the user perceives the path as wandering off the map into blank space, but the object still exists for layout and for Stage 3's chronological re-positioning.
- `Landmark` — owns text summaries; can belong to multiple regions.
- `Path` — a sequence of `PathStep`s; can own multiple landmarks. Each path corresponds to a draft of the essay.
- `PathStep` — a single argument move. Holds its own text, references the landmarks/regions it visits, and (in future versions) binds to a span of the `Essay`'s prose so that reordering steps reorders the draft.
- `Essay` — the canonical prose being written. Multiple `Path`s map to drafts of this `Essay`.

**Graphics**
- `RegionBlob`
- `PathLine`
- `LandmarkIcon`
- `Mapmaker` — governs the graphics classes.

**Services**
- A clustering algorithm.
- `Scribe` — assigns user input to relevant text objects (e.g., "What do you think the key concepts are in this region?").

## GUI

Most of the screen is the map. A side column contains, IDE-style:

- **Documents** — uploaded references, treated like variables.
- **Essay** — its own editor window for the text being written.
- **Chat** — the Scribe interface.

```
┌─────────────────────────────────────────────────────────┬───────────────────────┐
│                                                         │ DOCUMENTS         [+] │
│                                                         │ ▸ smith_2021.pdf      │
│         ╭──────╮                                        │ ▸ jones_blog.html     │
│        ╱        ╲      ╭────────────╮                   │ ▸ kuhn_ch3.pdf        │
│       │  region  │    ╱              ╲                  │ ▸ notes.md            │
│       │    A    ◉│   │   region B  ◉  │                 │                       │
│        ╲        ╱    │      ◉         │                 ├───────────────────────┤
│         ╰──────╯      ╲              ╱                  │ ESSAY                 │
│              ●·····●···◉············◉                   │ ┌───────────────────┐ │
│                              ╲      ╱                   │ │ # Working title   │ │
│                               ╰────╯                    │ │                   │ │
│                  ╭──────────╮                           │ │ Lorem ipsum...    │ │
│                 ╱            ╲                          │ │ |                 │ │
│                │  region C    │                         │ │                   │ │
│                │  ◉           │                         │ │                   │ │
│                 ╲            ╱                          │ └───────────────────┘ │
│                  ╰──────────╯                           ├───────────────────────┤
│                                                         │ CHAT                  │
│   ◉ landmark  ● path-step  ····· path                   │ > what concepts       │
│                                                         │   anchor region B?    │
│                                       [Stage 1│2│3]    │ ___________________   │
└─────────────────────────────────────────────────────────┴───────────────────────┘
```

Eventually the map may live on a separate surface (e.g., projected on a wall), so the proportions of the side column are not load-bearing.

## Roadmap

- [ ] Improve document ingestion (HTML especially — handle captcha/interstitial pages, recover non-text PDFs).
  - [ ] When a document has a real abstract in its metadata, skip the LLM summary step and use the abstract instead — don't summarize redundantly.
  - [ ] For very long documents, consider splitting sections into their own `Document` objects rather than summarizing the whole thing as one.
- [ ] Investigate specialized summarizers for academic literature (scientific-paper-aware models) as drop-in replacements via the `Summarizer` protocol.

## Document ingestion

Metadata is extracted on upload — never typed by the user.

- **PDF**: PDF metadata block → first-page parsing → filename.
- **HTML**: `<title>`, `<meta>`, OpenGraph, Schema.org.
- **Plaintext / Markdown**: YAML frontmatter → filename + first heading.

For academic papers, a later version can enrich extracted titles via the Crossref or Semantic Scholar API to get canonical author lists, year, journal, abstract, DOI.

The Scribe searches `raw_text`. Clustering algorithms can use any combination of metadata fields, `raw_text`, or `user_notes`.

## Scribe tools

The Scribe's behavior is governed by two layers:

1. **The system prompt**, which enforces the core principle absolutely from day one — the Scribe never *initiates* a landmark, path, or connection; it only acts on them when explicitly directed by the user.
2. **The tool surface**, which starts permissive and is tightened as testing reveals where the prompt alone isn't enough.

The table below is the source of truth for the tool surface. Update it as tools are hidden, split, or restricted.

> Summarization (document and region `summary` fields) is the clustering pipeline's job — not exposed to the Scribe. This may change later.

| Tool | Status | Notes |
|---|---|---|
| `list_documents` | allowed | read-only |
| `read_document` | allowed | read-only |
| `list_regions` | allowed | read-only |
| `read_region` | allowed | read-only; returns documents and weights |
| `list_landmarks` | allowed | read-only; lets Scribe be conversational about landmarks |
| `list_paths` | allowed | read-only |
| `add_document` | allowed | ingest a new document |
| `write_document_notes` | allowed | writes to `user_notes`; user can also edit by clicking the document (UI deferred) |
| `attach_document_to_region` | allowed | with weight (soft clustering) |
| `detach_document_from_region` | allowed | |
| `recluster` | allowed | re-runs the clustering algorithm |
| `name_region` | allowed | descriptive labels only; tighten if interpretive naming creeps in |
| `create_landmark` | allowed | only when user explicitly directs (per core principle) |
| `rename_landmark` | allowed | only when user explicitly directs |
| `place_landmark_in_region` | allowed | only when user explicitly directs |
| `create_path` | allowed | only when user explicitly directs |
| `add_path_step` | allowed | only when user explicitly directs |
| `connect_landmarks` | allowed | only when user explicitly directs |

