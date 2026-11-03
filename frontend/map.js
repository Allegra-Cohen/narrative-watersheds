// SVG map rendering — Voronoi tessellation of regions, rendered as
// watercolor territories that partition the whole canvas. Document dots
// sit on top at their original positions.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Jewel-tone palette — colors are assigned per region by a hash of the
// region's id (see regionColor) so they stay stable across the world and
// path views, and survive region reordering.
const PALETTE = [
    '#2d5a3e',  // forest green
    '#6d8e4e',  // moss green
    '#b8841a',  // ochre
    '#d9a93a',  // samovar yellow
    '#b35e3f',  // terra cotta
    '#c4581e',  // burnt orange
    '#2e6777',  // deep teal
];

function regionColor(region) {
    return PALETTE[hashCode(region.id) % PALETTE.length];
}

const FAKE_LANDSCAPE = {
    regions: [
        { id: 'r1', members: { d1: 1.0, d2: 1.0, d3: 1.0, d4: 0.7, d5: 0.5 } },
        { id: 'r2', members: { d6: 1.0, d7: 1.0, d8: 1.0, d9: 1.0, d10: 0.6, d11: 0.4 } },
        { id: 'r3', members: { d12: 1.0, d13: 1.0, d14: 0.8 } },
        { id: 'r4', members: { d15: 1.0, d16: 1.0, d17: 0.8, d18: 0.5, d19: 0.4, d20: 0.3, d21: 0.3 } },
        { id: 'r5', members: { d22: 1.0, d23: 1.0, d24: 1.0, d25: 0.6 } },
    ],
    positions: {
        d1: [0.25, 0.18], d2: [0.28, 0.16], d3: [0.22, 0.21], d4: [0.30, 0.20], d5: [0.26, 0.24],
        d6: [0.50, 0.38], d7: [0.53, 0.36], d8: [0.48, 0.41], d9: [0.55, 0.40], d10: [0.46, 0.44], d11: [0.58, 0.35],
        d12: [0.72, 0.18], d13: [0.75, 0.20], d14: [0.70, 0.16],
        d15: [0.25, 0.52], d16: [0.29, 0.56], d17: [0.33, 0.50], d18: [0.27, 0.48], d19: [0.31, 0.44], d20: [0.23, 0.47], d21: [0.35, 0.54],
        d22: [0.72, 0.52], d23: [0.76, 0.55], d24: [0.68, 0.50], d25: [0.79, 0.47],
    },
};

const ICONS = {
    castle: [
        "M3 20 L3 11 L5 11 L5 9 L7 9 L7 11 L9 11 L9 8 L11 8 L11 6 L13 6 L13 8 L15 8 L15 11 L17 11 L17 9 L19 9 L19 11 L21 11 L21 20 Z",
        "M11 20 L11 15 L13 15 L13 20",
    ],
    city: [
        "M2 20 L2 12 L6 12 L6 8 L10 8 L10 4 L14 4 L14 10 L18 10 L18 14 L22 14 L22 20 Z",
    ],
    town: [
        "M3 20 L3 14 L7 10 L11 14 L11 20 Z",
        "M12 20 L12 13 L16 9 L20 13 L20 20 Z",
    ],
    bridge: [
        "M2 17 Q12 6 22 17",
        "M2 17 L2 19 L22 19 L22 17",
        "M7 19 L7 22",
        "M17 19 L17 22",
    ],
    lighthouse: [
        "M9 22 L10 8 L14 8 L15 22 Z",
        "M8 8 L16 8 L16 6 L8 6 Z",
        "M10 6 L10 4 L14 4 L14 6",
        "M12 4 L12 2",
    ],
};

// Voronoi territory occupies the upper-center two-thirds of the canvas:
// horizontal margin = 1/6 of width on each side; vertical extends from
// MARGIN at the top down to BOTTOM_FRAC of canvas height. Bottom third
// stays blank for uncharted territory / paths.
const MARGIN = 40;
const HORIZ_MARGIN_FRAC = 1 / 6;
const BOTTOM_FRAC = 2 / 3;

// Path-view grid: invisible NxN grid over the canvas that sources (regions,
// landmarks, single docs) are placed into. The river runs centered. If N is
// odd, the middle column is the river's lane and is skipped for sources.
const GRID_N = 5;

// Minimum vertical gap (px) required between a source's origin and its step
// on the river. Ensures the tributary always has a strictly-downward flow.
const TRIB_MIN_SPACING_Y = 24;

function renderMap(landscape) {
    const svg = document.querySelector('.map-canvas');
    if (!svg) return;

    const width = svg.clientWidth;
    const height = svg.clientHeight;

    let content = svg.querySelector('.map-content');
    if (content) content.remove();
    content = document.createElementNS(SVG_NS, 'g');
    content.setAttribute('class', 'map-content');
    svg.appendChild(content);

    // Map normalized [0,1] positions into the upper-center 2/3 of the canvas.
    const x0 = width * HORIZ_MARGIN_FRAC;
    const x1 = width * (1 - HORIZ_MARGIN_FRAC);
    const y0 = MARGIN;
    const y1 = height * BOTTOM_FRAC;

    // Always lay things out using the world (source-truth) positions. The
    // path view repositions tributary sources via SVG transforms — it doesn't
    // change the underlying data layout.
    const docPositions = landscape.positions || {};
    const landmarkPositions = Object.fromEntries((landscape.landmarks || []).map(l => [l.id, l.position]));

    const screenPos = {};
    for (const [docId, pos] of Object.entries(docPositions)) {
        const sx = x0 + pos[0] * (x1 - x0);
        const sy = y0 + pos[1] * (y1 - y0);
        screenPos[docId] = [sx, sy];
    }

    const defs = ensureDefs(svg);

    // Layer order matters for z-stacking. River + tributaries paint first
    // so dots, doc labels, landmarks, and flags all sit on top of them.
    const splotchLayer = document.createElementNS(SVG_NS, 'g');
    splotchLayer.setAttribute('class', 'splotch-layer');
    content.appendChild(splotchLayer);

    const riverLayer = document.createElementNS(SVG_NS, 'g');
    riverLayer.setAttribute('class', 'river-layer');
    content.appendChild(riverLayer);

    const dotLayer = document.createElementNS(SVG_NS, 'g');
    dotLayer.setAttribute('class', 'dot-layer');
    content.appendChild(dotLayer);

    const landmarkLayer = document.createElementNS(SVG_NS, 'g');
    landmarkLayer.setAttribute('class', 'landmark-layer');
    content.appendChild(landmarkLayer);

    const flagLayer = document.createElementNS(SVG_NS, 'g');
    flagLayer.setAttribute('class', 'flag-layer');
    content.appendChild(flagLayer);

    // Backwards-compat: earlier code referenced pathLayer for both river and flags.
    const pathLayer = riverLayer;

    // Compute weighted centroids + Voronoi cells (used by both views — world
    // for the actual rendered tessellation, path for the source shape preserved
    // when we move a region above its earliest tributary's step).
    const regions = landscape.regions || [];
    const centroids = regions.map(region => {
        const entries = Object.entries(region.members || {});
        let sumX = 0, sumY = 0, sumW = 0;
        for (const [id, w] of entries) {
            const p = screenPos[id];
            if (!p) continue;
            sumX += p[0] * w;
            sumY += p[1] * w;
            sumW += w;
        }
        if (sumW === 0) return null;
        return [sumX / sumW, sumY / sumW];
    });
    const cells = computeVoronoiCells(centroids, x0, y0, x1, y1);

    const docsById = {};
    for (const doc of (landscape.documents || [])) {
        docsById[doc.id] = doc;
    }

    if (_viewMode === 'world') {
        renderWorldView({
            regions, cells, screenPos, docsById,
            landmarks: landscape.landmarks || [], landmarkPositions,
            x0, y0, x1, y1,
            splotchLayer, dotLayer, landmarkLayer, defs,
        });
    } else if (_viewMode === 'path' && landscape.path && landscape.path.steps && landscape.path.steps.length) {
        renderPathView({
            landscape, regions, cells, screenPos, docsById,
            landmarkPositions,
            x0, y0, x1, y1, width, height,
            splotchLayer, dotLayer, landmarkLayer,
            riverLayer, flagLayer, defs,
        });
    }

    setupTooltipHandlers();
    setupLandmarkInteractions();
}

