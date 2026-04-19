// SVG map rendering — Voronoi tessellation of regions, rendered as
// watercolor territories that partition the whole canvas. Document dots
// sit on top at their original positions.

const SVG_NS = 'http://www.w3.org/2000/svg';

const PALETTE = [
    '#c4a17a',
    '#a78a5c',
    '#b89368',
    '#947450',
    '#d4b38a',
    '#8c6b48',
    '#bf9a6f',
];

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

// Voronoi territory occupies the upper-center two-thirds of the canvas:
// horizontal margin = 1/6 of width on each side; vertical extends from
// MARGIN at the top down to BOTTOM_FRAC of canvas height. Bottom third
// stays blank for uncharted territory / paths.
const MARGIN = 40;
const HORIZ_MARGIN_FRAC = 1 / 6;
const BOTTOM_FRAC = 2 / 3;

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

    const screenPos = {};
    for (const [docId, pos] of Object.entries(landscape.positions || {})) {
        screenPos[docId] = [pos[0] * width, pos[1] * height];
    }

    const defs = ensureDefs(svg);

    const splotchLayer = document.createElementNS(SVG_NS, 'g');
    splotchLayer.setAttribute('class', 'splotch-layer');
    content.appendChild(splotchLayer);

    const dotLayer = document.createElementNS(SVG_NS, 'g');
    dotLayer.setAttribute('class', 'dot-layer');
    content.appendChild(dotLayer);

    const regions = landscape.regions || [];
    const centroids = regions.map(region => {
        const points = Object.keys(region.members || {})
            .map(id => screenPos[id])
            .filter(Boolean);
        if (points.length === 0) return null;
        const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
        const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
        return [cx, cy];
    });

    const x0 = width * HORIZ_MARGIN_FRAC;
    const x1 = width * (1 - HORIZ_MARGIN_FRAC);
    const y0 = MARGIN;
    const y1 = height * BOTTOM_FRAC;

    const cells = computeVoronoiCells(centroids, x0, y0, x1, y1);

    regions.forEach((region, i) => {
        const cell = cells[i];
        if (!cell) return;
        renderCellSplotch(splotchLayer, defs, region, cell, PALETTE[i % PALETTE.length]);
    });

    for (const [docId, [cx, cy]] of Object.entries(screenPos)) {
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', cx);
        dot.setAttribute('cy', cy);
        dot.setAttribute('r', 3.5);
        dot.setAttribute('fill', '#3a2f22');
        dot.setAttribute('class', 'doc-dot');
        dot.dataset.id = docId;
        dotLayer.appendChild(dot);
    }
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

function renderCellSplotch(parent, defs, region, points, color) {
    const seed = hashCode(region.id);
    const filterId = `watercolor-${region.id}`;
    if (!defs.querySelector(`#${filterId}`)) {
        defs.appendChild(makeWatercolorFilter(filterId, seed));
    }

    // Outer wash: full Voronoi cell, lower opacity, big organic edge displacement.
    const outerPath = catmullRomClosed(points);
    const outer = document.createElementNS(SVG_NS, 'path');
    outer.setAttribute('d', outerPath);
    outer.setAttribute('fill', color);
    outer.setAttribute('fill-opacity', 0.30);
    outer.setAttribute('stroke', 'none');
    outer.setAttribute('filter', `url(#${filterId})`);
    parent.appendChild(outer);

    // Inner pool: cell shrunk toward its centroid, more saturated. Mimics
    // watercolor pigment pooling in the middle of a wash.
    const inner = inflate(points, -18);
    const innerPath = catmullRomClosed(inner);
    const innerEl = document.createElementNS(SVG_NS, 'path');
    innerEl.setAttribute('d', innerPath);
    innerEl.setAttribute('fill', color);
    innerEl.setAttribute('fill-opacity', 0.25);
    innerEl.setAttribute('stroke', 'none');
    innerEl.setAttribute('filter', `url(#${filterId})`);
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

window.addEventListener('load', () => {
    renderMap(FAKE_LANDSCAPE);
});

window.addEventListener('resize', () => {
    renderMap(FAKE_LANDSCAPE);
});
