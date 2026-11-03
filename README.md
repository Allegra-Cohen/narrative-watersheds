# Narrative Watersheds

This is a tool for visualizing the narrative structure of an essay in the context of things you've already read. The tool takes in a set of references (e.g., blog posts, research papers), summarizes and embeds them, and clusters them into *regions* (e.g., "deskilling," "cognitive atrophy.") Those regions are drawn onto a map (the "Your world" tab in the viewer.) You can also add "landmark" icons to the map representing key concepts. Then, you can paste an essay you're working on into the black box in the right hand column. The tool analyzes the essay for key argument steps, then draws connections between ideas in the reference set and those steps. Your argument is drawn as a central river and the connections are drawn as tributaries, so you can visualize the contributions of what you've read to the argument you're making (the "Your path" tab in the viewer.) Warning: It does not really work! But I still like the idea.

## Classes

**Data**
- `Landscape` is the top-level container.
- `Document`, the class for the reference documents uploaded by the user. Attributes include `raw_text` (used by the Mapmaker for search), a `metadata` dict (`title`, `author`, `year`, `source`, `abstract`, etc., extracted on ingest), a `summary` (set by the clustering pipeline), and `user_notes` (free text, not currently writable by user).
- `Region`, the class that `Documents` get assigned to after clustering. `Regions` belong to a `Landscape`. `Documents` are assigned to `Regions` via `members`, a `{doc_id: weight}` map (soft clustering is allowed). `Regions` also have `summary`s written by the clustering pipeline. These are rendered with color.
- `UnchartedRegion` serves as the destination for argument steps not connected to any reference document. Rendered transparent.
- `Landmarks` are little pictures containing user notes and can belong to multiple regions.
- `Path` is the user's essay argument represented as a *river*. `Paths` have ordered lists of `PathStep`s (argument steps) plus a list of `Tributary` connections from existing landmarks and regions to a `PathStep`.
- A `PathStep` is one argument step in the user's essay, e.g., "Therefore, birds are fish." `PathSteps` contain the relevant essay text and the sentence selected by the Mapmaker as representative.
- `Tributary`, a smaller stream that connects an existing `Region` or `Landmark` to a `PathStep` on the main river. The Mapmaker draws a tributary only when the LLM thinks the source text is *explicitly* related to the PathStep (same terminology or same point). This works...a little bit.
- `Essay`, the thing the user is writing.

**Graphics** (frontend rendering, no backend classes — all in `frontend/map.js`)
Note that these are all pretty bad – the power of this tool is probably in gorgeous rendering, but right now all I've got are underwhelming Claude designs:
- Region watercolor splotches via Voronoi tessellation
- Sketchy ink tributaries via rough.js (terrible!)
- Landmark icons
- Document dots

**Services**
- A clustering algorithm. (Because clustering is Not Always Great, I also tried hooking up a spatially-organized .json from InfoBoard, my custom-built canvas organizer. This worked pretty well and it would probably not be hard to do the same with your Obsidian canvas or other visual organizer.)
- `Mapmaker` — the LLM-driven assistant that summarizes regions and extracts argument paths from essays. Currently I just have it hooked up to my Claude Code, no API key involved.

## Document ingestion

Metadata is extracted on upload from:

- **PDF**: PDF metadata block → first-page parsing → filename.
- **HTML**: `<title>`, `<meta>`, OpenGraph, Schema.org.
- **Plaintext / Markdown**: YAML frontmatter → filename + first heading.

The Mapmaker searches `raw_text` to drawn connections between argument steps and reference documents. The Region clustering algorithm can use any combination of metadata fields, `raw_text`, or `user_notes`.

## Mapmaker tools

The Mapmaker was designed as more of a writing copilot with a set of tools, but I ended up muzzling it through the GUI. Still, if you wanted to make it chatty, it has the following tools:

| Tool | Status | Notes |
|---|---|---|
| `list_documents` | allowed | read-only |
| `read_document` | allowed | read-only |
| `list_regions` | allowed | read-only |
| `read_region` | allowed | read-only; returns documents and weights |
| `list_landmarks` | allowed | read-only; lets Mapmaker be conversational about landmarks |
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

## GUI

Most of the screen is the map. A side column contains:

- **Documents** — uploaded references. You currently can't delete any via the GUI.
- **Essay** — a window for writing or pasting the text you want analyzed.

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
│   ◉ landmark  ● path-step  ····· path                   │                       │
│                                                         │                       │
│                             [Your world | Your path]    │                       │
└─────────────────────────────────────────────────────────┴───────────────────────┘
```

I originally built this imagining that the map would be projected on a wall or large e-ink tapestry. It's more about the visual vibes than the mechanics of, e.g., selecting a set of documents.