function renderWorldView(ctx) {
    const { regions, cells, screenPos, docsById, landmarks, landmarkPositions,
            x0, y0, x1, y1, splotchLayer, dotLayer, landmarkLayer, defs } = ctx;

    regions.forEach((region, i) => {
        const cell = cells[i];
        if (!cell) return;
        renderCellSplotch(splotchLayer, defs, region, cell, regionColor(region));
        if (region.name) {
            const [cx, cy] = polygonCentroid(cell);
            splotchLayer.appendChild(makeRegionLabel(region.name, cx, cy));
        }
    });

    for (const [docId, [cx, cy]] of Object.entries(screenPos)) {
        dotLayer.appendChild(makeDocDot(docId, cx, cy, docsById[docId]));
    }

    for (const lm of landmarks) {
        const pos = landmarkPositions[lm.id] || lm.position;
        renderLandmarkIcon(landmarkLayer, lm, x0 + pos[0] * (x1 - x0), y0 + pos[1] * (y1 - y0));
    }
}

function renderPathView(ctx) {
    const { landscape, regions, cells, screenPos, docsById, landmarkPositions,
            x0, y0, x1, y1, width, height,
            splotchLayer, dotLayer, landmarkLayer,
            riverLayer, flagLayer, defs } = ctx;

    const path = landscape.path;
    // Path-view river uses an extended y range — flows past the upper-center
    // territory bound down toward the canvas bottom for a longer river.
    const riverY1 = height - MARGIN;
    const stepPositions = computeRiverPositions(path.steps, x0, y0, x1, riverY1, hashCode(path.id || 'river'));

    // Identify unique tributary sources + their earliest step index
    const sources = new Map(); // key "type:id" -> {type, id, earliestStepIdx, key}
    for (const trib of (path.tributaries || [])) {
        const stepIdx = path.steps.findIndex(s => s.id === trib.step_id);
        if (stepIdx < 0) continue;
        const key = `${trib.source_type}:${trib.source_id}`;
        const cur = sources.get(key);
        if (!cur || stepIdx < cur.earliestStepIdx) {
            sources.set(key, { type: trib.source_type, id: trib.source_id, earliestStepIdx: stepIdx, key });
        }
    }

    // Place sources into the invisible NxN grid. Rules:
    //   1. For each source (chronological by earliest referencing step), pick
    //      the grid cell closest to that step whose row is not strictly below
    //      the step's row. "Above or same row" is allowed; "below" is not.
    //   2. If the closest cell is taken, extend outward to the next-nearest
    //      available cell in the allowed region.
    //   3. If no cell in the allowed region is empty, split cells: re-run
    //      with max_occupants=2 (pack two sources per cell), then 3, etc.
    // sourceOrigins[key] is the bottom-center of each source's splotch — the
    // point the main tributary emerges from. Drainage streams also route to
    // this point so hovering the splotch reveals the docs "draining" into
    // where the river then leaves from.
    const { sourcePolygons, sourceOrigins, cellOccupancy } =
        placeSourcesInGrid(sources, stepPositions, width, height);

    // Build region/landmark lookups
    const regionsById = {};
    regions.forEach((r, i) => { regionsById[r.id] = { region: r, cell: cells[i], idx: i }; });
    const landmarksById = {};
    for (const lm of (landscape.landmarks || [])) landmarksById[lm.id] = lm;

    // For drainage rendering: each member doc's transformed position (after
    // the region's translate+scale) so drainage streams can be drawn from
    // these points to the collection point.
    const docPositionsInPathView = {};

    // Chronological rendering order, matching placement order.
    const orderedSources = [...sources.values()].sort((a, b) => {
        if (a.earliestStepIdx !== b.earliestStepIdx) return a.earliestStepIdx - b.earliestStepIdx;
        return a.key.localeCompare(b.key);
    });

    for (const src of orderedSources) {
        const key = src.key;
        const sourceCell = sourcePolygons.get(key);
        if (!sourceCell) continue;

        if (src.type === 'region') {
            const entry = regionsById[src.id];
            if (!entry) continue;
            const { docPositions } = renderMovedRegion({
                splotchLayer, defs,
                region: entry.region,
                docsById,
                screenPos,
                color: regionColor(entry.region),
                sourceCell,
                sourceKey: key,
            });
            Object.assign(docPositionsInPathView, docPositions);
        } else if (src.type === 'landmark') {
            const lm = landmarksById[src.id];
            if (!lm) continue;
            renderMovedLandmark({
                splotchLayer, landmarkLayer, defs,
                landmark: lm,
                color: PALETTE[hashCode(lm.id) % PALETTE.length],
                sourceCell,
                sourceKey: key,
            });
        } else if (src.type === 'doc') {
            const doc = docsById[src.id];
            if (!doc) continue;
            const docRegion = regions.find(r => (r.members || {})[src.id] != null);
            const docRegionEntry = docRegion ? regionsById[docRegion.id] : null;
            if (docRegionEntry) {
                const { docPositions } = renderMovedRegion({
                    splotchLayer, defs,
                    region: docRegionEntry.region,
                    docsById,
                    screenPos,
                    color: regionColor(docRegionEntry.region),
                    sourceCell,
                    onlyDocIds: [src.id],
                    sourceKey: key,
                });
                Object.assign(docPositionsInPathView, docPositions);
            } else {
                const [cx, cy] = polygonCentroid(sourceCell);
                const wp = screenPos[src.id];
                const worldOffset = wp ? [wp[0] - cx, wp[1] - cy] : null;
                renderMovedDoc(dotLayer, doc, { x: cx, y: cy }, key, worldOffset);
            }
        }
    }

    // River + tributaries (in riverLayer, behind everything) + flags (in
    // flagLayer, on top of everything).
    renderPath(riverLayer, flagLayer, path, stepPositions, sourceOrigins, sources,
               docPositionsInPathView, x0, y0, x1, y1);

    setupDrainageHover(splotchLayer);
}

