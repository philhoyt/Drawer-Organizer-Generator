import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, makeBin } from "../src/state.js";
import { pitch, footprint, fitsBed, oversized, binBox, maxCount, suggestCount, canPlace, binAt, usedCells, findSpot, regrid, fillSizes, cornerRadii } from "../src/layout.js";
import { fresh } from "./helpers.js";

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, (msg || "") + " " + a + " vs " + b);

test("cells stretch so bins fill the drawer with exact gaps", () => {
  const S = Object.assign(createState(), { drawerW: 412.7, drawerD: 287.3, binClear: 0.3, wallClear: 0.8, cols: 7, rows: 5 });
  close(pitch(S, "x"), (412.7 - 1.6 + 0.6) / 7); close(pitch(S, "y"), (287.3 - 1.6 + 0.6) / 5);
  // a full row of 1-wide bins: first off the left wall by wallClear, last off the right wall by wallClear, 2 x binClear between
  const row = [];
  for (let c = 0; c < 7; c++) row.push(binBox(S, makeBin(c + 1, c, 0, 1, 1)));
  close(row[0].x0, 0.8, "left wall gap"); close(S.drawerW - row[6].x1, 0.8, "right wall gap");
  for (let c = 1; c < 7; c++) close(row[c].x0 - row[c - 1].x1, 0.6, "gap between bins");
  // and any two bins of one size have one footprint, wherever they sit
  const a = binBox(S, makeBin(1, 0, 0, 2, 3)), b = binBox(S, makeBin(2, 4, 2, 2, 3)), f = footprint(S, 2, 3);
  close(a.x1 - a.x0, f.x); close(b.x1 - b.x0, f.x); close(a.y1 - a.y0, f.y); close(b.y1 - b.y0, f.y);
  // the back wall gap too
  close(S.drawerD - binBox(S, makeBin(3, 0, 0, 1, 5)).y1, 0.8);
});

test("suggested counts aim for 50 mm cells, within the 15 mm and 30-count limits", () => {
  const S = createState();
  assert.equal(suggestCount(S, "x"), 8); assert.equal(suggestCount(S, "y"), 6);
  Object.assign(S, { drawerW: 30, drawerD: 1500 });
  assert.equal(suggestCount(S, "x"), 1); assert.equal(maxCount(S, "x"), 2);
  assert.equal(suggestCount(S, "y"), 30); assert.equal(maxCount(S, "y"), 30);
  Object.assign(S, { drawerW: 140 });
  assert.equal(maxCount(S, "x"), 9); // 140 / 9 = 15.6 mm, 10 would be 14
});

test("the bed check allows either orientation", () => {
  const S = Object.assign(createState(), { bedX: 220, bedY: 160 }); // 50 mm cells, 49.5 mm bins per cell
  assert.ok(fitsBed(S, 4, 3)); // 199.5 x 149.5
  assert.ok(fitsBed(S, 3, 4)); // turned
  assert.ok(!fitsBed(S, 4, 4)); // 199.5 square needs 199.5 both ways
  assert.ok(!fitsBed(S, 5, 1)); // 249.5 long
  S.bins = [makeBin(1, 0, 0, 4, 4), makeBin(2, 4, 0, 3, 4)];
  assert.deepEqual(oversized(S, S.bins).map(b => b.id), [1]);
});

test("placement respects the grid and other bins", () => {
  const S = createState(); // 8 x 6
  const bins = [makeBin(1, 0, 0, 2, 2), makeBin(2, 2, 0, 1, 3)];
  assert.ok(!canPlace(S, bins, 1, 1, 1, 1)); assert.ok(canPlace(S, bins, 1, 1, 1, 1, 1)); // its own cells don't block a bin
  assert.ok(!canPlace(S, bins, 7, 0, 2, 1)); assert.ok(!canPlace(S, bins, 0, 5, 1, 2)); assert.ok(!canPlace(S, bins, -1, 0, 1, 1));
  assert.ok(canPlace(S, bins, 3, 0, 5, 6));
  assert.equal(binAt(bins, 2, 2).id, 2); assert.equal(binAt(bins, 3, 0), null);
  assert.equal(usedCells(bins), 7);
  assert.deepEqual(findSpot(S, bins, 2, 3), { c: 3, r: 0 });
  assert.deepEqual(findSpot(S, bins, 3, 4), { c: 3, r: 0 });
  assert.equal(findSpot(S, bins, 6, 6), null);
});

