// Shared bits for the tests: a fresh state built the way the app builds it, mesh checks, volumes, and a hash of exported bytes.
import { createState, makeBin } from "../src/state.js";
import { autoFill } from "../src/layout.js";
import { createGeometry } from "../src/geometry.js";
import { createExport, zip } from "../src/export.js";

export function fresh(opts) {
  var S = Object.assign(createState(), opts || {}), id = 1;
  var newBin = function (c, r, w, d, o) { return makeBin(id++, c, r, w, d, o); };
  var geo = createGeometry(S), ex = createExport(S, geo);
  return {
    S: S, newBin: newBin, geo: geo, ex: ex,
    // the two bins a first visit starts with
    starter: function () { S.bins = [newBin(0, 0, 2, 2), newBin(2, 0, 1, 2)]; S.selId = S.bins[1].id; },
    // the Auto-fill button: new bins take the selected bin's height
    fill: function () { var base = S.bins.find(function (b) { return b.id === S.selId; }), o = base ? { h: base.h } : {}; S.bins = S.bins.concat(autoFill(S, S.bins, function (c, r, w, d) { return newBin(c, r, w, d, o); })); }
  };
}

// Every directed edge must be matched by the same number of edges running the other way: true for one closed shell
// and for a union of closed shells (dividers, ribs). Also flags triangles with no area.
export function meshErrors(tris) {
  var edges = {}, errs = [], key = function (p) { return p[0] + "," + p[1] + "," + p[2]; };
  tris.forEach(function (t, i) {
    var a = t[0], b = t[1], c = t[2];
    var ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    var nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    if (Math.sqrt(nx * nx + ny * ny + nz * nz) < 1e-9) errs.push("degenerate triangle " + i);
    [[a, b], [b, c], [c, a]].forEach(function (e) { var k = key(e[0]) + "|" + key(e[1]); edges[k] = (edges[k] || 0) + 1; });
  });
  Object.keys(edges).forEach(function (k) {
    var rev = k.split("|").reverse().join("|");
    if (edges[k] !== (edges[rev] || 0)) errs.push("edge " + k + " used " + edges[k] + "x, reverse " + (edges[rev] || 0) + "x");
  });
  return errs;
}

// ---- expected volumes, worked out from the spec rather than from the mesh code
// A rounded-rectangle section: width, depth, and four corner radii, clamped the way a ring is (0.3 min, half a side max).
// Each corner is an 8-segment polygon arc, so the area is exact for the mesh.
var SEG = 8, CORNER_LOSS = 1 - SEG / 2 * Math.sin(Math.PI / 2 / SEG);
export function section(w, h, r) {
  var R = (Array.isArray(r) ? r : [r, r, r, r]).map(function (v) { return Math.max(0.3, Math.min(v, w / 2 - 0.05, h / 2 - 0.05)); });
  return { w: w, h: h, r: R };
}
function area(s) { return s.w * s.h - s.r.reduce(function (a, v) { return a + CORNER_LOSS * v * v; }, 0); }
// Volume of a loft between two sections whose vertices move in straight lines: the area is quadratic in z, so Simpson is exact.
export function loft(a, b, z0, z1) {
  var m = { w: (a.w + b.w) / 2, h: (a.h + b.h) / 2, r: a.r.map(function (v, i) { return (v + b.r[i]) / 2; }) };
  return (z1 - z0) / 6 * (area(a) + 4 * area(m) + area(b));
}
export function off(r, d) { return (Array.isArray(r) ? r : [r, r, r, r]).map(function (v) { return v - d; }); }

// Two FNV-style passes plus the byte count, the same checksum the browser probe computes when baselines are recorded.
export function hashBytes(u) {
  var h1 = 0x811c9dc5, h2 = 0x1000193;
  for (var i = 0; i < u.length; i++) { h1 = Math.imul(h1 ^ u[i], 0x01000193) >>> 0; h2 = Math.imul(h2 ^ u[i], 0x9E3779B1) >>> 0; }
  return h1.toString(16) + h2.toString(16) + ":" + u.length;
}
export async function hashZip(files) { return hashBytes(new Uint8Array(await zip(files).arrayBuffer())); }

export async function unzip(files) { // names and STL triangle counts of a file list, via the real zip bytes
  var u = new Uint8Array(await zip(files).arrayBuffer()), dv = new DataView(u.buffer), out = [], o = 0;
  while (o + 30 <= u.length && dv.getUint32(o, true) === 0x04034b50) {
    var size = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), el = dv.getUint16(o + 28, true);
    var name = new TextDecoder().decode(u.subarray(o + 30, o + 30 + nl)), start = o + 30 + nl + el;
    out.push({ name: name, size: size, tris: name.endsWith(".stl") ? new DataView(u.buffer, start).getUint32(80, true) : null });
    o = start + size;
  }
  return out;
}