function placeSourcesInGrid(sources, stepPositions, width, height) {
    const gridX0 = MARGIN;
    const gridX1 = width - MARGIN;
    const gridY0 = MARGIN;
    const gridY1 = height - MARGIN;
    const cellW = (gridX1 - gridX0) / GRID_N;
    const cellH = (gridY1 - gridY0) / GRID_N;
    const riverCol = (GRID_N % 2 === 1) ? Math.floor(GRID_N / 2) : -1;

    const cellBounds = (row, col) => {
        const cx0 = gridX0 + col * cellW;
        const cy0 = gridY0 + row * cellH;
        return {
            row, col,
            x0: cx0, y0: cy0,
            x1: cx0 + cellW, y1: cy0 + cellH,
            cx: cx0 + cellW / 2,
            cy: cy0 + cellH / 2,
        };
    };

    // Usable cells (skip the river column if N is odd)
    const usable = [];
    for (let row = 0; row < GRID_N; row++) {
        for (let col = 0; col < GRID_N; col++) {
            if (col === riverCol) continue;
            usable.push(cellBounds(row, col));
        }
    }

    const occupancy = new Map(); // "row,col" -> array of source keys
    const sourceToCell = new Map(); // key -> cellBounds

    const orderedSources = [...sources.values()].sort((a, b) => {
        if (a.earliestStepIdx !== b.earliestStepIdx) return a.earliestStepIdx - b.earliestStepIdx;
        return a.key.localeCompare(b.key);
    });

    for (const src of orderedSources) {
        const step = stepPositions[src.earliestStepIdx];
        // Primary: cells fully above the step with a buffer. For steps near
        // the top of the canvas (where no full row fits above), loosen
        // progressively so we never silently drop a source. Down-flow is
        // still guaranteed by clamping each source's origin y (below).
        let candidates = usable.filter(c => c.y1 <= step[1] - TRIB_MIN_SPACING_Y);
        if (candidates.length === 0) {
            candidates = usable.filter(c => c.y0 < step[1] - TRIB_MIN_SPACING_Y);
        }
        if (candidates.length === 0) {
            candidates = usable.filter(c => c.y0 < step[1]);
        }
        if (candidates.length === 0) candidates = usable.slice();

        let placed = false;
        for (let maxOcc = 1; maxOcc <= GRID_N * GRID_N; maxOcc++) {
            const available = candidates
                .filter(c => (occupancy.get(`${c.row},${c.col}`) || []).length < maxOcc)
                .sort((a, b) => {
                    const da = Math.hypot(a.cx - step[0], a.cy - step[1]);
                    const db = Math.hypot(b.cx - step[0], b.cy - step[1]);
                    return da - db;
                });
            if (available.length > 0) {
                const best = available[0];
                const k = `${best.row},${best.col}`;
                if (!occupancy.has(k)) occupancy.set(k, []);
                occupancy.get(k).push(src.key);
                sourceToCell.set(src.key, best);
                placed = true;
                break;
            }
        }
        if (!placed) {
            // Shouldn't happen (GRID_N*GRID_N pass always fits), but never
            // silently drop — park off-grid above the step.
            sourceToCell.set(src.key, {
                row: -1, col: -1,
                x0: step[0] - cellW / 2, x1: step[0] + cellW / 2,
                y0: Math.max(0, step[1] - cellH), y1: step[1],
                cx: step[0], cy: step[1] - cellH / 2,
            });
        }
    }

    // sourcePolygons: per-source cell polygon (rectangle or sub-Voronoi).
    // sourceOrigins: per-source tributary emergence point, computed in a
    // second pass (see below) because it needs the step's y to clamp for
    // strict down-flow.
    const sourcePolygons = new Map();
    const sourceOrigins = new Map();
    const recordSource = (key, poly) => {
        sourcePolygons.set(key, poly);
    };
    for (const [cellKey, occupants] of occupancy) {
        const [row, col] = cellKey.split(',').map(Number);
        const cb = cellBounds(row, col);
        const rect = [[cb.x0, cb.y0], [cb.x1, cb.y0], [cb.x1, cb.y1], [cb.x0, cb.y1]];
        if (occupants.length === 1) {
            recordSource(occupants[0], rect);
        } else {
            // Seed horizontally across the cell so packed sources get vertical
            // slices. Falls back to the raw rect if d3 is unavailable.
            const seeds = occupants.map((_, i) => {
                const t = (i + 0.5) / occupants.length;
                return [cb.x0 + t * (cb.x1 - cb.x0), cb.cy];
            });
            if (typeof d3 !== 'undefined') {
                const delaunay = d3.Delaunay.from(seeds);
                const voronoi = delaunay.voronoi([cb.x0, cb.y0, cb.x1, cb.y1]);
                occupants.forEach((key, i) => {
                    const poly = voronoi.cellPolygon(i);
                    if (poly) recordSource(key, poly.slice(0, -1));
                    else recordSource(key, rect);
                });
            } else {
                occupants.forEach(key => recordSource(key, rect));
            }
        }
    }

    // Sources that fell off-grid (sourceToCell but not in occupancy): give
    // them their raw rect so the renderer still has something to draw.
    for (const [key, cb] of sourceToCell) {
        if (sourcePolygons.has(key)) continue;
        recordSource(key, [[cb.x0, cb.y0], [cb.x1, cb.y0], [cb.x1, cb.y1], [cb.x0, cb.y1]]);
    }

    // Origin pass: the tributary emerges from the side of the splotch that
    // faces the river (so the run toward the river is natural), at a y
    // that is clamped to at least TRIB_MIN_SPACING_Y above the step. For
    // edge cases where the splotch extends below the safe zone, the origin
    // floats just inside the splotch or, if the entire splotch is below the
    // safe zone, on top of it — down-flow is guaranteed either way.
    const riverMidX = (gridX0 + gridX1) / 2;
    for (const src of orderedSources) {
        const key = src.key;
        const poly = sourcePolygons.get(key);
        if (!poly) continue;
        const stepY = stepPositions[src.earliestStepIdx][1];
        const inner = inflate(poly, -10);
        const [innerCx, innerCy] = polygonCentroid(inner);
        const [minX, minY, maxX, maxY] = polygonAABB(inner);
        const originX = innerCx < riverMidX ? maxX : minX;
        const safeY = stepY - TRIB_MIN_SPACING_Y;
        const natural = innerCy + (maxY - innerCy) * 0.4;
        let originY = Math.min(natural, safeY);
        if (originY < minY) originY = minY;
        if (originY > safeY) originY = safeY;
        sourceOrigins.set(key, [originX, originY]);
    }

    return { sourcePolygons, sourceOrigins, cellOccupancy: occupancy };
}

function setupDrainageHover(root) {
    // Drainage streams are hidden by default; hovering a source element
    // (the splotch+dots group, or the fallback doc group) reveals the
    // streams tagged with the same data-source-key. Drainage streams
    // themselves carry data-source-key, so exclude them from triggers.
    const scope = root && root.ownerSVGElement ? root.ownerSVGElement : document;
    scope.querySelectorAll('[data-source-key]:not(.drainage-stream)').forEach(el => {
        const key = el.dataset.sourceKey;
        if (!key) return;
        const streams = scope.querySelectorAll(
            `.drainage-stream[data-source-key="${CSS.escape(key)}"]`
        );
        if (!streams.length) return;
        el.addEventListener('mouseenter', () => {
            streams.forEach(s => s.classList.add('drainage-visible'));
        });
        el.addEventListener('mouseleave', () => {
            streams.forEach(s => s.classList.remove('drainage-visible'));
        });
    });
}

function renderMovedDoc(parent, doc, target, sourceKey, worldOffset) {
    // Wrapper holds the slide animation (CSS transform on --world-dx/dy).
    // Inner group holds the static SVG transform for positioning so the CSS
    // transform on the wrapper composes with it instead of overwriting.
    const wrapper = document.createElementNS(SVG_NS, 'g');
    if (worldOffset) {
        wrapper.style.setProperty('--world-dx', `${worldOffset[0]}px`);
        wrapper.style.setProperty('--world-dy', `${worldOffset[1]}px`);
        wrapper.classList.add('path-anim-doc-travel');
    }

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'moved-doc-source');
    g.setAttribute('transform', `translate(${target.x} ${target.y})`);
    if (sourceKey) g.dataset.sourceKey = sourceKey;

    const titleText = (doc.metadata && doc.metadata.title) || doc.source_filename || 'Untitled';
    const author = doc.metadata && doc.metadata.author;
    const tooltip = author ? `${titleText}\n${author}` : titleText;

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', 0);
    dot.setAttribute('cy', 0);
    dot.setAttribute('r', 6);
    dot.setAttribute('fill', '#3a2f22');
    dot.setAttribute('class', 'doc-dot');
    dot.dataset.id = doc.id;
    dot.dataset.tooltip = tooltip;
    g.appendChild(dot);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', 11);
    label.setAttribute('y', 0);
    label.setAttribute('class', 'doc-source-label');
    label.setAttribute('dominant-baseline', 'middle');
    label.textContent = titleText.length > 38 ? titleText.slice(0, 35) + '…' : titleText;
    g.appendChild(label);

    wrapper.appendChild(g);
    parent.appendChild(wrapper);
}

