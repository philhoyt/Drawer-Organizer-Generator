// Every printable part must be a closed mesh, and its enclosed volume must match the volume worked out from the spec:
// a tapered shell from the bed to the rim minus the cavity, plus dividers and ribs. Sections are lofted, so Simpson's
// rule gives the exact volume of the faceted mesh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signedVol } from "../src/geometry.js";
import { footprint } from "../src/layout.js";
import { DIVIDER_T, TRAY_GAP } from "../src/state.js";
import { fresh, meshErrors, section, loft, off } from "./helpers.js";

const tan = deg => Math.tan(deg * Math.PI / 180);
function near(actual, expected, what) { assert.ok(Math.abs(actual - expected) <= 1e-6 * expected, what + ": " + actual + " vs " + expected); }

// the bin shell alone: outer loft from the bed to the rim, minus the cavity from the floor to the rim
function shellVolume(S, b, h, radii) {
  const f = footprint(S, b.w, b.d), ins = h * tan(S.draft);
  const at = z => { const d = ins * (1 - z / h); return { x: f.x - 2 * d, y: f.y - 2 * d, r: off(radii, d) }; };
  const O0 = at(0), Izf = at(S.floorT);
  const outer = loft(section(O0.x, O0.y, O0.r), section(f.x, f.y, radii), 0, h);
  const cavity = loft(section(Izf.x - 2 * S.wall, Izf.y - 2 * S.wall, off(Izf.r, S.wall)), section(f.x - 2 * S.wall, f.y - 2 * S.wall, off(radii, S.wall)), S.floorT, h);
  return { v: outer - cavity, inner: z => { const o = at(z); return { x: o.x - 2 * S.wall, y: o.y - 2 * S.wall }; } };
}
// a wall from zlo to zhi, t thick, across the inner outline plus 0.7 wall into each side (away from rounded corners)
function wallVolume(S, inner, axis, t, zlo, zhi) { const L = z => inner(z)[axis] + 1.4 * S.wall; return t * (zhi - zlo) * (L(zlo) + L(zhi)) / 2; }
function trayVolume(S, t, H) {
  const e = S.wall + S.plugClear, dr = S.plugDepth * tan(S.draft), px = t.bx - 2 * e, py = t.by - 2 * e, r = t.radii, pd = S.plugDepth;
  const P0 = section(px - 2 * dr, py - 2 * dr, off(r, e)), P1 = section(px, py, off(r, e)), B = section(t.bx, t.by, r);
  const I1 = section(t.bx - 2 * S.wall, t.by - 2 * S.wall, off(r, S.wall)), I0 = section(px - 2 * dr - 2 * S.wall, py - 2 * dr - 2 * S.wall, off(r, e + S.wall));
  return loft(P0, P1, 0, pd) + loft(P1, B, pd, pd + e) + loft(B, B, pd + e, H) - loft(I0, I1, S.floorT, H);
}
function closed(tris, what) { const errs = meshErrors(tris); assert.deepEqual(errs.slice(0, 3), [], what + " is not closed"); }

test("plain bins are closed and hold the expected volume, across sizes, heights, and fit settings", () => {
  [{}, { wall: 2.4, floorT: 1.2, cornerR: 6, draft: 0, binClear: 0.5 }, { draft: 3.5, cornerR: 0.5, drawerH: 120 }].forEach((fit, k) => {
    const { S, geo, newBin } = fresh(fit);
    [[1, 1, 0], [2, 3, 0], [3, 1, 25.5], [1, 4, 12]].forEach(([w, d, h]) => {
      const b = newBin(2, 1, w, d, { h }), tris = geo.buildBin(b), H = geo.binH(b);
      closed(tris, "bin " + w + "x" + d);
      near(signedVol(tris), shellVolume(S, b, H, [S.cornerR, S.cornerR, S.cornerR, S.cornerR]).v, "fit " + k + " bin " + w + "x" + d + "x" + H);
      assert.equal(Math.max(...tris.flat().map(p => p[2])), H);
      assert.equal(Math.min(...tris.flat().map(p => p[2])), 0);
    });
  });
});

test("a bin in the corner of a rounded drawer is closed, rounded on that corner only, and holds the expected volume", () => {
  const { S, geo, newBin } = fresh({ drawerR: 20 });
  const b = newBin(7, 0, 1, 2), D = geo.dims(b); // front-right corner
  assert.deepEqual(D.radii, [19.75, 3, 3, 3]);
  const tris = geo.buildBin(b);
  closed(tris, "corner bin");
  near(signedVol(tris), shellVolume(S, b, 60, D.radii).v, "corner bin");
});

test("divided bins are closed, and the dividers add their own volume", () => {
  const { S, geo, newBin } = fresh();
  const b = newBin(0, 0, 2, 2, { divW: 3, divD: 2 }), tris = geo.buildBin(b);
  closed(tris, "divided bin");
  const sh = shellVolume(S, b, 60, [3, 3, 3, 3]), zlo = S.floorT - 0.05;
  const expect = sh.v + 2 * wallVolume(S, sh.inner, "y", DIVIDER_T, zlo, 60) + wallVolume(S, sh.inner, "x", DIVIDER_T, zlo, 60);
  near(signedVol(tris), expect, "divided bin");
});

