// The drawer floor: the stretching cell grid, where bins may go, bed checks, regridding, and auto-fill.
// Functions take the settings object S (drawer, fit, cols/rows) and a bin list; no app state lives here.
//
// Coordinates: x runs left to right as you face the drawer, y runs front to back. Column c counts from the left,
// row r from the front. A bin's top rim is its nominal footprint. Neighbours are 2 x binClear apart at the rim and the
// outer bins sit wallClear off the drawer walls, so the pitch is (length - 2 wallClear + 2 binClear) / count and every
// bin of the same cell size has the same footprint wherever it sits.

var TARGET_CELL = 50; // suggested counts aim for cells about this size (mm)
var MIN_CELL = 15;    // smallest cell: two walls, two clearances, and a pocket you can get a finger into
var MAX_COUNT = 30;   // most columns or rows

function clampInt(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function gridSpan(S, axis) { return (axis === "x" ? S.drawerW : S.drawerD) - 2 * S.wallClear + 2 * S.binClear; }
function maxCount(S, axis) { return clampInt(Math.floor(gridSpan(S, axis) / MIN_CELL), 1, MAX_COUNT); }
function suggestCount(S, axis) { return clampInt(Math.round(gridSpan(S, axis) / TARGET_CELL), 1, maxCount(S, axis)); }
function pitch(S, axis) { return gridSpan(S, axis) / (axis === "x" ? S.cols : S.rows); }
function footprint(S, w, d) { return { x: w * pitch(S, "x") - 2 * S.binClear, y: d * pitch(S, "y") - 2 * S.binClear }; }
// A bin fits the bed if its footprint fits either way round.
function fitsBed(S, w, d) {
  var f = footprint(S, w, d), e = 1e-9;
  return (f.x <= S.bedX + e && f.y <= S.bedY + e) || (f.x <= S.bedY + e && f.y <= S.bedX + e);
}
function oversized(S, bins) { return bins.filter(function (b) { return !fitsBed(S, b.w, b.d); }); }
// The bin's rim rectangle in drawer coordinates (mm from the left wall and the front wall).
function binBox(S, b) {
  var px = pitch(S, "x"), py = pitch(S, "y"), x0 = S.wallClear + b.c * px, y0 = S.wallClear + b.r * py;
  return { x0: x0, y0: y0, x1: x0 + b.w * px - 2 * S.binClear, y1: y0 + b.d * py - 2 * S.binClear };
}

function inBounds(S, c, r, w, d) { return c >= 0 && r >= 0 && w >= 1 && d >= 1 && c + w <= S.cols && r + d <= S.rows; }
function collides(bins, c, r, w, d, exceptId) {
  return bins.some(function (b) { return b.id !== exceptId && c < b.c + b.w && b.c < c + w && r < b.r + b.d && b.r < r + d; });
}
function canPlace(S, bins, c, r, w, d, exceptId) { return inBounds(S, c, r, w, d) && !collides(bins, c, r, w, d, exceptId); }
function binAt(bins, c, r) {
  for (var i = 0; i < bins.length; i++) { var b = bins[i]; if (c >= b.c && c < b.c + b.w && r >= b.r && r < b.r + b.d) return b; }
  return null;
}
function usedCells(bins) { return bins.reduce(function (s, b) { return s + b.w * b.d; }, 0); }
function findSpot(S, bins, w, d, exceptId) {
  for (var r = 0; r < S.rows; r++) for (var c = 0; c < S.cols; c++) if (canPlace(S, bins, c, r, w, d, exceptId)) return { c: c, r: r };
  return null;
}

// New counts with bins already placed: every bin keeps its cell position and size. A bin that now runs past the far
// edge is cut back to the grid; a bin whose first cell is gone is dropped. Nothing grows, so nothing can overlap.
// Returns new bin objects (the input is untouched) plus which ones were clipped or dropped.
function regrid(bins, cols, rows) {
  var out = [], clipped = [], dropped = [];
  bins.forEach(function (b) {
    if (b.c >= cols || b.r >= rows) { dropped.push(b); return; }
    var nb = Object.assign({}, b, { w: Math.min(b.w, cols - b.c), d: Math.min(b.d, rows - b.r) });
    if (nb.w !== b.w || nb.d !== b.d) clipped.push(nb);
    out.push(nb);
  });
  return { bins: out, clipped: clipped, dropped: dropped };
}

// The bin sizes auto-fill tries, best first: biggest area, then the squarest (sturdier, and long thin prints warp),
// then wider before deeper. Only sizes that fit the bed.
function fillSizes(S) {
  var sizes = [];
  for (var w = 1; w <= S.cols; w++) for (var d = 1; d <= S.rows; d++) if (fitsBed(S, w, d)) sizes.push({ w: w, d: d });
  sizes.sort(function (a, b) {
    return (b.w * b.d - a.w * a.d) || (Math.min(b.w, b.d) / Math.max(b.w, b.d) - Math.min(a.w, a.d) / Math.max(a.w, a.d)) || (b.w - a.w);
  });
  return sizes;
}
// Fill every empty cell, greedy and deterministic: walk the cells front row first, left to right, and at each empty
// one place the first size from fillSizes that fits there. newBin(c, r, w, d) makes a bin. Returns the new bins.
function autoFill(S, bins, newBin) {
  var occ = [], added = [], sizes = fillSizes(S);
  for (var r = 0; r < S.rows; r++) { occ.push([]); for (var c = 0; c < S.cols; c++) occ[r].push(false); }
  function mark(b) { for (var rr = b.r; rr < b.r + b.d; rr++) for (var cc = b.c; cc < b.c + b.w; cc++) if (rr < S.rows && cc < S.cols) occ[rr][cc] = true; }
  function free(c0, r0, w, d) {
    if (c0 + w > S.cols || r0 + d > S.rows) return false;
    for (var rr = r0; rr < r0 + d; rr++) for (var cc = c0; cc < c0 + w; cc++) if (occ[rr][cc]) return false;
    return true;
  }
  bins.forEach(mark);
  for (var r1 = 0; r1 < S.rows; r1++) for (var c1 = 0; c1 < S.cols; c1++) {
    if (occ[r1][c1]) continue;
    for (var i = 0; i < sizes.length; i++) {
      if (free(c1, r1, sizes[i].w, sizes[i].d)) { var nb = newBin(c1, r1, sizes[i].w, sizes[i].d); added.push(nb); mark(nb); break; }
    }
  }
  return added;
}

// Split a bin in two across W (left | right) or D (front | back). The left or front part gets the extra cell of an
// odd size. Returns the two cell rectangles, or null if the bin is one cell that way.
function splitParts(b, axis) {
  var n = axis === "w" ? b.w : b.d;
  if (n < 2) return null;
  var a = Math.ceil(n / 2);
  return axis === "w" ? [{ c: b.c, r: b.r, w: a, d: b.d }, { c: b.c + a, r: b.r, w: b.w - a, d: b.d }]
                      : [{ c: b.c, r: b.r, w: b.w, d: a }, { c: b.c, r: b.r + a, w: b.w, d: b.d - a }];
}
// The rectangle two or more bins fill exactly, or null if they leave a gap. Bins never overlap, so they fill their
// bounding box exactly when their cells add up to its area.
function mergeRect(list) {
  if (!list || list.length < 2) return null;
  var c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
  list.forEach(function (b) { c0 = Math.min(c0, b.c); r0 = Math.min(r0, b.r); c1 = Math.max(c1, b.c + b.w); r1 = Math.max(r1, b.r + b.d); });
  return usedCells(list) === (c1 - c0) * (r1 - r0) ? { c: c0, r: r0, w: c1 - c0, d: r1 - r0 } : null;
}

// Top-rim corner radii of a bin, in the order the mesh ring uses: front-right, back-right, back-left, front-left.
// A bin in a corner of a rounded drawer gets that one corner rounded to match the drawer, concentric with it.
var CORNER_NAMES = ["FR", "BR", "BL", "FL"];
function cornerRadii(S, b) {
  var R = S.drawerR - S.wallClear, out = [S.cornerR, S.cornerR, S.cornerR, S.cornerR];
  if (!(R > S.cornerR)) return out;
  var left = b.c === 0, right = b.c + b.w === S.cols, front = b.r === 0, back = b.r + b.d === S.rows;
  if (front && right) out[0] = R;
  if (back && right) out[1] = R;
  if (back && left) out[2] = R;
  if (front && left) out[3] = R;
  return out;
}

export { TARGET_CELL, MIN_CELL, MAX_COUNT, CORNER_NAMES, gridSpan, maxCount, suggestCount, pitch, footprint, fitsBed, oversized, binBox,
         inBounds, collides, canPlace, binAt, usedCells, findSpot, regrid, fillSizes, autoFill, splitParts, mergeRect, cornerRadii };