function makeRegionLabel(name, cx, cy, extraClass) {
    // Old-map-style region name. Long names get truncated; proper multi-line
    // wrapping is deferred until someone complains. Placed at the cell's
    // centroid in both views, which is usually inside the splotch.
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', cx);
    text.setAttribute('y', cy);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    const cls = 'region-label' + (extraClass ? ' ' + extraClass : '');
    text.setAttribute('class', cls);
    const label = name.length > 32 ? name.slice(0, 30) + '…' : name;
    text.textContent = label;
    return text;
}

function makeDocDot(docId, cx, cy, doc, worldOffset) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.setAttribute('r', 4);
    dot.setAttribute('fill', '#3a2f22');
    dot.setAttribute('class', 'doc-dot');
    dot.dataset.id = docId;
    if (doc) {
        const titleText = (doc.metadata && doc.metadata.title) || doc.source_filename || 'Untitled';
        const author = doc.metadata && doc.metadata.author;
        dot.dataset.tooltip = author ? `${titleText}\n${author}` : titleText;
    }
    if (worldOffset) {
        dot.style.setProperty('--world-dx', `${worldOffset[0]}px`);
        dot.style.setProperty('--world-dy', `${worldOffset[1]}px`);
        dot.classList.add('path-anim-doc-travel');
    }
    return dot;
}

function renderMovedRegion({ splotchLayer, defs, region, docsById, screenPos, color, sourceCell, onlyDocIds, sourceKey }) {
    // Path-view splotch: render a rounded organic blob that fills the grid
    // cell (or Voronoi sub-cell when packed). World silhouette is NOT
    // preserved here — path view is a full re-layout, so each region gets a
    // cell-shaped blob with the region's color + watercolor filter. Docs
    // are jittered inside the cell (seeded by id, so layout is stable).
    //
    // Splotch + dots go into a single <g> so mouseenter/leave on the group
    // fire based on the whole source's rendered area — hovering a dot that
    // sits on top of the splotch does NOT fire mouseleave on the group,
    // because the dot is a descendant. The splotch <path>s get
    // `path-anim-splotch` directly so they fade in AFTER the dots have
    // finished sliding into place (see style.css timeline).
    const splotchPoly = inflate(sourceCell, -10);

    const groupG = document.createElementNS(SVG_NS, 'g');
    groupG.setAttribute('class', 'moved-region-splotch');
    if (sourceKey) groupG.dataset.sourceKey = sourceKey;
    renderCellSplotch(groupG, defs, region, splotchPoly, color, 'path-anim-splotch');

    if (region.name) {
        const [labelCx, labelCy] = polygonCentroid(sourceCell);
        groupG.appendChild(makeRegionLabel(region.name, labelCx, labelCy, 'path-anim-splotch'));
    }

    const innerPoly = inflate(sourceCell, -30);
    const [bx0, by0, bx1, by1] = polygonAABB(innerPoly);
    const innerW = Math.max(0, bx1 - bx0);
    const innerH = Math.max(0, by1 - by0);
    const [cellCx, cellCy] = polygonCentroid(sourceCell);

    const docIds = onlyDocIds || Object.keys(region.members || {});
    const docPositions = {};
    for (const docId of docIds) {
        const seed = hashCode(docId + region.id);
        const jx = (((seed) & 0xff) / 255 - 0.5) * 0.85;
        const jy = (((seed >> 8) & 0xff) / 255 - 0.5) * 0.85;
        const px = cellCx + jx * innerW;
        const py = cellCy + jy * innerH;
        const wp = screenPos && screenPos[docId];
        const worldOffset = wp ? [wp[0] - px, wp[1] - py] : null;
        groupG.appendChild(makeDocDot(docId, px, py, docsById[docId], worldOffset));
        docPositions[docId] = [px, py];
    }

    splotchLayer.appendChild(groupG);
    return { docPositions };
}

function renderMovedLandmark({ splotchLayer, landmarkLayer, defs, landmark, color, sourceCell, sourceKey }) {
    // Landmarks get a cell-filling splotch too — without one, tributaries
    // look like they're emerging from thin air. Same blob method as regions,
    // with a per-landmark seed so the watercolor filter varies. Splotch and
    // icon both fade in together in the "regions color in" phase, after the
    // dots have slid and the river has drawn.
    const splotchPoly = inflate(sourceCell, -10);

    const groupG = document.createElementNS(SVG_NS, 'g');
    groupG.setAttribute('class', 'moved-landmark-splotch');
    if (sourceKey) groupG.dataset.sourceKey = sourceKey;
    renderCellSplotch(groupG, defs, { id: 'lm-' + landmark.id }, splotchPoly, color, 'path-anim-splotch');
    splotchLayer.appendChild(groupG);

    const [cx, cy] = polygonCentroid(sourceCell);
    const lmEl = renderLandmarkIcon(landmarkLayer, landmark, cx, cy);
    if (lmEl) lmEl.classList.add('path-anim-landmark');
}

function polygonAABB(poly) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
}

function polygonCentroid(poly) {
    let sumX = 0, sumY = 0;
    for (const p of poly) { sumX += p[0]; sumY += p[1]; }
    return [sumX / poly.length, sumY / poly.length];
}

function renderPath(riverParent, flagParent, path, stepPositions, sourceOrigins, sources,
                    docPositionsInPathView, x0, y0, x1, y1) {
    if (!path.steps || !path.steps.length) return;

    const parent = riverParent;
    const svg = parent.ownerSVGElement;
    const defs = ensureDefs(svg);
    const riverFilterId = ensureRiverWatercolorFilter(defs);
    const riverD = catmullRomOpen(stepPositions);

    // Multi-layered blue watercolor river: outer wash, mid, inner core.
    // Each layer uses the watercolor filter to bleed organically.
    const riverLayers = [
        { width: 18, color: '#a8c8dc', opacity: 0.30 },
        { width: 11, color: '#5a8caa', opacity: 0.50 },
        { width: 5,  color: '#1a4a6b', opacity: 0.85 },
    ];
    for (const layer of riverLayers) {
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', riverD);
        p.setAttribute('stroke', layer.color);
        p.setAttribute('stroke-width', String(layer.width));
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        p.setAttribute('fill', 'none');
        p.setAttribute('opacity', String(layer.opacity));
        p.setAttribute('filter', `url(#${riverFilterId})`);
        p.setAttribute('class', 'path-line path-anim-river');
        parent.appendChild(p);
    }

    const rc = (typeof rough !== 'undefined') ? rough.svg(svg) : null;

    // Sample interpolated river points so tributary joins can find the closest
    // spot on the curved river — not just at the discrete steps.
    const riverSamples = sampleRiverPoints(stepPositions, 25);

    // Tributaries: every tributary emerges from its source's splotch bottom
    // (sourceOrigins[key]) and joins the river just above its step. Drainage
    // streams (docs → sourceOrigin) are hidden by default and revealed on
    // hover of the source's splotch.
    const TRIB_JOIN_WINDOW = 90; // window above step where the join can land
    for (const trib of (path.tributaries || [])) {
        const stepIdx = path.steps.findIndex(s => s.id === trib.step_id);
        if (stepIdx < 0) continue;
        const stepY = stepPositions[stepIdx][1];

        const key = `${trib.source_type}:${trib.source_id}`;
        const sourceXY = sourceOrigins.get(key);
        if (!sourceXY) continue;

        // Drainage streams: for region tributaries, each contributing doc
        // feeds the source's origin point. For doc tributaries the doc
        // itself feeds it. Hidden by default; shown on splotch hover.
        let contributingIds = null;
        if (trib.source_type === 'region' && trib.contributing_doc_ids && trib.contributing_doc_ids.length > 0) {
            contributingIds = trib.contributing_doc_ids;
        } else if (trib.source_type === 'doc') {
            contributingIds = [trib.source_id];
        }
        if (contributingIds) {
            for (const docId of contributingIds) {
                const docXY = docPositionsInPathView[docId];
                if (!docXY) continue;
                renderDrainageStream(parent, docXY, sourceXY, trib.id, key);
            }
        }

        // Main tributary: splotch bottom → river join above step. Fallback
        // (if findJoinAboveStep's window is empty) ALWAYS picks a river
        // sample strictly below the source — tributaries must never flow
        // upward. If no such sample exists at all (shouldn't, since grid
        // placement guarantees source is above step - buffer), skip.
        const result = findJoinAboveStep(riverSamples, sourceXY, stepY, TRIB_MIN_SPACING_Y, TRIB_JOIN_WINDOW);
        let joinPoint, joinIdx;
        if (result) {
            joinPoint = result.point;
            joinIdx = result.index;
        } else {
            let best = -1, bestDist = Infinity;
            for (let i = 0; i < riverSamples.length; i++) {
                if (riverSamples[i][1] <= sourceXY[1]) continue; // must flow down
                if (riverSamples[i][1] >= stepY) continue;       // must stay upstream of step
                const d = Math.abs(riverSamples[i][1] - (stepY - TRIB_MIN_SPACING_Y));
                if (d < bestDist) { bestDist = d; best = i; }
            }
            if (best < 0) continue; // no valid down-flow join — skip
            joinPoint = riverSamples[best];
            joinIdx = best;
        }
        const tangent = riverTangentAt(riverSamples, joinIdx);
        renderTributary(parent, sourceXY, joinPoint, tangent, trib, rc);
    }

    // Flag markers — into the flag layer so they sit on top of everything.
    stepPositions.forEach((p, i) => {
        const flag = makeFlag(path.steps[i], i + 1);
        flag.setAttribute('transform', `translate(${p[0]}, ${p[1]})`);
        flag.classList.add('path-anim-flag');
        flagParent.appendChild(flag);
    });
}

