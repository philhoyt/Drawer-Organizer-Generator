// Golden exports. Each checksum was recorded by driving the real page in the browser through the same steps (clicks,
// typed values, the Auto-fill button) and catching the zip that Download all bins hands to the browser. Node builds
// the same zip here, so the two agree byte for byte. If one changes, the geometry or the export format changed;
// re-record only on purpose, and confirm the browser produces the same value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestCount } from "../src/layout.js";
import { fresh, hashZip } from "./helpers.js";

// First visit, then Auto-fill.
export function starterFilled() { const t = fresh(); t.starter(); t.fill(); return t; }

// Inches: a 15 3/4 x 11 3/4 x 2 1/2 in drawer with 1/2 in corners, Auto-fill, then options on the first three bins.
export function inchDrawer() {
  const t = fresh(), S = t.S; t.starter();
  Object.assign(S, { units: "in", drawerW: 400.05, drawerD: 298.45, drawerH: 63.5, drawerR: 12.7 });
  S.cols = suggestCount(S, "x"); S.rows = suggestCount(S, "y");
  t.fill();
  Object.assign(S.bins[0], { stack: true, split: "4", trayDivW: 2 });
  Object.assign(S.bins[1], { divW: 3, divD: 2 });
  S.bins[2].h = 38.1; // typed as 1 1/2
  return t;
}

// Changed fit settings and a hand-set 7 x 5 grid, then Auto-fill.
export function customFit() {
  const t = fresh(), S = t.S; t.starter();
  Object.assign(S, { binClear: 0.3, wallClear: 0.5, wall: 2, draft: 2, bedX: 180, bedY: 180 });
  S.autoGrid = false; S.cols = 7; S.rows = 5;
  t.fill();
  return t;
}

test("first visit, auto-filled", async () => {
  const { S, ex } = starterFilled();
  assert.equal(ex.allBinsFiles().name, "drawer-400x300x60-" + S.bins.length + "-bins.zip");
  assert.equal(await hashZip(ex.allBinsFiles().files), "fbae2e0c306a67c8:87600");
});

test("inch drawer with rounded corners, a stacked bin, a divided bin, and a shorter bin", async () => {
  const { ex } = inchDrawer();
  assert.equal(await hashZip(ex.allBinsFiles().files), "94df6bec87ff5ab0:150306");
});

test("changed fit settings and a hand-set grid", async () => {
  const { ex } = customFit();
  assert.equal(await hashZip(ex.allBinsFiles().files), "13a55c1a6f490bea:73010");
});
