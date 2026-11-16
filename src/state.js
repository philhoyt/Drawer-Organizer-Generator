// Defaults, limits, unit parsing, and the restore of saved state. Anything from storage is checked before use.
// Every length is stored in millimetres; the unit toggle only changes what the panel shows and how it reads input.
import { canPlace, maxCount, suggestCount, TARGET_CELL, MIN_CELL, MAX_COUNT } from "./layout.js";

var MM_PER_IN = 25.4;
var DRAWER = { drawerW: 400, drawerD: 300, drawerH: 60, drawerR: 0 };
var FIT = { binClear: 0.25, wallClear: 0.25, wall: 1.6, floorT: 1.6, cornerR: 3, draft: 1.5, plugDepth: 4, plugClear: 0.4, scoopR: 12, bedX: 220, bedY: 220 };
var BIN_OPTS = { h: 0, divW: 1, divD: 1, stack: false, lowerH: 0, split: "1", trayDivW: 1, trayDivD: 1, scoop: false }; // h 0 = drawer height
var STEP_LIMITS = { divW: [1, 10], divD: [1, 10], trayDivW: [1, 8], trayDivD: [1, 8] };
var BIN_ENUMS = { split: ["1", "w", "d", "4"] };
var TRAY_GAP = 0.6;   // stacking: gap between split trays
var DIVIDER_T = 1.2;  // divider wall thickness
var MIN_BIN_H = 10;   // shortest bin
var MIN_STACK_PART = 15; // shortest bottom bin, and shortest visible tray, of a stacked bin
var DRAWER_KEYS = Object.keys(DRAWER), FIT_KEYS = Object.keys(FIT);
// what the inputs allow, used to clamp saved values and edits (mm)
var LIMITS = { drawerW: [30, 1500], drawerD: [30, 1500], drawerH: [MIN_BIN_H, 300], drawerR: [0, 50],
               binClear: [0, 2], wallClear: [0, 5], wall: [0.8, 4], floorT: [0.8, 4], cornerR: [0.5, 10], draft: [0, 4],
               plugDepth: [2, 10], plugClear: [0, 1.5], scoopR: [4, 30], bedX: [50, 1000], bedY: [50, 1000] };

// Printable area (X x Y, mm) of common printers, for the bed preset picker. Single-nozzle area where it differs.
var BED_PRESETS = [
  { brand: "Bambu Lab", models: [["bambu-a1mini", "A1 mini", 180, 180], ["bambu-a1", "A1", 256, 256], ["bambu-p1", "P1S / P1P / X1 series", 256, 256],
    ["bambu-h2d", "H2D (one nozzle)", 325, 320], ["bambu-h2s", "H2S", 340, 320]] },
  { brand: "Prusa", models: [["prusa-mini", "MINI+", 180, 180], ["prusa-mk4", "MK4S / MK4 / MK3S+", 250, 210], ["prusa-core1", "CORE One", 250, 220],
    ["prusa-core1l", "CORE One L", 300, 300], ["prusa-xl", "XL", 360, 360]] },
  { brand: "Creality", models: [["creality-ender3", "Ender-3 series", 220, 220], ["creality-k1", "K1 / K1C", 220, 220], ["creality-k1max", "K1 Max", 300, 300],
    ["creality-k2", "K2", 260, 260], ["creality-k2pro", "K2 Pro", 300, 300], ["creality-k2plus", "K2 Plus", 350, 350]] },
  { brand: "Elegoo", models: [["elegoo-n4", "Neptune 4 / 4 Pro", 225, 225], ["elegoo-n4plus", "Neptune 4 Plus", 320, 320], ["elegoo-n4max", "Neptune 4 Max", 420, 420],
    ["elegoo-cc", "Centauri Carbon", 256, 256]] },
  { brand: "Anycubic", models: [["anycubic-k2neo", "Kobra 2 Neo", 220, 220], ["anycubic-k3", "Kobra 3", 250, 250], ["anycubic-s1", "Kobra S1", 250, 250]] },
  { brand: "Qidi", models: [["qidi-q1pro", "Q1 Pro", 245, 245], ["qidi-xplus3", "X-Plus 3", 280, 280], ["qidi-plus4", "Plus4", 305, 305]] },
  { brand: "Sovol", models: [["sovol-sv06", "SV06", 220, 220], ["sovol-sv06plus", "SV06 Plus", 300, 300]] },
  { brand: "Voron", models: [["voron-250", "2.4 / Trident 250", 250, 250], ["voron-300", "2.4 / Trident 300", 300, 300], ["voron-350", "2.4 / Trident 350", 350, 350]] }
];
var BEDS = {}; // id -> { id, name, x, y }
BED_PRESETS.forEach(function (g) { g.models.forEach(function (m) { BEDS[m[0]] = { id: m[0], name: g.brand + " " + m[1], x: m[2], y: m[3] }; }); });
// The preset a bed size came from, if it still matches; otherwise null (a custom size).
function bedPresetOf(S) { var p = BEDS[S.bedPreset]; return p && p.x === S.bedX && p.y === S.bedY ? p : null; }