test("new counts keep bins in place, cut back the ones that run off, and drop the ones that start off the grid", () => {
  const bins = [makeBin(1, 0, 0, 2, 2), makeBin(2, 4, 0, 3, 2, { divW: 3 }), makeBin(3, 6, 3, 2, 2), makeBin(4, 1, 4, 2, 2)];
  const g = regrid(bins, 6, 5);
  assert.deepEqual(g.bins.map(b => [b.id, b.c, b.r, b.w, b.d]), [[1, 0, 0, 2, 2], [2, 4, 0, 2, 2], [4, 1, 4, 2, 1]]);
  assert.deepEqual(g.clipped.map(b => b.id), [2, 4]); assert.deepEqual(g.dropped.map(b => b.id), [3]);
  assert.equal(g.bins[1].divW, 3); assert.equal(bins[1].w, 3); // options kept, input untouched
  const same = regrid(bins, 10, 10); assert.equal(same.clipped.length + same.dropped.length, 0);
});

test("auto-fill sizes go biggest first, then squarest, then wider", () => {
  const S = Object.assign(createState(), { drawerW: 200, drawerD: 150, cols: 4, rows: 3, bedX: 160, bedY: 110 });
  const s = fillSizes(S).map(z => z.w + "x" + z.d);
  // 50 mm cells: 3x2 (149.5 x 99.5) fits; 4x anything and 3x3 do not
  assert.deepEqual(s.slice(0, 6), ["3x2", "2x3", "2x2", "3x1", "1x3", "2x1"]);
  assert.ok(!s.includes("3x3") && !s.includes("4x1"));
});

test("auto-fill covers every empty cell, stays on the bed, and is repeatable", () => {
  const run = () => { const t = fresh(); t.starter(); t.fill(); return t; };
  const t = run(), S = t.S;
  assert.equal(usedCells(S.bins), S.cols * S.rows);
  assert.equal(oversized(S, S.bins).length, 0);
  for (let i = 0; i < S.bins.length; i++) for (let j = i + 1; j < S.bins.length; j++) {
    const a = S.bins[i], b = S.bins[j];
    assert.ok(!(a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.d && b.r < a.r + a.d), "bins " + a.id + " and " + b.id + " overlap");
  }
  assert.deepEqual(S.bins.map(b => [b.c, b.r, b.w, b.d]), run().S.bins.map(b => [b.c, b.r, b.w, b.d]));
  assert.deepEqual(S.bins.slice(2).map(b => [b.c, b.r, b.w, b.d]), [[3, 0, 4, 4], [7, 0, 1, 4], [0, 2, 3, 4], [3, 4, 4, 2], [7, 4, 1, 2]]);
  // new bins take the selected bin's height
  const u = fresh(); u.starter(); u.S.bins[1].h = 40; u.fill();
  assert.ok(u.S.bins.slice(2).every(b => b.h === 40));
});

test("only a bin in a corner of a rounded drawer gets that corner rounded, concentric with the drawer", () => {
  const S = Object.assign(createState(), { drawerR: 12.25, wallClear: 0.25, cols: 8, rows: 6 });
  const r = (c, rr, w, d) => cornerRadii(S, makeBin(1, c, rr, w, d));
  assert.deepEqual(r(0, 0, 1, 1), [3, 3, 3, 12]);      // front-left
  assert.deepEqual(r(7, 5, 1, 1), [3, 12, 3, 3]);      // back-right
  assert.deepEqual(r(0, 0, 8, 6), [12, 12, 12, 12]);   // the whole drawer
  assert.deepEqual(r(3, 0, 2, 2), [3, 3, 3, 3]);       // against the front wall, not in a corner
  S.drawerR = 3; assert.deepEqual(r(0, 0, 1, 1), [3, 3, 3, 3]); // drawer radius no bigger than the bin's own
});
