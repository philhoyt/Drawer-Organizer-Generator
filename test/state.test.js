import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, restoreState, saveable, makeBin, parseLength, formatLength, cleanBin, layoutFile, readLayout, cleanLayouts, putLayout } from "../src/state.js";

test("lengths parse in mm and inches, with fractions and unit suffixes", () => {
  assert.equal(parseLength("365", "mm"), 365);
  assert.equal(parseLength(" 365.5 ", "mm"), 365.5);
  assert.equal(parseLength("14.375", "in"), 365.125);
  assert.equal(parseLength("14 3/8", "in"), 365.125);
  assert.equal(parseLength("14-3/8", "in"), 365.125);
  assert.ok(Math.abs(parseLength("3/8", "in") - 9.525) < 1e-9);
  assert.equal(parseLength("2\"", "mm"), 50.8);   // a suffix overrides the unit
  assert.equal(parseLength("2 in", "mm"), 50.8);
  assert.equal(parseLength("50mm", "in"), 50);
  assert.equal(parseLength(".5", "in"), 12.7);
  assert.equal(parseLength("12,5", "mm"), 12.5);  // decimal comma
  ["", "abc", "1/0", "-3", "1 2", "3/8/2", "1e3"].forEach(s => assert.ok(Number.isNaN(parseLength(s, "in")), s));
});

test("lengths format as mm to 0.1 and inches as sixteenths when they are one", () => {
  assert.equal(formatLength(365.125, "mm"), "365.1");
  assert.equal(formatLength(400, "mm"), "400");
  assert.equal(formatLength(365.125, "in"), "14 3/8");
  assert.equal(formatLength(25.4, "in"), "1");
  assert.equal(formatLength(12.7, "in"), "1/2");
  assert.equal(formatLength(100, "in"), "3 15/16"); // 3.937 in is within a fiftieth of a sixteenth of 3 15/16
  assert.equal(formatLength(110, "in"), "4.331");
});

test("a fresh state follows the suggested grid", () => {
  const S = createState();
  assert.deepEqual([S.drawerW, S.drawerD, S.drawerH, S.cols, S.rows, S.autoGrid, S.units], [400, 300, 60, 8, 6, true, "mm"]);
});

test("restore drops bad bins, clamps bad numbers, and keeps oversize bins for flagging", () => {
  const S = createState();
  const next = restoreState(S, {
    units: "furlongs", drawerW: 99999, drawerD: "abc", drawerH: 80, wall: -1, binClear: 0.3, bedX: 120, autoGrid: false, cols: 50, rows: 4, view: "weird", selId: 77,
    bins: [
      { id: 1, c: 0, r: 0, w: 2, d: 2, split: "x", divW: "3", stack: 1, h: -5, trayDivD: 40 },
      { id: 2, c: 1, r: 1, w: 1, d: 1 },            // overlaps bin 1
      { id: 3, c: 0, r: 3, w: 1, d: 2 },            // runs off the 4-row grid
      { id: 4, c: 2, r: 0, w: 3, d: 1, h: 30.5 },  // 3 cells of 50 mm: bigger than a 120 mm bed, kept
      { id: 4, c: 6, r: 0, w: 1, d: 1 },            // duplicate id
      { id: 1.5, c: 7, r: 0, w: 1, d: 1 }, null, "junk", { id: 9, c: -1, r: 0, w: 1, d: 1 }
    ]
  });
  assert.equal(S.units, "mm"); assert.equal(S.drawerW, 1500); assert.equal(S.drawerD, 300); assert.equal(S.drawerH, 80);
  assert.equal(S.wall, 0.8); assert.equal(S.binClear, 0.3); assert.equal(S.bedX, 120); assert.equal(S.view, "drawer");
  assert.equal(S.cols, 30); assert.equal(S.rows, 4); assert.equal(S.autoGrid, false);
  assert.deepEqual(S.bins.map(b => [b.id, b.split, b.divW, b.stack, b.h, b.trayDivD]), [[1, "1", 1, true, 0, 8], [4, "1", 1, false, 30.5, 1]]);
  assert.equal(S.selId, 1); assert.equal(next, 5);
});