function isNum(v) { return typeof v === "number" && isFinite(v); }
function isInt(v, lo, hi) { return isNum(v) && v === Math.floor(v) && v >= lo && v <= hi; }
function clamp(v, lim) { return Math.min(lim[1], Math.max(lim[0], v)); }

// ---------------------------------------------------------------- units
// Reads a length typed in the current unit. A trailing "mm", "in", or '"' overrides the unit. Inches take decimals,
// fractions, and mixed numbers: 14.375, 14 3/8, 14-3/8, 3/8. Returns millimetres, or NaN if it can't be read.
function parseLength(text, unit) {
  var s = String(text == null ? "" : text).trim().toLowerCase().replace(/,/g, "."), u = unit === "in" ? "in" : "mm";
  var suf = /\s*(mm|in|inch|inches|")$/.exec(s);
  if (suf) { u = suf[1] === "mm" ? "mm" : "in"; s = s.slice(0, suf.index).trim(); }
  var v = NaN, m;
  if ((m = /^(\d+(?:\.\d+)?)$/.exec(s)) || (m = /^(\.\d+)$/.exec(s))) v = parseFloat(m[1]);
  else if ((m = /^(\d+)(?:\s+|\s*-\s*)(\d+)\s*\/\s*(\d+)$/.exec(s))) v = +m[3] ? +m[1] + m[2] / m[3] : NaN;
  else if ((m = /^(\d+)\s*\/\s*(\d+)$/.exec(s))) v = +m[2] ? m[1] / m[2] : NaN;
  return isFinite(v) ? (u === "in" ? v * MM_PER_IN : v) : NaN;
}
function trim(v, places) { var p = Math.pow(10, places); return (Math.round(v * p) / p).toString(); }
function gcd(a, b) { return b ? gcd(b, a % b) : a; }
// A length for display: mm to 0.1, inches as a sixteenths fraction when it is one, otherwise to 0.001.
function formatLength(mm, unit) {
  if (unit !== "in") return trim(mm, 1);
  var v = mm / MM_PER_IN, n16 = Math.round(v * 16);
  if (Math.abs(v * 16 - n16) > 0.02) return trim(v, 3);
  var whole = Math.floor(n16 / 16), rest = n16 % 16;
  if (!rest) return String(whole);
  var g = gcd(rest, 16), frac = rest / g + "/" + 16 / g;
  return whole ? whole + " " + frac : frac;
}
function unitName(unit) { return unit === "in" ? "in" : "mm"; }

// ---------------------------------------------------------------- state
function makeBin(id, c, r, w, d, opts) { return Object.assign({ id: id, c: c, r: r, w: w, d: d }, BIN_OPTS, opts || {}); }
function createState() {
  var S = Object.assign({ units: "mm", cols: 1, rows: 1, autoGrid: true, view: "drawer", liftTrays: false, bedPreset: "", bins: [], selId: null }, DRAWER, FIT);
  S.cols = suggestCount(S, "x"); S.rows = suggestCount(S, "y");
  return S;
}
function cleanBin(raw) { // a saved bin with every field checked, or null if it can't be trusted
  if (!raw || typeof raw !== "object") return null;
  var b = Object.assign({}, BIN_OPTS, raw);
  if (!isInt(b.id, 1, 1e9) || !isInt(b.c, 0, MAX_COUNT - 1) || !isInt(b.r, 0, MAX_COUNT - 1) || !isInt(b.w, 1, MAX_COUNT) || !isInt(b.d, 1, MAX_COUNT)) return null;
  Object.keys(BIN_ENUMS).forEach(function (k) { if (BIN_ENUMS[k].indexOf(b[k]) < 0) b[k] = BIN_OPTS[k]; });
  ["h", "lowerH"].forEach(function (k) { if (!isNum(b[k]) || b[k] < 0) b[k] = 0; else b[k] = Math.min(LIMITS.drawerH[1], b[k]); });
  Object.keys(STEP_LIMITS).forEach(function (k) { b[k] = isNum(b[k]) ? clamp(Math.round(b[k]), STEP_LIMITS[k]) : BIN_OPTS[k]; });
  b.stack = !!b.stack; b.scoop = !!b.scoop;
  return { id: b.id, c: b.c, r: b.r, w: b.w, d: b.d, h: b.h, divW: b.divW, divD: b.divD, stack: b.stack, lowerH: b.lowerH, split: b.split, trayDivW: b.trayDivW, trayDivD: b.trayDivD, scoop: b.scoop };
}
// Fills S from whatever was saved: a wrong type, an out-of-range number, or a bin that runs off the grid or overlaps
// another is dropped or clamped rather than breaking startup. Bins too big for the bed are kept; the map flags them.
// Returns the next free bin id.
function restoreState(S, saved) {
  var nextId = 1;
  if (!saved || typeof saved !== "object") return nextId;
  if (saved.units === "mm" || saved.units === "in") S.units = saved.units;
  DRAWER_KEYS.concat(FIT_KEYS).forEach(function (k) { if (isNum(saved[k])) S[k] = clamp(saved[k], LIMITS[k]); });
  S.autoGrid = saved.autoGrid !== false;
  if (S.autoGrid) { S.cols = suggestCount(S, "x"); S.rows = suggestCount(S, "y"); }
  else {
    S.cols = isNum(saved.cols) ? clamp(Math.round(saved.cols), [1, maxCount(S, "x")]) : suggestCount(S, "x");
    S.rows = isNum(saved.rows) ? clamp(Math.round(saved.rows), [1, maxCount(S, "y")]) : suggestCount(S, "y");
  }
  if (saved.view === "drawer" || saved.view === "bin") S.view = saved.view;
  S.liftTrays = !!saved.liftTrays;
  S.bedPreset = typeof saved.bedPreset === "string" && BEDS[saved.bedPreset] ? saved.bedPreset : "";
  (Array.isArray(saved.bins) ? saved.bins : []).forEach(function (raw) {
    var b = cleanBin(raw);
    if (b && canPlace(S, S.bins, b.c, b.r, b.w, b.d) && !S.bins.some(function (o) { return o.id === b.id; })) { S.bins.push(b); nextId = Math.max(nextId, b.id + 1); }
  });
  S.selId = S.bins.some(function (b) { return b.id === saved.selId; }) ? saved.selId : S.bins.length ? S.bins[0].id : null;
  return nextId;
}
// What gets saved: the settings and bins, nothing derived.
function saveable(S) {
  var out = { units: S.units, cols: S.cols, rows: S.rows, autoGrid: S.autoGrid, view: S.view, liftTrays: S.liftTrays, bedPreset: S.bedPreset, selId: S.selId, bins: S.bins };
  DRAWER_KEYS.concat(FIT_KEYS).forEach(function (k) { out[k] = S[k]; });
  return out;
}

// ---------------------------------------------------------------- layouts
// A layout is the saved state with a name and a format tag, the same in the browser's list and in an exported file.
var LAYOUT_FORMAT = "drawer-organizer-layout", MAX_LAYOUTS = 50, MAX_NAME = 60;
function cleanName(name) { return String(name == null ? "" : name).replace(/\s+/g, " ").trim().slice(0, MAX_NAME); }
function layoutFile(S, name) { return Object.assign({ format: LAYOUT_FORMAT, version: 1, name: cleanName(name) }, saveable(S)); }
// A layout read back into a fresh state, checked the same way as the saved session. Null if it isn't a layout at all.
// dropped counts bins that couldn't be placed (off the grid, overlapping, or junk).
function readLayout(data) {
  if (!data || typeof data !== "object" || data.format !== LAYOUT_FORMAT) return null;
  var T = createState(), nextId = restoreState(T, data), n = Array.isArray(data.bins) ? data.bins.length : 0;
  return { S: T, nextId: nextId, name: cleanName(data.name), dropped: Math.max(0, n - T.bins.length) };
}
// The browser's list of saved layouts: entries that aren't layouts are dropped, names are trimmed, newest first.
function cleanLayouts(raw) {
  return (Array.isArray(raw) ? raw : []).filter(function (l) { return l && typeof l === "object" && cleanName(l.name) && l.data && l.data.format === LAYOUT_FORMAT; })
    .map(function (l) { return { name: cleanName(l.name), savedAt: isNum(l.savedAt) ? l.savedAt : 0, data: l.data }; })
    .sort(function (a, b) { return b.savedAt - a.savedAt; }).slice(0, MAX_LAYOUTS);
}
// Save under a name: replaces a layout of the same name (ignoring case), newest first. Returns the new list and whether it replaced one.
function putLayout(list, name, data, now) {
  var n = cleanName(name), key = n.toLowerCase(), had = list.some(function (l) { return l.name.toLowerCase() === key; });
  var out = [{ name: n, savedAt: now, data: data }].concat(list.filter(function (l) { return l.name.toLowerCase() !== key; }));
  return { list: out.slice(0, MAX_LAYOUTS), replaced: had };
}

export { BED_PRESETS, BEDS, bedPresetOf };
export { LAYOUT_FORMAT, MAX_LAYOUTS, cleanName, layoutFile, readLayout, cleanLayouts, putLayout };
export { MM_PER_IN, DRAWER, FIT, BIN_OPTS, STEP_LIMITS, BIN_ENUMS, TRAY_GAP, DIVIDER_T, MIN_BIN_H, MIN_STACK_PART, TARGET_CELL, MIN_CELL, MAX_COUNT,
         DRAWER_KEYS, FIT_KEYS, LIMITS, clamp, parseLength, formatLength, unitName, makeBin, createState, cleanBin, restoreState, saveable };