function renderDrainageStream(parent, docXY, collection, tribId, sourceKey) {
    // Small thin paler stream from a contributing doc into the collection
    // point. Slight perpendicular bow per-stream so they read as distinct.
    // Hidden by default; revealed when the user hovers the source's splotch
    // (the renderer tags both with `data-source-key`).
    const dx = collection[0] - docXY[0];
    const dy = collection[1] - docXY[1];
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    const mx = (docXY[0] + collection[0]) / 2;
    const my = (docXY[1] + collection[1]) / 2;
    const seed = hashCode(tribId + ':' + docXY[0].toFixed(0) + ',' + docXY[1].toFixed(0));
    const side = (seed >> 1) & 1 ? 1 : -1;
    const bow = len * 0.18;
    const cx = mx + px * side * bow;
    const cy = my + py * side * bow;
    const d = `M ${docXY[0].toFixed(2)} ${docXY[1].toFixed(2)} ` +
              `Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${collection[0].toFixed(2)} ${collection[1].toFixed(2)}`;

    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', '#3a7299');
    p.setAttribute('stroke-width', '1.4');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('fill', 'none');
    p.setAttribute('opacity', '0.65');
    p.setAttribute('class', 'drainage-stream');
    if (sourceKey) p.dataset.sourceKey = sourceKey;
    parent.appendChild(p);
}

function riverTangentAt(samples, index) {
    const i0 = Math.max(0, index - 1);
    const i1 = Math.min(samples.length - 1, index + 1);
    const dx = samples[i1][0] - samples[i0][0];
    const dy = samples[i1][1] - samples[i0][1];
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
}

function ensureRiverWatercolorFilter(defs) {
    const id = 'river-watercolor';
    if (defs.querySelector(`#${id}`)) return id;
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '-5%');
    filter.setAttribute('y', '-5%');
    filter.setAttribute('width', '110%');
    filter.setAttribute('height', '110%');

    const t = document.createElementNS(SVG_NS, 'feTurbulence');
    t.setAttribute('type', 'fractalNoise');
    t.setAttribute('baseFrequency', '0.022');
    t.setAttribute('numOctaves', '2');
    t.setAttribute('seed', '7');
    t.setAttribute('result', 'noise');
    filter.appendChild(t);

    const d = document.createElementNS(SVG_NS, 'feDisplacementMap');
    d.setAttribute('in', 'SourceGraphic');
    d.setAttribute('in2', 'noise');
    d.setAttribute('scale', '5');
    filter.appendChild(d);

    defs.appendChild(filter);
    return id;
}

function computeRiverPositions(steps, x0, y0, x1, y1, seed) {
    // y distributed top-to-bottom: river starts near the top of the canvas
    // with a small margin. Step 0 lives in row 0; the grid placement uses
    // a safety-net plus origin clamp so sources for early steps can still
    // sit above their step without any empty pre-river dead space.
    // x meanders sinusoidally around the center; phase derived from path
    // id for stable per-path variation.
    const n = steps.length;
    const cx = (x0 + x1) / 2;
    const width = x1 - x0;
    const amplitude = 0.10 * width;
    const yMarginTop = (y1 - y0) * 0.025;
    const phase = (seed % 1000) / 1000 * Math.PI * 2;

    const positions = [];
    for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0.5;
        const y = y0 + yMarginTop + t * ((y1 - y0) - yMarginTop);
        const x = cx + amplitude * Math.sin(phase + i * 1.1);
        positions.push([x, y]);
    }
    return positions;
}

function catmullRomOpen(points) {
    // Open Catmull-Rom (not closed) — for paths that have endpoints.
    if (points.length < 2) return '';
    if (points.length === 2) {
        return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
    }
    const tension = 0.5;
    let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)} `;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        const cp1x = p1[0] + (p2[0] - p0[0]) * tension / 3;
        const cp1y = p1[1] + (p2[1] - p0[1]) * tension / 3;
        const cp2x = p2[0] - (p3[0] - p1[0]) * tension / 3;
        const cp2y = p2[1] - (p3[1] - p1[1]) * tension / 3;
        d += `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)} `;
    }
    return d;
}

function sampleRiverPoints(stepPositions, samplesPerSegment = 25) {
    // Linear interpolation between step positions — close enough for finding
    // a tributary join point. The visible river is the smoother Catmull-Rom.
    const samples = [];
    for (let i = 0; i < stepPositions.length - 1; i++) {
        const [x0, y0] = stepPositions[i];
        const [x1, y1] = stepPositions[i + 1];
        for (let s = 0; s < samplesPerSegment; s++) {
            const t = s / samplesPerSegment;
            samples.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
        }
    }
    samples.push(stepPositions[stepPositions.length - 1]);
    return samples;
}

function findJoinAboveStep(samples, source, stepY, buffer, window) {
    // Returns { point, index } or null. STRICT down-flow only — never returns
    // a join point above the source (would render as an upward tributary).
    const maxY = stepY - buffer;
    const minY = stepY - window;

    let best = null;
    let bestIdx = -1;
    let bestDist = Infinity;
    const consider = (allowBelowMinY) => {
        for (let i = 0; i < samples.length; i++) {
            const p = samples[i];
            if (p[1] <= source[1]) continue;
            if (!allowBelowMinY && p[1] < minY) continue;
            if (p[1] > maxY) continue;
            const d = Math.hypot(p[0] - source[0], p[1] - source[1]);
            if (d < bestDist) {
                bestDist = d;
                best = p;
                bestIdx = i;
            }
        }
    };

    consider(false);
    if (best) return { point: best, index: bestIdx };
    // Fallback: relax window (minY) but KEEP strict down-flow.
    consider(true);
    return best ? { point: best, index: bestIdx } : null;
}

function renderTributary(parent, source, join, riverTangent, trib, rc) {
    const d = buildTributaryPath(source, join, riverTangent, trib.id);

    // Single blue watercolor stroke per tributary, paler than the river so
    // it reads as a feeder stream and lets text/landmarks sit on top.
    const svg = parent.ownerSVGElement;
    const defs = ensureDefs(svg);
    const filterId = ensureRiverWatercolorFilter(defs);

    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', '#5a8caa');
    p.setAttribute('stroke-width', '2.2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('fill', 'none');
    p.setAttribute('opacity', '0.5');
    p.setAttribute('filter', `url(#${filterId})`);
    p.setAttribute('class', 'tributary-line path-anim-tributary');
    parent.appendChild(p);
}