test("stacked bins: base with ribs and trays are closed, hold their volumes, and add up to the bin height", () => {
  const { S, geo, newBin } = fresh({ drawerH: 70 });
  const b = newBin(0, 0, 2, 2, { stack: true, split: "4", lowerH: 32, divW: 2, trayDivW: 2, trayDivD: 3 });
  assert.equal(geo.lowerH(b), 32); assert.equal(geo.trayH(b) - S.plugDepth + geo.lowerH(b), 70);
  const base = geo.buildBin(b);
  closed(base, "stack base");
  const sh = shellVolume(S, b, 32, [3, 3, 3, 3]), zlo = S.floorT - 0.05, rib = 2 * S.wall + TRAY_GAP;
  const expect = sh.v + wallVolume(S, sh.inner, "y", DIVIDER_T, zlo, 32 - S.plugDepth - 1) + wallVolume(S, sh.inner, "y", rib, zlo, 32) + wallVolume(S, sh.inner, "x", rib, zlo, 32);
  near(signedVol(base), expect, "stack base with ribs");
  const ts = geo.trays(b);
  assert.equal(ts.length, 4);
  ts.forEach((t, k) => {
    const tris = geo.buildTray(b, t), H = geo.trayH(b);
    closed(tris, "tray " + k);
    assert.equal(Math.max(...tris.flat().map(p => p[2])), H);
    const tv = trayVolume(S, t, H);
    const inner = z => { const k2 = (z - S.floorT) / (H - S.floorT), e = S.wall + S.plugClear, dr = S.plugDepth * tan(S.draft);
      return { x: t.bx - 2 * S.wall - (2 * e + 2 * dr) * (1 - k2), y: t.by - 2 * S.wall - (2 * e + 2 * dr) * (1 - k2) }; };
    const divs = wallVolume(S, inner, "y", DIVIDER_T, S.floorT - 0.05, H) + 2 * wallVolume(S, inner, "x", DIVIDER_T, S.floorT - 0.05, H);
    near(signedVol(tris), tv + divs, "tray " + k);
  });
});

test("a single tray on a rounded corner bin keeps the drawer radius on that corner", () => {
  const { S, geo, newBin } = fresh({ drawerR: 15 });
  const b = newBin(0, 5, 2, 1, { stack: true, split: "1" }), ts = geo.trays(b); // back-left corner
  assert.deepEqual(ts[0].radii, [3, 3, 14.75, 3]);
  const tris = geo.buildTray(b, ts[0]);
  closed(tris, "rounded tray");
  near(signedVol(tris), trayVolume(S, ts[0], geo.trayH(b)), "rounded tray");
  const split = newBin(6, 0, 2, 2, { stack: true, split: "4" }); // front-right corner
  assert.deepEqual(geo.trays(split).map(t => t.radii), [[3, 3, 3, 3], [3, 3, 3, 3], [14.75, 3, 3, 3], [3, 3, 3, 3]]);
});

test("dividers near a big drawer-corner radius stay inside the bin", () => {
  const { S, geo, newBin } = fresh({ drawerR: 40, drawerW: 120, drawerD: 120 });
  S.cols = 3; S.rows = 3;
  const b = newBin(0, 0, 1, 1, { divW: 10, divD: 10 }), D = geo.dims(b), tris = geo.buildBin(b);
  closed(tris, "crowded corner bin");
  // every vertex inside the outer outline at its height (rounded corners included)
  tris.flat().forEach(p => {
    const o = geo.outerAt(D, p[2]), hx = o.x / 2, hy = o.y / 2, k = (p[0] >= 0 ? (p[1] >= 0 ? 1 : 0) : (p[1] >= 0 ? 2 : 3));
    const r = Math.max(0.3, Math.min(o.r[k], hx - 0.05, hy - 0.05)), ax = Math.abs(p[0]), ay = Math.abs(p[1]);
    assert.ok(ax <= hx + 1e-9 && ay <= hy + 1e-9, "outside the box at " + p);
    if (ax > hx - r && ay > hy - r) assert.ok(Math.hypot(ax - (hx - r), ay - (hy - r)) <= r + 1e-9, "outside the rounded corner at " + p);
  });
});

test("bin heights: drawer height by default, a shorter override, never taller, stacking needs 30 mm", () => {
  const { geo, newBin } = fresh({ drawerH: 45 });
  assert.equal(geo.binH(newBin(0, 0, 1, 1)), 45);
  assert.equal(geo.binH(newBin(0, 0, 1, 1, { h: 22.5 })), 22.5);
  assert.equal(geo.binH(newBin(0, 0, 1, 1, { h: 80 })), 45);
  assert.equal(geo.binH(newBin(0, 0, 1, 1, { h: 4 })), 10);
  assert.ok(geo.stacked(newBin(0, 0, 1, 1, { stack: true })));
  assert.ok(!geo.stacked(newBin(0, 0, 1, 1, { stack: true, h: 29 })));
  assert.equal(geo.lowerH(newBin(0, 0, 1, 1, { stack: true, lowerH: 40 })), 30); // leaves 15 mm for the tray
});