test("restore with automatic counts recomputes them from the drawer", () => {
  const S = createState();
  restoreState(S, { drawerW: 600, drawerD: 120, autoGrid: true, cols: 3, rows: 9, units: "in" });
  assert.deepEqual([S.cols, S.rows, S.units], [12, 2, "in"]);
});

test("saved state round-trips", () => {
  const S = createState();
  S.units = "in"; S.drawerR = 12.7; S.autoGrid = false; S.cols = 5; S.rows = 4;
  S.bins = [makeBin(3, 0, 0, 2, 2, { stack: true, split: "4", lowerH: 25 }), makeBin(7, 2, 0, 1, 3, { h: 40, divW: 3 })]; S.selId = 7;
  const T = createState(), next = restoreState(T, JSON.parse(JSON.stringify(saveable(S))));
  assert.deepEqual(saveable(T), saveable(S)); assert.equal(next, 8);
});

test("cleanBin rejects junk and fills missing options", () => {
  assert.equal(cleanBin({ id: 1, c: 0, r: 0, w: 0, d: 1 }), null);
  assert.equal(cleanBin({ id: 1, c: 0, r: 0, w: 31, d: 1 }), null);
  assert.deepEqual(cleanBin({ id: 2, c: 1, r: 2, w: 1, d: 1 }), { id: 2, c: 1, r: 2, w: 1, d: 1, h: 0, divW: 1, divD: 1, stack: false, lowerH: 0, split: "1", trayDivW: 1, trayDivD: 1, scoop: false });
  assert.equal(cleanBin({ id: 2, c: 1, r: 2, w: 1, d: 1, scoop: "yes" }).scoop, true);
});

test("a layout file round-trips, and anything else is refused", () => {
  const S = createState();
  S.drawerW = 455; S.drawerR = 10; S.autoGrid = false; S.cols = 7; S.rows = 5;
  S.bins = [makeBin(4, 0, 0, 2, 2, { scoop: true, stack: true, lowerH: 22 }), makeBin(9, 3, 1, 1, 3, { divD: 3 })]; S.selId = 9;
  const file = JSON.parse(JSON.stringify(layoutFile(S, "  Kitchen   left ")));
  assert.equal(file.name, "Kitchen left"); assert.equal(file.format, "drawer-organizer-layout");
  const got = readLayout(file);
  assert.deepEqual(saveable(got.S), saveable(S)); assert.equal(got.nextId, 10); assert.equal(got.dropped, 0);
  [null, "x", {}, { format: "something-else", bins: [] }, saveable(S)].forEach(d => assert.equal(readLayout(d), null));
  // bins that no longer fit are dropped and counted
  const bad = Object.assign({}, file, { bins: file.bins.concat([{ id: 20, c: 0, r: 0, w: 1, d: 1 }, "junk"]) });
  assert.equal(readLayout(bad).dropped, 2);
});

test("saved layouts: same name replaces, newest first, junk dropped", () => {
  const d = layoutFile(createState(), "a");
  let r = putLayout([], "Desk", d, 1); r = putLayout(r.list, "Tools", d, 2);
  assert.equal(r.replaced, false);
  r = putLayout(r.list, " desk ", d, 3);
  assert.equal(r.replaced, true); assert.deepEqual(r.list.map(l => l.name), ["desk", "Tools"]);
  const cleaned = cleanLayouts([{ name: "Old", savedAt: 5, data: d }, { name: "", data: d }, { name: "x", data: {} }, null, { name: "New", savedAt: 9, data: d }]);
  assert.deepEqual(cleaned.map(l => l.name), ["New", "Old"]);
  assert.deepEqual(cleanLayouts("junk"), []);
});