function buildTributaryPath(source, join, riverTangent, tribId) {
    // Cubic Bezier with two control points:
    //   - C1 (near source): perpendicular bow gives the tributary character.
    //     Bow direction (left/right) and magnitude are seeded by tribId for
    //     per-stream variety.
    //   - C2 (near join): positioned UPSTREAM along the river tangent so the
    //     end of the curve smoothly aligns with the river's flow direction
    //     at the confluence (no perpendicular T-bones).
    const seed = hashCode(tribId);
    const side = (seed >> 3) & 1 ? 1 : -1;
    const bowFactor = 0.16 + ((seed >> 7) & 31) / 180; // 0.16..0.34

    const dx = join[0] - source[0];
    const dy = join[1] - source[1];
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;

    const fmt = (n) => n.toFixed(2);
    const sx = source[0], sy = source[1];
    const jx = join[0], jy = join[1];

    const t1x = sx + dx * 0.40;
    const t1y = sy + dy * 0.40;
    const bow = len * bowFactor;
    const c1x = t1x + px * side * bow;
    const c1y = t1y + py * side * bow;

    const lead = Math.min(len * 0.30, 60);
    const c2x = jx - lead * riverTangent[0];
    const c2y = jy - lead * riverTangent[1];

    return `M ${fmt(sx)} ${fmt(sy)} C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(jx)} ${fmt(jy)}`;
}

function makeFlag(step, stepNumber) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'path-flag');
    g.dataset.tooltip = step.evocative_sentence || `Step ${stepNumber}`;

    const pole = document.createElementNS(SVG_NS, 'line');
    pole.setAttribute('x1', '0');
    pole.setAttribute('y1', '0');
    pole.setAttribute('x2', '0');
    pole.setAttribute('y2', '-22');
    pole.setAttribute('class', 'pole');
    g.appendChild(pole);

    const banner = document.createElementNS(SVG_NS, 'path');
    banner.setAttribute('d', 'M 0 -22 L 16 -19 L 12 -15 L 16 -11 L 0 -14 Z');
    banner.setAttribute('class', 'banner');
    g.appendChild(banner);

    const num = document.createElementNS(SVG_NS, 'text');
    num.setAttribute('x', '6');
    num.setAttribute('y', '-16.5');
    num.setAttribute('class', 'step-num');
    num.textContent = stepNumber;
    g.appendChild(num);

    return g;
}

function renderLandmarkIcon(parent, landmark, screenX, screenY, size = 32) {
    const g = document.createElementNS(SVG_NS, 'g');
    let className = 'landmark-icon';
    if (landmark.pending) className += ' pending';
    g.setAttribute('class', className);
    g.dataset.id = landmark.id;
    g.dataset.tooltip = formatLandmarkTooltip(landmark);
    const half = size / 2;
    const scale = size / 24;
    g.setAttribute('transform', `translate(${screenX - half}, ${screenY - half}) scale(${scale})`);

    // Invisible hit-area circle. pointer-events="all" ensures it receives
    // clicks even though its fill is fully transparent (some browsers
    // wouldn't otherwise register hits on a transparent fill).
    const hit = document.createElementNS(SVG_NS, 'circle');
    hit.setAttribute('cx', 12);
    hit.setAttribute('cy', 12);
    hit.setAttribute('r', 14);
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('pointer-events', 'all');
    g.appendChild(hit);

    for (const d of ICONS[landmark.icon] || []) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.4');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        g.appendChild(path);
    }
    parent.appendChild(g);
    return g;
}

function formatLandmarkTooltip(landmark) {
    const t = (landmark.thoughts || '').trim();
    const prefix = landmark.pending ? '(proposed) ' : '';
    if (t) {
        const truncated = t.length > 240 ? t.slice(0, 237) + '…' : t;
        return prefix + truncated;
    }
    const iconName = landmark.icon.charAt(0).toUpperCase() + landmark.icon.slice(1);
    return `${prefix}${iconName} — (click to add thoughts)`;
}

function computeArgumentPositions(landscape) {
    // 1. Compute similarity centroids in normalized coords (one per region).
    const baseCentroids = {};
    for (const region of (landscape.regions || [])) {
        const memberIds = Object.keys(region.members || {});
        const points = memberIds.map(id => (landscape.positions || {})[id]).filter(Boolean);
        if (points.length === 0) continue;
        const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
        const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
        baseCentroids[region.id] = [cx, cy];
    }

    // 2. For each landmark, find the closest region (by similarity centroid).
    const landmarkRegion = {};
    for (const lm of (landscape.landmarks || [])) {
        let best = null;
        let bestDist = Infinity;
        for (const [regionId, c] of Object.entries(baseCentroids)) {
            const d = Math.hypot(c[0] - lm.position[0], c[1] - lm.position[1]);
            if (d < bestDist) { bestDist = d; best = regionId; }
        }
        if (best) landmarkRegion[lm.id] = best;
    }

    // 3. For each region, find the first path-step index that visits a landmark in it.
    const firstVisit = {};
    if (landscape.path && landscape.path.steps) {
        landscape.path.steps.forEach((step, i) => {
            if (step.is_uncharted || !step.landmark_id) return;
            const regionId = landmarkRegion[step.landmark_id];
            if (!regionId) return;
            if (!(regionId in firstVisit)) firstVisit[regionId] = i;
        });
    }

    // 4. Sort regions: visited ones by first-visit step, then unvisited (by original y).
    const regions = landscape.regions || [];
    const visited = regions.filter(r => r.id in firstVisit);
    const unvisited = regions.filter(r => !(r.id in firstVisit));
    visited.sort((a, b) => firstVisit[a.id] - firstVisit[b.id]);
    unvisited.sort((a, b) => (baseCentroids[a.id]?.[1] || 0) - (baseCentroids[b.id]?.[1] || 0));
    const ordered = visited.concat(unvisited);

    // 5. Assign new y to each region — evenly spaced. Visited regions get pulled
    //    toward the vertical center line so the argument flows mostly downward;
    //    unvisited regions keep their similarity x and sit to the sides.
    const VERTICAL_PULL = 0.75; // 0 = no pull, 1 = strict vertical column
    const newCentroids = {};
    const n = ordered.length;
    ordered.forEach((region, idx) => {
        const newY = n > 1 ? 0.05 + (idx / (n - 1)) * 0.9 : 0.5;
        const oldX = (baseCentroids[region.id] || [0.5, 0.5])[0];
        const isVisited = region.id in firstVisit;
        const newX = isVisited ? oldX + (0.5 - oldX) * VERTICAL_PULL : oldX;
        newCentroids[region.id] = [newX, newY];
    });

    // 6. Compute the offset for each region (delta from base centroid).
    const regionOffset = {};
    for (const region of regions) {
        const base = baseCentroids[region.id];
        const next = newCentroids[region.id];
        if (!base || !next) continue;
        regionOffset[region.id] = [next[0] - base[0], next[1] - base[1]];
    }

    // 7. Apply offset to docs (each doc's primary region = highest weight membership).
    const docPositions = {};
    const docPrimaryRegion = {};
    for (const region of regions) {
        for (const [docId, weight] of Object.entries(region.members || {})) {
            const prev = docPrimaryRegion[docId];
            if (!prev || weight > prev.weight) {
                docPrimaryRegion[docId] = { regionId: region.id, weight };
            }
        }
    }
    for (const [docId, pos] of Object.entries(landscape.positions || {})) {
        const primary = docPrimaryRegion[docId];
        const offset = primary ? regionOffset[primary.regionId] : null;
        if (offset) {
            docPositions[docId] = [pos[0] + offset[0], pos[1] + offset[1]];
        } else {
            docPositions[docId] = pos;
        }
    }

    // 8. Apply offset to landmarks (use landmarkRegion mapping).
    const landmarkPositions = {};
    for (const lm of (landscape.landmarks || [])) {
        const regionId = landmarkRegion[lm.id];
        const offset = regionId ? regionOffset[regionId] : null;
        if (offset) {
            landmarkPositions[lm.id] = [lm.position[0] + offset[0], lm.position[1] + offset[1]];
        } else {
            landmarkPositions[lm.id] = lm.position;
        }
    }

    return { docPositions, landmarkPositions };
}

