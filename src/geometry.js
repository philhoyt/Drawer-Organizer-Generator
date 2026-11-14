// Meshes for bins, trays, dividers, and ribs, as triangle lists ready for STL.
// createGeometry(S) binds the builders to the settings object (drawer, grid, fit); everything else is pure.
// Bin coordinates: centred on x (width) and y (depth, +y toward the back of the drawer), z up from the bed.
import { TRAY_GAP, DIVIDER_T, MIN_BIN_H, MIN_STACK_PART } from "./state.js";
import { footprint, cornerRadii } from "./layout.js";

// ---------------------------------------------------------------- mesh primitives
function flatten(parts) { var all = []; parts.forEach(function (q) { Array.prototype.push.apply(all, q); }); return all; }
// Trig that gives the same bits in every JavaScript engine. Engines differ in the last bit of Math.sin and friends,
// which shows up in exported STL bytes and would make golden tests engine-dependent. Reduce to [-pi/4, pi/4], then a
// short series in plain arithmetic, which IEEE 754 rounds identically everywhere. Accurate to about 1e-14.
function sincos(a) {
  var k = Math.round(a / (Math.PI / 2)), r = a - k * (Math.PI / 2), r2 = r * r;
  var s = r * (1 - r2 / 6 * (1 - r2 / 20 * (1 - r2 / 42 * (1 - r2 / 72 * (1 - r2 / 110 * (1 - r2 / 156 * (1 - r2 / 210)))))));
  var c = 1 - r2 / 2 * (1 - r2 / 12 * (1 - r2 / 30 * (1 - r2 / 56 * (1 - r2 / 90 * (1 - r2 / 132 * (1 - r2 / 182))))));
  switch (((k % 4) + 4) % 4) { case 0: return [c, s]; case 1: return [-s, c]; case 2: return [-c, -s]; default: return [s, -c]; }
}
function cosz(a) { return sincos(a)[0]; }
function sinz(a) { return sincos(a)[1]; }
function tanDeg(deg) { var sc = sincos(deg * Math.PI / 180); return sc[1] / sc[0]; }
// Corner radii are four numbers in ring order: front-right (+x -y), back-right, back-left, front-left.
function radii4(r) { return Array.isArray(r) ? r.slice() : [r, r, r, r]; }
function offsetR(r, d) { return radii4(r).map(function (v) { return v - d; }); }
function lerpR(a, b, k) { var A = radii4(a), B = radii4(b); return A.map(function (v, i) { return v + (B[i] - v) * k; }); }
// The radius a ring actually uses: never below 0.3, never more than half the shorter side.
function clampR(r, w, h) { return Math.max(0.3, Math.min(r, w / 2 - 0.05, h / 2 - 0.05)); }
function ring(w, h, r, z, seg) {
  var R = radii4(r).map(function (v) { return clampR(v, w, h); }), pts = [];
  [[1, -1, -90], [1, 1, 0], [-1, 1, 90], [-1, -1, 180]].forEach(function (cr, k) {
    var rk = R[k], cx = cr[0] * (w / 2 - rk), cy = cr[1] * (h / 2 - rk);
    for (var i = 0; i <= seg; i++) { var a = (cr[2] + 90 * i / seg) * Math.PI / 180; pts.push([cx + rk * cosz(a), cy + rk * sinz(a), z]); }
  });
  return pts;
}
function strip(tris, a, b) { var n = a.length; for (var i = 0; i < n; i++) { var j = (i + 1) % n; tris.push([a[i], a[j], b[j]], [a[i], b[j], b[i]]); } }
function capFace(tris, p, up) {
  var c = [0, 0, 0]; p.forEach(function (q) { c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; });
  c = c.map(function (v) { return v / p.length; });
  for (var i = 0; i < p.length; i++) { var j = (i + 1) % p.length; tris.push(up ? [c, p[i], p[j]] : [c, p[j], p[i]]); }
}
function signedVol(tris) {
  var v = 0;
  tris.forEach(function (t) { var a = t[0], b = t[1], c = t[2]; v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); });
  return v / 6;
}
function solid(tris) { if (signedVol(tris) < 0) tris.forEach(function (t) { var s = t[1]; t[1] = t[2]; t[2] = s; }); return tris; }
function hexa(v) {
  var F = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return solid(F.map(function (f) { return [v[f[0]], v[f[1]], v[f[2]]]; }));
}
function splitOf(split) { return { kx: (split === "w" || split === "4") ? 2 : 1, ky: (split === "d" || split === "4") ? 2 : 1 }; } // trays across W and D

