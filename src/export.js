// Names, grouping, and files: the STL and zip writers. createExport(S, geo) binds naming and packaging to the
// settings and a geometry instance.
import { CORNER_NAMES } from "./layout.js";
import { splitOf } from "./geometry.js";

// ---------------------------------------------------------------- file formats
function toSTL(tris, label) {
  var buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf);
  var head = "Drawer bin " + label;
  for (var i = 0; i < head.length && i < 80; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, tris.length, true);
  var o = 84;
  tris.forEach(function (t) {
    var a = t[0], b = t[1], c = t[2];
    var ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    var nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    [nx/l, ny/l, nz/l].concat(a, b, c).forEach(function (v) { dv.setFloat32(o, v, true); o += 4; });
    dv.setUint16(o, 0, true); o += 2;
  });
  return new Uint8Array(buf);
}
var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) { // stored (uncompressed) zip; no timestamps, so the bytes depend only on the files
  var enc = new TextEncoder(), locals = [], central = [], offset = 0;
  files.forEach(function (f) {
    var name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data), size = data.length;
    var lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
    locals.push(new Uint8Array(lh.buffer), name, data);
    var ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  });
  var cSize = central.reduce(function (s, a) { return s + a.length; }, 0);
  var end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cSize, true); end.setUint32(16, offset, true);
  return new Blob(locals.concat(central, [new Uint8Array(end.buffer)]), { type: "application/zip" });
}
function f1(v) { return (Math.round(v * 10) / 10).toString(); }
function stlName(g) { return g.stem + (g.count > 1 ? "-x" + g.count : "") + ".stl"; }
var SPLIT_NAME = { "1": "", w: "-split2w", d: "-split2d", "4": "-split4" };

// ---------------------------------------------------------------- bound to the settings
function createExport(S, geo) {
  // "-round12-FL": corners rounded to match a rounded drawer, with the radius and which corners
  function roundTag(radii) {
    var hit = []; radii.forEach(function (r, k) { if (r !== S.cornerR) hit.push(k); });
    if (!hit.length) return "";
    return "-round" + f1(radii[hit[0]]) + "-" + hit.map(function (k) { return CORNER_NAMES[k]; }).sort().join("");
  }
  // grid cells, then the top footprint and height in real millimetres: 2x3-108x96x60
  function sizeStem(b) { var D = geo.dims(b); return b.w + "x" + b.d + "-" + Math.round(D.bx) + "x" + Math.round(D.by) + "x" + f1(geo.binH(b)); }
  function fileStem(b) {
    var D = geo.dims(b), s = sizeStem(b);
    if (geo.stacked(b)) s += "-stack-base" + f1(geo.lowerH(b)) + (b.split === "1" ? "" : "-rib" + b.split);
    if (b.divW > 1 || b.divD > 1) s += "-div" + b.divW + "x" + b.divD;
    if (b.scoop) s += "-scoop";
    return s + roundTag(D.radii);
  }
  function trayStem(b, t) {
    return sizeStem(b) + "-stack-top" + f1(geo.trayH(b)) + SPLIT_NAME[b.split] + (b.trayDivW > 1 || b.trayDivD > 1 ? "-div" + b.trayDivW + "x" + b.trayDivD : "") + (b.scoop ? "-scoop" : "") + roundTag(t.radii);
  }
  function partsOf(b) { // every printable part of a bin: the bin itself, plus one entry per tray when stacked
    var base = { stem: fileStem(b), make: function () { return geo.buildBin(b); } };
    if (!geo.stacked(b)) return [base];
    return [base].concat(geo.trays(b).map(function (t) { return { stem: trayStem(b, t), make: function () { return geo.buildTray(b, t); } }; }));
  }
  function describe(b) {
    var bits = [], D = geo.dims(b), k = splitOf(b.split), nTrays = k.kx * k.ky;
    if (geo.stacked(b)) bits.push("stacked, " + nTrays + (nTrays > 1 ? " trays" : " tray"));
    if (b.divW > 1 || b.divD > 1) bits.push(b.divW * b.divD + " sections");
    if (b.scoop) bits.push("scoop");
    if (roundTag(D.radii)) bits.push("rounded corner");
    return bits.join(" · ");
  }
  function groups(list) { // one entry per unique printable part, with how many to print
    var map = {}, order = [];
    list.forEach(function (b) {
      partsOf(b).forEach(function (pt) {
        if (!map[pt.stem]) { map[pt.stem] = { stem: pt.stem, make: pt.make, count: 0, bins: [] }; order.push(pt.stem); }
        map[pt.stem].count++;
        if (map[pt.stem].bins.indexOf(b.id) < 0) map[pt.stem].bins.push(b.id);
      });
    });
    return order.map(function (k) { return map[k]; });
  }
  function stlFiles(gs) { return gs.map(function (g) { return { name: stlName(g), data: toSTL(g.make(), g.stem) }; }); }
  // the zip of every bin in the drawer
  function allBinsFiles() {
    var gs = groups(S.bins);
    return { name: "drawer-" + Math.round(S.drawerW) + "x" + Math.round(S.drawerD) + "x" + Math.round(S.drawerH) + "-" + S.bins.length + "-bins.zip", files: stlFiles(gs), groups: gs };
  }
  return { roundTag: roundTag, sizeStem: sizeStem, fileStem: fileStem, trayStem: trayStem, partsOf: partsOf, describe: describe, groups: groups, stlFiles: stlFiles, allBinsFiles: allBinsFiles };
}

export { createExport, toSTL, crc32, zip, stlName, f1 };