function clickToNormalizedPosition(clientX, clientY) {
    const svg = document.querySelector('.map-canvas');
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const width = svg.clientWidth;
    const height = svg.clientHeight;
    const x0 = width * HORIZ_MARGIN_FRAC;
    const x1 = width * (1 - HORIZ_MARGIN_FRAC);
    const y0 = MARGIN;
    const y1 = height * BOTTOM_FRAC;
    const nx = (px - x0) / (x1 - x0);
    const ny = (py - y0) / (y1 - y0);
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
    return [nx, ny];
}

let _tooltipBound = false;

function setupTooltipHandlers() {
    if (_tooltipBound) return;
    _tooltipBound = true;

    const tooltip = document.getElementById('map-tooltip');
    if (!tooltip) return;
    const mapArea = document.querySelector('.map-area');

    document.addEventListener('mouseover', (e) => {
        const el = e.target.closest && e.target.closest('[data-tooltip]');
        if (!el || !el.dataset.tooltip) return;
        tooltip.textContent = el.dataset.tooltip;
        tooltip.hidden = false;
        positionTooltip(e, tooltip, mapArea);
    });

    document.addEventListener('mousemove', (e) => {
        if (tooltip.hidden) return;
        positionTooltip(e, tooltip, mapArea);
    });

    document.addEventListener('mouseout', (e) => {
        const el = e.target.closest && e.target.closest('[data-tooltip]');
        if (!el) return;
        const related = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-tooltip]');
        if (related) return;
        tooltip.hidden = true;
    });
}

function positionTooltip(e, tooltip, mapArea) {
    if (!mapArea) return;
    const rect = mapArea.getBoundingClientRect();
    const x = e.clientX - rect.left + 12;
    const y = e.clientY - rect.top + 12;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
}

function computeVoronoiCells(centroids, x0, y0, x1, y1) {
    const valid = centroids.map((c, i) => ({ c, i })).filter(x => x.c);
    const cells = new Array(centroids.length).fill(null);
    if (valid.length === 0) return cells;
    if (valid.length === 1) {
        cells[valid[0].i] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        return cells;
    }
    const points = valid.map(x => x.c);
    const delaunay = d3.Delaunay.from(points);
    const voronoi = delaunay.voronoi([x0, y0, x1, y1]);
    valid.forEach(({ i }, k) => {
        const poly = voronoi.cellPolygon(k);
        if (poly) {
            cells[i] = poly.slice(0, -1);
        }
    });
    return cells;
}

function renderCellSplotch(parent, defs, region, points, color, splotchClass) {
    const seed = hashCode(region.id);
    const filterId = `watercolor-${region.id}`;
    if (!defs.querySelector(`#${filterId}`)) {
        defs.appendChild(makeWatercolorFilter(filterId, seed));
    }

    const applyClass = (el) => {
        if (splotchClass) el.setAttribute('class', splotchClass);
    };

    const outerPath = catmullRomClosed(points);
    const outer = document.createElementNS(SVG_NS, 'path');
    outer.setAttribute('d', outerPath);
    outer.setAttribute('fill', color);
    outer.setAttribute('fill-opacity', 0.30);
    outer.setAttribute('stroke', 'none');
    outer.setAttribute('filter', `url(#${filterId})`);
    applyClass(outer);
    parent.appendChild(outer);

    const inner = inflate(points, -18);
    const innerPath = catmullRomClosed(inner);
    const innerEl = document.createElementNS(SVG_NS, 'path');
    innerEl.setAttribute('d', innerPath);
    innerEl.setAttribute('fill', color);
    innerEl.setAttribute('fill-opacity', 0.25);
    innerEl.setAttribute('stroke', 'none');
    innerEl.setAttribute('filter', `url(#${filterId})`);
    applyClass(innerEl);
    parent.appendChild(innerEl);
}

// ---- Geometry helpers ----

function inflate(points, padding) {
    if (points.length === 0) return points;
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
    return points.map(([x, y]) => {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d === 0) return [x, y];
        const newD = Math.max(0, d + padding);
        return [cx + (dx / d) * newD, cy + (dy / d) * newD];
    });
}