var SEG = 8; // segments per rounded corner

// ---------------------------------------------------------------- builders bound to the settings
function createGeometry(S) {
  function binH(b) { return b.h > 0 ? Math.max(MIN_BIN_H, Math.min(b.h, S.drawerH)) : S.drawerH; }
  function canStack(b) { return binH(b) >= 2 * MIN_STACK_PART; }
  function stacked(b) { return !!b.stack && canStack(b); }
  function lowerH(b) { var full = binH(b), v = b.lowerH > 0 ? b.lowerH : full / 2; return Math.max(MIN_STACK_PART, Math.min(full - MIN_STACK_PART, v)); }
  function trayH(b) { return binH(b) - lowerH(b) + S.plugDepth; }
  function dims(b) {
    var f = footprint(S, b.w, b.d), h = stacked(b) ? lowerH(b) : binH(b);
    return { bx: f.x, by: f.y, h: h, full: binH(b), zt: h, zf: S.floorT, ins: h * tanDeg(S.draft), radii: cornerRadii(S, b) };
  }
  // outline of the outside and the inside at height z: width, depth, and the four corner radii
  function outerAt(D, z) { var k = 1 - z / D.h, d = D.ins * k; return { x: D.bx - 2 * d, y: D.by - 2 * d, r: offsetR(D.radii, d) }; }
  function innerAt(D, z) { var o = outerAt(D, z); return { x: o.x - 2 * S.wall, y: o.y - 2 * S.wall, r: offsetR(o.r, S.wall) }; }
  function trays(b) { // footprints of the top tray(s), in the base bin's local coordinates
    var D = dims(b), k = splitOf(b.split), kx = k.kx, ky = k.ky, R = D.radii;
    var tx = (D.bx - (kx - 1) * TRAY_GAP) / kx, ty = (D.by - (ky - 1) * TRAY_GAP) / ky, out = [];
    for (var i = 0; i < kx; i++) for (var j = 0; j < ky; j++) {
      // a tray corner that is also a corner of the bin keeps the bin's radius there
      var rr = [i === kx - 1 && j === 0, i === kx - 1 && j === ky - 1, i === 0 && j === ky - 1, i === 0 && j === 0].map(function (atCorner, c) { return atCorner ? R[c] : S.cornerR; });
      out.push({ i: i, j: j, bx: tx, by: ty, cx: -D.bx / 2 + tx / 2 + i * (tx + TRAY_GAP), cy: -D.by / 2 + ty / 2 + j * (ty + TRAY_GAP), radii: rr });
    }
    return out;
  }
  // Inner outline of a tray at height z: straight from the floor ring up to the rim ring.
  function trayInner(t, H) {
    var e = S.wall + S.plugClear, dr = S.plugDepth * tanDeg(S.draft);
    var i0x = t.bx - 2 * e - 2 * dr - 2 * S.wall, i0y = t.by - 2 * e - 2 * dr - 2 * S.wall, i1x = t.bx - 2 * S.wall, i1y = t.by - 2 * S.wall;
    var r0 = offsetR(t.radii, e + S.wall), r1 = offsetR(t.radii, S.wall);
    return function (z) { var k = (z - S.floorT) / (H - S.floorT); return { x: i0x + (i1x - i0x) * k, y: i0y + (i1y - i0y) * k, r: lerpR(r0, r1, k) }; };
  }
  function buildTray(b, t) {
    // Prints right side up. Plug (sits inside the bin below) -> 45 deg chamfer -> straight body.
    var H = trayH(b), e = S.wall + S.plugClear, r = t.radii, dr = S.plugDepth * tanDeg(S.draft);
    var px = t.bx - 2 * e, py = t.by - 2 * e, sh = [];
    var P0 = ring(px - 2 * dr, py - 2 * dr, offsetR(r, e), 0, SEG), P1 = ring(px, py, offsetR(r, e), S.plugDepth, SEG);
    var B0 = ring(t.bx, t.by, r, S.plugDepth + e, SEG), B1 = ring(t.bx, t.by, r, H, SEG);
    var I1 = ring(t.bx - 2 * S.wall, t.by - 2 * S.wall, offsetR(r, S.wall), H, SEG);
    var I0 = ring(px - 2 * dr - 2 * S.wall, py - 2 * dr - 2 * S.wall, offsetR(r, e + S.wall), S.floorT, SEG);
    strip(sh, P0, P1); strip(sh, P1, B0); strip(sh, B0, B1); strip(sh, B1, I1); strip(sh, I1, I0); capFace(sh, I0, true); capFace(sh, P0, false);
    var parts = [solid(sh)];
    dividerWalls(parts, b.trayDivW, b.trayDivD, trayInner(t, H), S.floorT - 0.05, H);
    return flatten(parts);
  }
  // Divider walls: nW sections across W (walls perpendicular to x) and nD across D, from zlo to zhi.
  function dividerWalls(parts, nW, nD, inner, zlo, zhi) {
    for (var i = 1; i < nW; i++) spanBox(parts, inner, 0, i / nW - 0.5, DIVIDER_T, zlo, zhi);
    for (var j = 1; j < nD; j++) spanBox(parts, inner, 1, j / nD - 0.5, DIVIDER_T, zlo, zhi);
  }
  // A box between two opposite walls: perpendicular to axis p (0 = x, 1 = y) at fraction f of the inner width, t thick.
  // Each end runs a little into the wall so the slicer unions it with the shell. Near a rounded corner the end follows
  // the curve in, so a divider close to a big drawer-corner radius never pokes out through the outside.
  function spanBox(parts, inner, p, f, t, zlo, zhi) {
    var K = ["x", "y"], s = 1 - p, ov = S.wall * 0.7;
    // which ring corner each end of the box is nearest: [low end, high end] for a box on the - or + side of centre
    var CORNERS = p === 0 ? { neg: [3, 2], pos: [0, 1] } : { neg: [3, 0], pos: [2, 1] };
    function ends(z) {
      var I = inner(z), along = I[K[p]] / 2, across = I[K[s]] / 2, pos = f * I[K[p]], a = Math.abs(pos) + t / 2;
      var ks = pos < 0 ? CORNERS.neg : CORNERS.pos;
      return ks.map(function (k, side) {
        var r = clampR(I.r[k], I.x, I.y), e = across;
        if (a > along - r) { var dx = Math.min(a - (along - r), r); e = across - r + Math.sqrt(r * r - dx * dx); }
        return (side ? 1 : -1) * (e + ov);
      });
    }
    function corners(z) {
      var pos = f * inner(z)[K[p]], a = pos - t / 2, c = pos + t / 2, E = ends(z), lo = E[0], hi = E[1];
      return p === 0 ? [[a, lo, z], [c, lo, z], [c, hi, z], [a, hi, z]] : [[lo, a, z], [hi, a, z], [hi, c, z], [lo, c, z]];
    }
    parts.push(hexa(corners(zlo).concat(corners(zhi))));
  }
  function dividerTop(b, D) { return stacked(b) ? D.zt - S.plugDepth - 1 : D.zt; } // leave room for the tray plug
  function buildBin(b) {
    var D = dims(b), parts = [], sh = [];
    var ob = outerAt(D, 0), it = innerAt(D, D.zt), ifl = innerAt(D, D.zf);
    var O0 = ring(ob.x, ob.y, ob.r, 0, SEG), O1 = ring(D.bx, D.by, D.radii, D.zt, SEG);
    var I1 = ring(it.x, it.y, it.r, D.zt, SEG), I0 = ring(ifl.x, ifl.y, ifl.r, D.zf, SEG);
    strip(sh, O0, O1); strip(sh, O1, I1); strip(sh, I1, I0); capFace(sh, I0, true); capFace(sh, O0, false);
    parts.push(solid(sh));
    var innerB = function (z) { return innerAt(D, z); };
    dividerWalls(parts, b.divW, b.divD, innerB, D.zf - 0.05, dividerTop(b, D));
    if (stacked(b) && b.split !== "1") {
      // support ribs under split lines, up to rim height, sized to sit between neighbouring tray plugs
      var rt = 2 * S.wall + TRAY_GAP, sp = splitOf(b.split);
      if (sp.kx === 2) spanBox(parts, innerB, 0, 0, rt, D.zf - 0.05, D.zt);
      if (sp.ky === 2) spanBox(parts, innerB, 1, 0, rt, D.zf - 0.05, D.zt);
    }
    return flatten(parts);
  }

  return { binH: binH, canStack: canStack, stacked: stacked, lowerH: lowerH, trayH: trayH, dims: dims, outerAt: outerAt, innerAt: innerAt,
           trays: trays, trayInner: trayInner, buildTray: buildTray, buildBin: buildBin, dividerTop: dividerTop };
}

export { createGeometry, flatten, ring, strip, capFace, signedVol, solid, hexa, sincos, tanDeg, clampR, radii4, offsetR, splitOf, SEG };