function catmullRomClosed(points) {
    if (points.length < 3) {
        if (points.length === 0) return '';
        let p = `M ${points[0][0]} ${points[0][1]}`;
        for (let i = 1; i < points.length; i++) p += ` L ${points[i][0]} ${points[i][1]}`;
        return p + ' Z';
    }
    const n = points.length;
    const tension = 0.5;
    let path = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)} `;
    for (let i = 0; i < n; i++) {
        const p0 = points[(i - 1 + n) % n];
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        const p3 = points[(i + 2) % n];
        const cp1x = p1[0] + (p2[0] - p0[0]) * tension / 3;
        const cp1y = p1[1] + (p2[1] - p0[1]) * tension / 3;
        const cp2x = p2[0] - (p3[0] - p1[0]) * tension / 3;
        const cp2y = p2[1] - (p3[1] - p1[1]) * tension / 3;
        path += `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)} `;
    }
    return path + 'Z';
}

function makeWatercolorFilter(id, seed) {
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '-10%');
    filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '120%');
    filter.setAttribute('height', '120%');

    const t = document.createElementNS(SVG_NS, 'feTurbulence');
    t.setAttribute('type', 'fractalNoise');
    t.setAttribute('baseFrequency', '0.012');
    t.setAttribute('numOctaves', '2');
    t.setAttribute('seed', String(seed));
    t.setAttribute('result', 'noise');
    filter.appendChild(t);

    const d = document.createElementNS(SVG_NS, 'feDisplacementMap');
    d.setAttribute('in', 'SourceGraphic');
    d.setAttribute('in2', 'noise');
    d.setAttribute('scale', '24');
    filter.appendChild(d);

    return filter;
}

function ensureDefs(svg) {
    let defs = svg.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS(SVG_NS, 'defs');
        svg.insertBefore(defs, svg.firstChild);
    }
    return defs;
}

function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

window.renderMap = renderMap;
window.FAKE_LANDSCAPE = FAKE_LANDSCAPE;

let _currentLandscape = FAKE_LANDSCAPE;
let _placingIcon = null;
let _editingLandmarkId = null;
let _viewMode = 'world'; // 'world' (Your world) or 'path' (Your path)

async function loadAndRender() {
    try {
        const res = await fetch('/api/landscape');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data && data.regions && data.regions.length > 0) {
            _currentLandscape = data;
        } else {
            console.info('Backend returned no regions; using fake data');
        }
    } catch (err) {
        console.warn('Failed to fetch landscape, using fake data:', err);
    }
    refreshViewToggleAvailability();
    renderMap(_currentLandscape);
}

window.addEventListener('load', () => {
    loadAndRender();
    setupPalette();
    setupLandmarkPopup();
    setupMapClickForPlacement();
    setupTracePath();
    setupFlagClickForPopup();
    setupViewToggle();
});

function setupViewToggle() {
    const buttons = document.querySelectorAll('.stage-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (!view || btn.disabled) return;
            _viewMode = view;
            buttons.forEach(b => b.classList.toggle('active', b.dataset.view === view));
            renderMap(_currentLandscape);
        });
    });
    refreshViewToggleAvailability();
}

function refreshViewToggleAvailability() {
    const pathBtn = document.querySelector('.stage-btn[data-view="path"]');
    if (!pathBtn) return;
    const hasPath = _currentLandscape && _currentLandscape.path
        && Array.isArray(_currentLandscape.path.steps)
        && _currentLandscape.path.steps.length > 0;
    pathBtn.disabled = !hasPath;
    if (!hasPath && _viewMode === 'path') {
        _viewMode = 'world';
        document.querySelectorAll('.stage-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.view === 'world');
        });
    }
}

window.addEventListener('resize', () => {
    renderMap(_currentLandscape);
});

// ---- Landmark palette + place mode ----

function setupPalette() {
    const palette = document.getElementById('landmark-palette');
    if (!palette) return;
    palette.addEventListener('click', (e) => {
        const btn = e.target.closest('.palette-btn');
        if (!btn) return;
        const icon = btn.dataset.icon;
        if (_placingIcon === icon) {
            exitPlaceMode();
        } else {
            enterPlaceMode(icon);
        }
    });
}

function enterPlaceMode(icon) {
    _placingIcon = icon;
    document.body.classList.add('placing-landmark');
    document.querySelectorAll('.palette-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.icon === icon);
    });
}

function exitPlaceMode() {
    _placingIcon = null;
    document.body.classList.remove('placing-landmark');
    document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
}

function setupMapClickForPlacement() {
    const svg = document.querySelector('.map-canvas');
    if (!svg) return;
    svg.addEventListener('click', async (e) => {
        console.log('[map] svg click', { target: e.target, placing: _placingIcon });
        if (!_placingIcon) {
            const lmEl = e.target.closest('.landmark-icon');
            console.log('[map] landmark match:', lmEl, lmEl && lmEl.dataset.id);
            if (lmEl) openLandmarkPopup(lmEl.dataset.id);
            return;
        }
        const pos = clickToNormalizedPosition(e.clientX, e.clientY);
        if (!pos) return; // click outside territory bounds
        const icon = _placingIcon;
        exitPlaceMode();
        try {
            const res = await fetch('/api/landmarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ icon, position: pos }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const newLandmark = await res.json();
            _currentLandscape.landmarks = _currentLandscape.landmarks || [];
            _currentLandscape.landmarks.push(newLandmark);
            renderMap(_currentLandscape);
            openLandmarkPopup(newLandmark.id);
        } catch (err) {
            console.error('Failed to create landmark:', err);
        }
    });

    // Cancel place mode on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _placingIcon) exitPlaceMode();
    });
}

// ---- Landmark popup ----

function setupLandmarkPopup() {
    const backdrop = document.getElementById('landmark-popup-backdrop');
    const closeBtn = document.getElementById('landmark-popup-close');
    const deleteBtn = document.getElementById('landmark-delete-btn');
    const thoughts = document.getElementById('landmark-thoughts');
    const status = document.getElementById('landmark-save-status');
    if (!backdrop) return;

    let saveTimer = null;

    closeBtn.addEventListener('click', () => closeLandmarkPopup(true));
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeLandmarkPopup(true);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !backdrop.hidden) closeLandmarkPopup(true);
    });

    thoughts.addEventListener('input', () => {
        status.textContent = 'unsaved...';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveThoughts(thoughts.value, status), 600);
    });

    deleteBtn.addEventListener('click', async () => {
        if (!_editingLandmarkId) return;
        if (!confirm('Delete this landmark?')) return;
        try {
            const res = await fetch(`/api/landmarks/${_editingLandmarkId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // Re-fetch landscape so path step updates (uncharted on dangling refs) reflect
            await loadAndRender();
            backdrop.hidden = true;
            _editingLandmarkId = null;
        } catch (err) {
            console.error('Failed to delete landmark:', err);
        }
    });

    const confirmBtn = document.getElementById('landmark-confirm-btn');
    confirmBtn.addEventListener('click', async () => {
        if (!_editingLandmarkId) return;
        try {
            const res = await fetch(`/api/landmarks/${_editingLandmarkId}/confirm`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const updated = await res.json();
            const i = (_currentLandscape.landmarks || []).findIndex(l => l.id === updated.id);
            if (i >= 0) _currentLandscape.landmarks[i] = updated;
            confirmBtn.hidden = true;
            renderMap(_currentLandscape);
        } catch (err) {
            console.error('Failed to confirm landmark:', err);
        }
    });
}

function setupFlagClickForPopup() {
    document.addEventListener('click', (e) => {
        const flag = e.target.closest && e.target.closest('.path-flag');
        if (!flag) return;
        // Future: could open a step-detail popup. For now, no-op.
    });
}

function setupTracePath() {
    const btn = document.getElementById('trace-path-btn');
    const editor = document.querySelector('.essay-editor');
    if (!btn || !editor) return;
    btn.addEventListener('click', async () => {
        const essay = editor.value.trim();
        if (!essay) {
            alert('Paste an essay into the editor first.');
            return;
        }
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'tracing…';
        try {
            const res = await fetch('/api/path/trace', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ essay }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            _currentLandscape = await res.json();
            refreshViewToggleAvailability();
            renderMap(_currentLandscape);
        } catch (err) {
            alert('Trace failed: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    });
}

async function saveThoughts(text, statusEl) {
    if (!_editingLandmarkId) return;
    try {
        const res = await fetch(`/api/landmarks/${_editingLandmarkId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ thoughts: text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = await res.json();
        const i = (_currentLandscape.landmarks || []).findIndex(l => l.id === updated.id);
        if (i >= 0) _currentLandscape.landmarks[i] = updated;
        statusEl.textContent = 'saved';
        // Update the rendered landmark's tooltip without a full re-render.
        const lmEl = document.querySelector(`.landmark-icon[data-id="${updated.id}"]`);
        if (lmEl) lmEl.dataset.tooltip = formatLandmarkTooltip(updated);
    } catch (err) {
        statusEl.textContent = 'save failed';
    }
}

function openLandmarkPopup(landmarkId) {
    const landmark = (_currentLandscape.landmarks || []).find(l => l.id === landmarkId);
    if (!landmark) return;
    _editingLandmarkId = landmarkId;
    const backdrop = document.getElementById('landmark-popup-backdrop');
    const iconEl = document.getElementById('landmark-popup-icon');
    const thoughts = document.getElementById('landmark-thoughts');
    const status = document.getElementById('landmark-save-status');
    const confirmBtn = document.getElementById('landmark-confirm-btn');
    confirmBtn.hidden = !landmark.pending;

    // Render icon in header
    iconEl.innerHTML = '';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of ICONS[landmark.icon] || []) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    iconEl.appendChild(svg);

    thoughts.value = landmark.thoughts || '';
    status.textContent = '';
    backdrop.hidden = false;
    setTimeout(() => thoughts.focus(), 0);
}

function closeLandmarkPopup() {
    document.getElementById('landmark-popup-backdrop').hidden = true;
    _editingLandmarkId = null;
}

function setupLandmarkInteractions() {
    // Landmark click is delegated through the SVG-level handler in
    // setupMapClickForPlacement, so nothing else to wire per-render.
}
