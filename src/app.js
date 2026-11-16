// The page: state, the drawer inputs, the floor map, the panel, the 3D view, downloads. Everything that touches the DOM lives here.
import * as layout from "./layout.js";
import { pitch, footprint, fitsBed, oversized, binBox, maxCount, suggestCount } from "./layout.js";
import { FIT, BIN_OPTS, STEP_LIMITS, DRAWER_KEYS, FIT_KEYS, LIMITS, MIN_BIN_H, MIN_STACK_PART, clamp, parseLength, formatLength, unitName,
         makeBin, createState, restoreState, saveable, cleanName, layoutFile, readLayout, cleanLayouts, putLayout, BED_PRESETS, BEDS, bedPresetOf } from "./state.js";
import { createGeometry, splitOf } from "./geometry.js";
import { createExport, zip } from "./export.js";

(function () {
  "use strict";

  // ================================================================ state
  var KEY = "dob-state-v1", nextId = 1;
  function newBin(c, r, w, d, opts) { return makeBin(nextId++, c, r, w, d, opts); }
  var S = createState();
  try { nextId = restoreState(S, JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { /* no usable storage: start fresh */ }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(saveable(S))); } catch (e) { /* storage full or blocked: keep going */ } }

  var $ = function (id) { return document.getElementById(id); };
  function sel() { for (var i = 0; i < S.bins.length; i++) if (S.bins[i].id === S.selId) return S.bins[i]; return null; }
  var picked = []; // ids of bins shift-clicked into the selection alongside the selected one (for merging), not saved
  function selection() { var b = sel(); return b ? [b].concat(S.bins.filter(function (o) { return picked.indexOf(o.id) >= 0 && o !== b; })) : []; }
  function togglePick(b) {
    if (!sel()) { S.selId = b.id; return; }
    if (b.id === S.selId) { if (picked.length) { S.selId = picked.shift(); } return; } // drop the main one; the next picked takes over
    var i = picked.indexOf(b.id);
    if (i >= 0) picked.splice(i, 1); else picked.push(b.id);
  }
  function multiKey(e) { return e.shiftKey || e.metaKey || e.ctrlKey; }
  function idx(b) { return S.bins.indexOf(b) + 1; }
  function len(mm) { return formatLength(mm, S.units) + " " + unitName(S.units); } // a length in the current unit, with the unit
  function num(mm) { return formatLength(mm, S.units); }
  var status = $("status"), undoBtn = $("undo");
  function say(t) { status.textContent = t; undoBtn.hidden = true; }
  function sayUndo(t) { status.textContent = t; undoBtn.hidden = false; } // a message about a change worth an Undo right there

  // ---------------------------------------------------------------- history
  // Undo and redo cover the whole layout: bins, grid, drawer, and fit settings. update() records a step whenever any of
  // them changed since the last step (never mid-drag), so every control gets undo without its own bookkeeping.
  var HIST_KEYS = ["cols", "rows", "autoGrid", "bedPreset"].concat(DRAWER_KEYS, FIT_KEYS), past = [], future = [], cur = null, MAX_HIST = 100;
  function take() { var s = { bins: S.bins.map(function (b) { return Object.assign({}, b); }), selId: S.selId }; HIST_KEYS.forEach(function (k) { s[k] = S[k]; }); return s; }
  function keyOf(s) { var o = { bins: s.bins }; HIST_KEYS.forEach(function (k) { o[k] = s[k]; }); return JSON.stringify(o); }
  function record() {
    var s = take(), k = keyOf(s);
    if (cur && cur.key === k) { cur.snap.selId = S.selId; return; }
    if (cur) { past.push(cur); if (past.length > MAX_HIST) past.shift(); future = []; }
    cur = { key: k, snap: s };
  }
  function restoreSnap(s) { S.bins = s.bins.map(function (b) { return Object.assign({}, b); }); HIST_KEYS.forEach(function (k) { S[k] = s[k]; }); S.selId = s.selId; picked = []; }
  function histStep(back) {
    var from = back ? past : future, to = back ? future : past;
    if (!from.length) return;
    to.push(cur); cur = from.pop(); restoreSnap(cur.snap);
    say(back ? "Undone." : "Redone."); update();
  }
  undoBtn.addEventListener("click", function () { histStep(true); });

  function canPlace(c, r, w, d, exceptId) { return layout.canPlace(S, S.bins, c, r, w, d, exceptId); }
  function binAt(c, r) { return layout.binAt(S.bins, c, r); }

  var geo = createGeometry(S), ex = createExport(S, geo);
  var dims = geo.dims, binH = geo.binH, stacked = geo.stacked, lowerH = geo.lowerH, trayH = geo.trayH, trays = geo.trays;

  // ================================================================ grid
  // New counts: bins keep their cells; any that run off the new grid are cut back or dropped, with an undo.
  function setCounts(cols, rows, msg) {
    if (cols === S.cols && rows === S.rows) return;
    var g = layout.regrid(S.bins, cols, rows);
    S.cols = cols; S.rows = rows; S.bins = g.bins;
    if (!S.bins.some(function (b) { return b.id === S.selId; })) S.selId = S.bins.length ? S.bins[0].id : null;
    var bits = [];
    if (g.clipped.length) bits.push(g.clipped.length + " bin" + (g.clipped.length > 1 ? "s" : "") + " cut back to fit");
    if (g.dropped.length) bits.push(g.dropped.length + " bin" + (g.dropped.length > 1 ? "s" : "") + " removed");
    if (bits.length) sayUndo("Grid is now " + cols + " × " + rows + ": " + bits.join(", ") + ".");
    else if (msg) say(msg);
  }
  // After the drawer or the clearances change: follow the suggestion if the counts are automatic, else stay within limits.
  function fixGrid() {
    if (S.autoGrid) setCounts(suggestCount(S, "x"), suggestCount(S, "y"));
    else setCounts(Math.min(S.cols, maxCount(S, "x")), Math.min(S.rows, maxCount(S, "y")));
  }

  // ================================================================ floor map
  var svgNS = "http://www.w3.org/2000/svg", floor = $("floor"), binG, cellG, drawnFor = "";
  function el(tag, attrs, parent) { var e = document.createElementNS(svgNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function mapScale() { return Math.max(S.drawerW, S.drawerD); }
  // The map is the drawer seen from above with the front at the bottom. Drawer y runs from the front, SVG y from the top.
  function sy(y, h) { return S.drawerD - y - h; }
  function drawFloor() {
    var key = [S.drawerW, S.drawerD, S.drawerR, S.cols, S.rows, S.wallClear, S.binClear].join("|");
    if (key === drawnFor) return;
    drawnFor = key;
    var W = S.drawerW, D = S.drawerD, M = mapScale(), pad = M * 0.07, fs = M / 26;
    floor.setAttribute("viewBox", [-pad, -pad, W + 2 * pad, D + 2 * pad].map(function (v) { return v.toFixed(2); }).join(" "));
    floor.innerHTML = "";
    var defs = el("defs", {}, floor), hs = M / 60;
    var pat = el("pattern", { id: "badhatch", width: hs, height: hs, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("rect", { width: hs, height: hs, style: "fill:var(--bin-soft)" }, pat);
    el("line", { x1: 0, y1: 0, x2: 0, y2: hs, style: "stroke:var(--warn)", "stroke-width": hs / 2 }, pat);
    var rr = Math.min(S.drawerR, W / 2, D / 2);
    el("rect", { x: -M * 0.012, y: -M * 0.012, width: W + M * 0.024, height: D + M * 0.024, rx: rr + M * 0.012, style: "fill:var(--case-line)" }, floor);
    el("rect", { x: 0, y: 0, width: W, height: D, rx: rr, class: "drawer" }, floor);
    cellG = el("g", {}, floor);
    var px = pitch(S, "x"), py = pitch(S, "y"), x0 = S.wallClear - S.binClear;
    for (var r = 0; r < S.rows; r++) for (var c = 0; c < S.cols; c++)
      el("rect", { x: x0 + c * px, y: sy(x0 + r * py, py), width: px, height: py, class: "cell", "data-c": c, "data-r": r, "vector-effect": "non-scaling-stroke" }, cellG);
    el("text", { x: W / 2, y: D + pad * 0.72, "text-anchor": "middle", class: "front-label", "font-size": fs }, floor).textContent = "FRONT";
    el("text", { x: W / 2, y: -pad * 0.32, "text-anchor": "middle", class: "axis", "font-size": fs, id: "axisW" }, floor);
    el("text", { x: -pad * 0.32, y: D / 2, "text-anchor": "middle", class: "axis", "font-size": fs, transform: "rotate(-90 " + (-pad * 0.32) + " " + D / 2 + ")", id: "axisD" }, floor);
    binG = el("g", {}, floor);
  }
  function drawBins() {
    drawFloor();
    $("axisW").textContent = "W " + len(S.drawerW) + " · " + S.cols + " cells";
    $("axisD").textContent = "D " + len(S.drawerD) + " · " + S.rows + " cells";
    binG.innerHTML = "";
    cellG.querySelectorAll(".cell").forEach(function (ce) { ce.classList.toggle("taken", !!binAt(+ce.getAttribute("data-c"), +ce.getAttribute("data-r"))); });
    var on = sel();
    S.bins.forEach(function (b) { if (b !== on) drawOne(b, false, picked.indexOf(b.id) >= 0); });
    if (on) drawOne(on, true);
  }
  function drawOne(b, isOn, isPicked) {
    var B = binBox(S, b), M = mapScale(), k = M / 240, R = dims(b).radii;
    var x = B.x0 + k, y = sy(B.y0, B.y1 - B.y0) + k, w = B.x1 - B.x0 - 2 * k, h = B.y1 - B.y0 - 2 * k;
    var bad = !fitsBed(S, b.w, b.d), cls = "bin" + (isOn ? " on" : "") + (isPicked ? " picked" : "") + (bad ? " bad" : "");
    if (R.some(function (v) { return v !== S.cornerR; })) el("path", { d: roundedPath(x, y, w, h, R, M), class: cls, "vector-effect": "non-scaling-stroke" }, binG);
    else el("rect", { x: x, y: y, width: w, height: h, rx: M / 120, class: cls, "vector-effect": "non-scaling-stroke" }, binG);
    if (stacked(b)) {
      var i2 = M / 60, kk = splitOf(b.split);
      el("rect", { x: x + i2, y: y + i2, width: Math.max(0, w - 2 * i2), height: Math.max(0, h - 2 * i2), rx: M / 200, class: "stack-mark", "vector-effect": "non-scaling-stroke" }, binG);
      if (kk.kx > 1) el("line", { x1: x + w / 2, y1: y + i2, x2: x + w / 2, y2: y + h - i2, class: "stack-mark", "vector-effect": "non-scaling-stroke" }, binG);
      if (kk.ky > 1) el("line", { x1: x + i2, y1: y + h / 2, x2: x + w - i2, y2: y + h / 2, class: "stack-mark", "vector-effect": "non-scaling-stroke" }, binG);
    }
    var fs = Math.min(M / 22, w * 0.5, h * 0.6);
    el("text", { x: x + w / 2, y: y + h / 2 + fs * 0.35, "text-anchor": "middle", class: "bin-num", "font-size": fs }, binG).textContent = idx(b);
  }
  // a rectangle with a big radius on the drawer-corner side (map y is flipped, so front is the bottom edge)
  function roundedPath(x, y, w, h, R, M) {
    var s = M / 120, cap = Math.min(w, h) / 2;
    var fr = Math.min(R[0] === S.cornerR ? s : R[0], cap), br = Math.min(R[1] === S.cornerR ? s : R[1], cap), bl = Math.min(R[2] === S.cornerR ? s : R[2], cap), fl = Math.min(R[3] === S.cornerR ? s : R[3], cap);
    return "M" + (x + bl) + " " + y + "H" + (x + w - br) + "A" + br + " " + br + " 0 0 1 " + (x + w) + " " + (y + br) + "V" + (y + h - fr) +
      "A" + fr + " " + fr + " 0 0 1 " + (x + w - fr) + " " + (y + h) + "H" + (x + fl) + "A" + fl + " " + fl + " 0 0 1 " + x + " " + (y + h - fl) +
      "V" + (y + bl) + "A" + bl + " " + bl + " 0 0 1 " + (x + bl) + " " + y + "Z";
  }

  // drawing and moving
  var drag = null, warnedBed = false;
  function cellAt(evt) {
    var t = document.elementFromPoint(evt.clientX, evt.clientY);
    if (!t || !t.classList || !t.classList.contains("cell")) return null;
    return { c: +t.getAttribute("data-c"), r: +t.getAttribute("data-r") };
  }
  floor.addEventListener("pointerdown", function (e) {
    var c = cellAt(e); if (!c) return;
    e.preventDefault();
    var hit = binAt(c.c, c.r);
    if (hit && multiKey(e)) { togglePick(hit); update(); return; }
    picked = [];
    if (hit) {
      S.selId = hit.id;
      drag = { mode: "move", id: hit.id, offC: c.c - hit.c, offR: c.r - hit.r };
      update();
    } else {
      var base = sel(), opts = base ? { h: base.h } : {};
      var nb = newBin(c.c, c.r, 1, 1, opts);
      S.bins.push(nb); S.selId = nb.id; warnedBed = false;
      drag = { mode: "draw", id: nb.id, start: c };
      say(""); update();
    }
  });
  window.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var c = cellAt(e); if (!c) return;
    var b = sel(); if (!b || b.id !== drag.id) return;
    if (drag.mode === "draw") {
      var c0 = Math.min(c.c, drag.start.c), c1 = Math.max(c.c, drag.start.c), r0 = Math.min(c.r, drag.start.r), r1 = Math.max(c.r, drag.start.r);
      var w = c1 - c0 + 1, d = r1 - r0 + 1;
      if (b.c === c0 && b.r === r0 && b.w === w && b.d === d) return;
      if (!fitsBed(S, w, d)) {
        if (!warnedBed) { warnedBed = true; var f = footprint(S, w, d); say("A " + w + "x" + d + " bin (" + num(f.x) + " × " + num(f.y) + " " + unitName(S.units) + ") won't fit " + bedName() + "."); }
        return;
      }
      if (canPlace(c0, r0, w, d, b.id)) { b.c = c0; b.r = r0; b.w = w; b.d = d; update(false); }
    } else {
      var nc = c.c - drag.offC, nr = c.r - drag.offR;
      if ((b.c !== nc || b.r !== nr) && canPlace(nc, nr, b.w, b.d, b.id)) { b.c = nc; b.r = nr; update(false); }
    }
  });
  function endDrag() { if (drag) { drag = null; update(); } }
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  // ================================================================ downloads
  var downloadsP = (window.claude && window.claude.use) ? window.claude.use("downloads").catch(function () { return null; }) : Promise.resolve(null);
  function save(filename, blob, doneMsg) {
    say("Preparing " + filename + "…");
    downloadsP.then(function (dl) {
      if (!dl) { // plain browser (GitHub Pages, local server): normal download link
        try {
          var url = URL.createObjectURL(blob), a = document.createElement("a");
          a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          say(doneMsg);
        } catch (e) { say("Couldn't start the download in this browser."); }
        return;
      }
      return dl.save({ filename: filename, data: blob }).then(function () { say(doneMsg); }, function (err) {
        var c = err && err.code;
        say(c === "declined" ? "Download canceled." : c === "rate_limited" ? "A save prompt is already open. Finish that one first." : "Couldn't save the file here (" + (c || "error") + ").");
      });
    });
  }
  $("dlAll").addEventListener("click", function () {
    if (!S.bins.length || oversized(S, S.bins).length) return;
    var z = ex.allBinsFiles(), n = z.groups.length;
    save(z.name, zip(z.files), "Saved " + z.name + ": " + n + " STL file" + (n > 1 ? "s" : "") + " for " + S.bins.length + " bin" + (S.bins.length > 1 ? "s" : "") + ".");
  });

  // ================================================================ 3D view
  var three = null, geoCache = {};
  function initThree() {
    var stage = $("stage");
    function fail() {
      var d = document.createElement("div"); d.className = "err"; d.textContent = "3D preview couldn't load. Layout and downloads still work.";
      stage.appendChild(d);
    }
    if (!window.THREE || !THREE.OrbitControls) { fail(); return; }
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch (e) { fail(); return; } // no WebGL context (headless, disabled GPU, old browser)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    stage.insertBefore(renderer.domElement, stage.firstChild);
    var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 4 / 3, 1, 12000);
    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12;
    controls.minDistance = 40; controls.maxDistance = 5000; controls.maxPolarAngle = Math.PI / 2 - 0.04;
    renderer.domElement.addEventListener("dblclick", function () { resetView(); });
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6450, 0.85));
    var key = new THREE.DirectionalLight(0xffffff, 0.75); key.position.set(160, 300, 220); scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.25); fill.position.set(-220, 90, -140); scene.add(fill);
    var world = new THREE.Group(); scene.add(world);
    var drawer = new THREE.Group(); scene.add(drawer);
    three = {
      renderer: renderer, scene: scene, camera: camera, controls: controls, world: world, drawer: drawer, drawerKey: "",
      plateMat: new THREE.MeshStandardMaterial({ color: 0x232321, roughness: 0.8 }),
      wallMat: new THREE.MeshStandardMaterial({ color: 0x3a3a37, roughness: 0.8, transparent: true, opacity: 0.35 }),
      matOn: new THREE.MeshStandardMaterial({ color: 0xF2B200, roughness: 0.55, flatShading: true }),
      matOff: new THREE.MeshStandardMaterial({ color: 0xC7A55A, roughness: 0.7, flatShading: true }),
      matBad: new THREE.MeshStandardMaterial({ color: 0xC0603A, roughness: 0.7, flatShading: true }),
      matTray: new THREE.MeshStandardMaterial({ color: 0xFFC933, roughness: 0.5, flatShading: true }),
      lineMat: new THREE.LineBasicMaterial({ color: 0x5a4300, transparent: true, opacity: 0.45 })
    };
    function fitStage() { var w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    new ResizeObserver(fitStage).observe(stage); fitStage();
    (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
  }
  function drawDrawer() { // floor plate and see-through walls, rebuilt when the drawer changes
    var k = [S.drawerW, S.drawerD, S.drawerH].join("|");
    if (k === three.drawerKey) return;
    three.drawerKey = k;
    var g = three.drawer, W = S.drawerW, D = S.drawerD, H = S.drawerH, t = Math.max(3, mapScale() / 150);
    while (g.children.length) { var o = g.children[0]; g.remove(o); o.geometry.dispose(); }
    var plate = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * t, 3, D + 2 * t), three.plateMat); plate.position.y = -1.6; g.add(plate);
    [[W + 2 * t, t, 0, -(D + t) / 2], [W + 2 * t, t, 0, (D + t) / 2], [t, D, -(W + t) / 2, 0], [t, D, (W + t) / 2, 0]].forEach(function (w) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w[0], H, w[1]), three.wallMat); m.position.set(w[2], H / 2, w[3]); g.add(m);
    });
  }
  function geoPart(stem, make) {
    var k = JSON.stringify([stem, pitch(S, "x"), pitch(S, "y"), FIT_KEYS.map(function (q) { return S[q]; })]);
    if (!geoCache[k]) {
      var tris = make(), pos = new Float32Array(tris.length * 9), o = 0;
      tris.forEach(function (t) { for (var i = 0; i < 3; i++) { pos[o++] = t[i][0]; pos[o++] = t[i][1]; pos[o++] = t[i][2]; } });
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
      geoCache[k] = { mesh: g, edges: new THREE.EdgesGeometry(g, 35) };
    }
    return geoCache[k];
  }
  function binObject(b, mat) {
    var parts = ex.partsOf(b), G = geoPart(parts[0].stem, parts[0].make), inner = new THREE.Group();
    inner.rotation.x = -Math.PI / 2; // mesh z up, y toward the back -> three.js y up, -z toward the back
    inner.add(new THREE.Mesh(G.mesh, mat), new THREE.LineSegments(G.edges, three.lineMat));
    if (stacked(b)) {
      var lift = S.liftTrays ? Math.max(20, binH(b) * 0.5) : 0;
      trays(b).forEach(function (t, k) {
        var TG = geoPart(parts[k + 1].stem, parts[k + 1].make), tm = new THREE.Group();
        tm.add(new THREE.Mesh(TG.mesh, mat === three.matOn ? three.matTray : mat), new THREE.LineSegments(TG.edges, three.lineMat));
        tm.position.set(t.cx, t.cy, dims(b).zt - S.plugDepth + lift);
        inner.add(tm);
      });
    }
    var outer = new THREE.Group(); outer.add(inner);
    return outer;
  }
  var lastFrame = "";
  function resetView() {
    if (three) { three.controls.enableDamping = false; three.controls.update(); three.controls.enableDamping = true; } // drop leftover drag momentum
    lastFrame = ""; show3D();
  }
  function show3D() {
    if (!three) return;
    while (three.world.children.length) three.world.remove(three.world.children[0]);
    if (Object.keys(geoCache).length > 150) { // the scene is empty here, so nothing still uses these buffers
      Object.keys(geoCache).forEach(function (k) { geoCache[k].mesh.dispose(); geoCache[k].edges.dispose(); });
      geoCache = {};
    }
    var on = sel(), drawerView = S.view === "drawer" || !on;
    drawDrawer(); three.drawer.visible = drawerView;
    var frameKey;
    if (drawerView) {
      S.bins.forEach(function (b) {
        var o = binObject(b, !fitsBed(S, b.w, b.d) ? three.matBad : b === on ? three.matOn : three.matOff), B = binBox(S, b);
        o.position.set((B.x0 + B.x1) / 2 - S.drawerW / 2, 0, -((B.y0 + B.y1) / 2 - S.drawerD / 2));
        three.world.add(o);
      });
      frameKey = "drawer|" + S.drawerW + "|" + S.drawerD + "|" + S.drawerH;
    } else {
      three.world.add(binObject(on, three.matOn));
      frameKey = "bin|" + on.id + "|" + on.w + "x" + on.d + "|" + binH(on);
    }
    if (frameKey !== lastFrame) {
      lastFrame = frameKey;
      if (drawerView) {
        var M = mapScale(), dist = M * 1.35 + 80;
        three.camera.position.set(dist * 0.3, dist * 0.8 + S.drawerH, dist * 0.85);
        three.controls.target.set(0, S.drawerH * 0.2, 0);
      } else {
        var D = dims(on), hh = binH(on), sp = Math.max(D.bx, D.by, hh), d2 = sp * 2.4 + 40;
        three.camera.position.set(d2 * 0.62, d2 * 0.62, d2 * 0.78);
        three.controls.target.set(0, hh * 0.4, 0);
      }
      three.controls.update();
    }
  }

  // ================================================================ UI
  function setPressed(attr, val) { document.querySelectorAll("[data-" + attr + "]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-" + attr) === val)); }); }
  function setIfIdle(id, v) { var e = $(id); if (document.activeElement !== e) { e.value = v; e.classList.remove("bad"); } }
  function codeOf(b) { return b.w + "x" + b.d; }

  function drawList() {
    var ol = $("binlist"); ol.innerHTML = "";
    S.bins.forEach(function (b) {
      var li = document.createElement("li"), bad = !fitsBed(S, b.w, b.d), D = dims(b), what = describe(b);
      li.tabIndex = 0; li.className = (b.id === S.selId || picked.indexOf(b.id) >= 0 ? "on" : "") + (bad ? " bad" : "");
      li.innerHTML = '<span class="num">' + idx(b) + '</span><span class="what">' + codeOf(b) + " · " + num(D.bx) + " × " + num(D.by) + " × " + num(binH(b)) + " " + unitName(S.units) +
        "<small>" + (bad ? "bigger than the bed" + (what ? " · " : "") : "") + what + '</small></span><button type="button" class="del" aria-label="Delete bin ' + idx(b) + '">×</button>';
      li.addEventListener("click", function (e) {
        if (e.target.classList.contains("del")) { removeBins([b.id]); return; }
        if (multiKey(e)) togglePick(b); else { picked = []; S.selId = b.id; }
        update();
      });
      li.addEventListener("keydown", function (e) {
        if (e.target.classList.contains("del")) return; // let the button handle its own Enter/Space
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); picked = []; S.selId = b.id; update(); }
      });
      ol.appendChild(li);
    });
    $("emptyNote").hidden = S.bins.length > 0;
  }
  function describe(b) { var d = ex.describe(b); return (b.h > 0 && b.h < S.drawerH ? "shorter than the drawer" + (d ? " · " : "") : "") + d; }
  function removeBins(goneIds) {
    var first = S.bins.findIndex(function (b) { return goneIds.indexOf(b.id) >= 0; }); if (first < 0) return;
    var gone = S.bins.filter(function (b) { return goneIds.indexOf(b.id) >= 0; });
    var label = gone.length > 1 ? gone.length + " bins" : "bin " + (first + 1) + " (" + codeOf(gone[0]) + ")";
    S.bins = S.bins.filter(function (b) { return goneIds.indexOf(b.id) < 0; });
    if (goneIds.indexOf(S.selId) >= 0) S.selId = S.bins.length ? S.bins[Math.min(first, S.bins.length - 1)].id : null;
    picked = [];
    sayUndo("Deleted " + label + ".");
    update();
  }
  function ids(list) { return list.map(function (b) { return b.id; }); }
  // Split the selected bin in two; both halves keep its options.
  function splitSel(axis) {
    var b = sel(), parts = b && layout.splitParts(b, axis); if (!parts) return;
    var nb = newBin(parts[1].c, parts[1].r, parts[1].w, parts[1].d, optsOf(b));
    Object.assign(b, parts[0]);
    S.bins.splice(S.bins.indexOf(b) + 1, 0, nb);
    sayUndo("Split bin " + idx(b) + " into " + codeOf(b) + " and " + codeOf(nb) + (axis === "w" ? ", left and right." : ", front and back."));
    update();
  }
  // Merge the selected bins into one, if they fill a rectangle. It takes the options of the bin selected first.
  function mergeSel() {
    var list = selection(), R = layout.mergeRect(list); if (!R) return;
    if (!fitsBed(S, R.w, R.d)) { var f = footprint(S, R.w, R.d); say("Merged, they'd be " + num(f.x) + " × " + num(f.y) + " " + unitName(S.units) + ": too big for " + bedName() + "."); return; }
    var keep = list[0], rest = ids(list.slice(1));
    S.bins = S.bins.filter(function (b) { return rest.indexOf(b.id) < 0; });
    Object.assign(keep, R); picked = [];
    sayUndo("Merged " + list.length + " bins into a " + codeOf(keep) + ".");
    update();
  }
  function optsOf(b) { var o = {}; Object.keys(BIN_OPTS).forEach(function (k) { o[k] = b[k]; }); return o; }

  function updateHeader(b, D) {
    var code = $("code");
    code.textContent = b ? codeOf(b) : "No bin";
    code.classList.toggle("empty", !b);
    $("codeMeta").innerHTML = b ? "<span>bin <b>" + idx(b) + "</b> of " + S.bins.length + " · top <b>" + num(D.bx) + " × " + num(D.by) + "</b> " + unitName(S.units) + "</span><span>" +
      (stacked(b) ? "stacked <b>" + num(D.h) + " + " + num(trayH(b) - S.plugDepth) + "</b> " : "<b>" + num(binH(b)) + "</b> ") + unitName(S.units) + " tall</span>" : "<span>Draw a bin on the floor grid.</span>";
  }
  // "the Prusa MK4S / MK4 / MK3S+ bed (250 × 210 mm)", or "the 220 × 220 mm bed" for a custom size
  function bedName() { var p = bedPresetOf(S); return p ? "the " + p.name + " bed (" + S.bedX + " × " + S.bedY + " mm)" : "the " + S.bedX + " × " + S.bedY + " mm bed"; }
  (function fillBedPresets() {
    var box = $("bedPreset"), o = document.createElement("option");
    o.value = ""; o.textContent = "Custom size"; box.appendChild(o);
    BED_PRESETS.forEach(function (g) {
      var og = document.createElement("optgroup"); og.label = g.brand;
      g.models.forEach(function (m) { var op = document.createElement("option"); op.value = m[0]; op.textContent = g.brand + " " + m[1] + " · " + m[2] + " × " + m[3]; og.appendChild(op); });
      box.appendChild(og);
    });
  })();
  function updateDrawer() {
    var bp = bedPresetOf(S);
    $("bedPreset").value = bp ? bp.id : "";
    setPressed("units", S.units);
    document.querySelectorAll(".u").forEach(function (s) { s.textContent = "(" + unitName(S.units) + ")"; });
    DRAWER_KEYS.forEach(function (k) { setIfIdle(k, num(S[k])); });
    $("unitHint").textContent = S.units === "in" ? "Inches take decimals or fractions: 14.375 or 14 3/8. Width runs left to right as you face the drawer." : "Width runs left to right as you face the drawer, depth front to back.";
  }
  function updateGrid() {
    setIfIdle("cols", S.cols); setIfIdle("rows", S.rows);
    $("cols").max = maxCount(S, "x"); $("rows").max = maxCount(S, "y");
    $("cellSize").innerHTML = "cells <b>" + num(pitch(S, "x")) + " × " + num(pitch(S, "y")) + "</b> " + unitName(S.units);
    var sc = suggestCount(S, "x"), sr = suggestCount(S, "y");
    $("suggestNote").textContent = S.autoGrid ? "Following the suggestion. Change a count to set your own." : "Suggested: " + sc + " × " + sr + " (cells near 50 mm)";
    $("suggest").hidden = S.autoGrid;
  }
  function updateBinPanel(b, D) {
    $("binGroup").classList.toggle("disabled", !b);
    if (!b) { $("binWhich").textContent = ""; $("specs").innerHTML = ""; return; }
    $("binWhich").textContent = "#" + idx(b) + " · " + codeOf(b);
    $("w-out").textContent = b.w; $("d-out").textContent = b.d;
    setIfIdle("binH", num(binH(b)));
    $("binHNote").textContent = b.h > 0 && b.h < S.drawerH ? "Shorter than the drawer (" + len(S.drawerH) + "). Clear the box to follow the drawer height." : "Follows the drawer height. Type a smaller number for a shorter bin.";
    var can = geo.canStack(b);
    setPressed("stack", stacked(b) ? "on" : "off"); setPressed("split", b.split);
    $("stack-on").disabled = !can;
    $("stackNote").hidden = can; $("stackNote").textContent = "Stacking needs a bin at least " + len(2 * MIN_STACK_PART) + " tall.";
    $("stackBox").hidden = !stacked(b);
    $("divLabel").textContent = stacked(b) ? "Bottom bin dividers" : "Dividers";
    $("lowerH").min = MIN_STACK_PART; $("lowerH").max = binH(b) - MIN_STACK_PART; $("lowerH").value = lowerH(b);
    setIfIdle("stackBottom", num(lowerH(b))); setIfIdle("stackTop", num(binH(b) - lowerH(b)));
    $("stackHNote").textContent = "Together they fill the bin's " + len(binH(b)) + ". Each part is at least " + len(MIN_STACK_PART) + ". The tray also has a " + len(S.plugDepth) + " plug that drops into the bottom bin.";
    setPressed("scoop", b.scoop ? "on" : "off");
    var list = selection(), many = list.length > 1;
    $("splitW").disabled = b.w < 2 || many; $("splitD").disabled = b.d < 2 || many;
    $("merge").hidden = !many; $("merge").disabled = !layout.mergeRect(list);
    $("merge").textContent = "Merge " + list.length + " bins";
    $("mergeNote").hidden = !many || !!layout.mergeRect(list);
    $("delSel").textContent = many ? "Delete " + list.length + " bins" : "Delete bin";
    $("trayDivW-out").textContent = b.trayDivW; $("trayDivD-out").textContent = b.trayDivD;
    $("divW-out").textContent = b.divW; $("divD-out").textContent = b.divD;
    $("specs").innerHTML = specRows(b, D).map(function (s) { return '<div class="spec"><span>' + s[0] + "</span><b>" + s[1] + "</b></div>"; }).join("");
  }
  function specRows(b, D) {
    var u = " " + unitName(S.units);
    if (stacked(b)) {
      var t0 = trays(b)[0];
      return [["Bottom bin top", num(D.bx) + " × " + num(D.by)], ["Usable below tray", num(D.h - S.floorT - S.plugDepth) + u], ["Each tray", num(t0.bx) + " × " + num(t0.by)], ["Heights", num(D.h) + " + " + num(trayH(b) - S.plugDepth) + u]];
    }
    var ob = geo.outerAt(D, 0), inn = geo.innerAt(D, D.zt);
    return [["Top outside", num(D.bx) + " × " + num(D.by)], ["Bottom outside", num(ob.x) + " × " + num(ob.y)], ["Inside at rim", num(inn.x) + " × " + num(inn.y)], ["Height", num(D.h) + u]];
  }
  function updateHistory() { $("histUndo").disabled = !past.length; $("histRedo").disabled = !future.length; }
  function updateSummary() {
    FIT_KEYS.forEach(function (k) { setIfIdle(k, S[k]); $(k).min = LIMITS[k][0]; $(k).max = LIMITS[k][1]; });
    var used = layout.usedCells(S.bins), total = S.cols * S.rows, gs = ex.groups(S.bins), big = oversized(S, S.bins);
    $("summary").textContent = S.bins.length ? S.bins.length + " bin" + (S.bins.length > 1 ? "s" : "") + " · " + used + " of " + total + " cells filled · " + gs.length + " unique STL" + (gs.length > 1 ? "s" : "") : "Empty drawer.";
    $("bedNote").hidden = !big.length;
    if (big.length) {
      var nums = big.map(idx);
      $("bedNote").textContent = (nums.length > 1 ? "Bins " + nums.slice(0, -1).join(", ") + " and " + nums[nums.length - 1] + " are" : "Bin " + nums[0] + " is") +
        " bigger than " + bedName() + ". Make " + (nums.length > 1 ? "them" : "it") + " smaller, or pick another printer, to download.";
    }
    $("dlAll").disabled = !S.bins.length || big.length > 0;
    $("autoFill").disabled = used >= total;
    $("liftTrays").checked = !!S.liftTrays;
    var b = sel();
    $("liftWrap").hidden = !S.bins.some(stacked) || (S.view === "bin" && !(b && stacked(b)));
  }
  // Redraw everything from S. During a drag, fullRedraw === false skips the bin list.
  function update(fullRedraw) {
    picked = picked.filter(function (id) { return id !== S.selId && S.bins.some(function (o) { return o.id === id; }); });
    if (fullRedraw !== false && !drag) record();
    var b = sel(), D = b ? dims(b) : null;
    updateHeader(b, D);
    setPressed("view", S.view);
    updateDrawer();
    updateGrid();
    updateBinPanel(b, D);
    updateSummary();
    drawBins();
    if (fullRedraw !== false) drawList();
    show3D();
    updateHistory();
    $("layoutName").placeholder = defaultName();
    persist();
  }

  // ================================================================ controls
  document.querySelectorAll("[data-units]").forEach(function (x) { x.addEventListener("click", function () { S.units = x.getAttribute("data-units"); say(""); update(); }); });
  document.querySelectorAll("[data-view]").forEach(function (x) { x.addEventListener("click", function () { S.view = x.getAttribute("data-view"); update(); }); });
  $("resetView").addEventListener("click", resetView);
  var DRAWER_NAMES = { drawerW: "width", drawerD: "depth", drawerH: "height", drawerR: "corner radius" };
  DRAWER_KEYS.forEach(function (k) {
    $(k).addEventListener("change", function () {
      var v = parseLength($(k).value, S.units), lim = LIMITS[k];
      if (!isFinite(v)) { $(k).classList.add("bad"); say("Couldn't read the drawer " + DRAWER_NAMES[k] + ". Try " + (S.units === "in" ? "14.375 or 14 3/8" : "365") + "."); return; }
      var c = Math.round(clamp(v, lim) * 100) / 100;
      say(c !== Math.round(v * 100) / 100 ? "Drawer " + DRAWER_NAMES[k] + " is limited to " + len(lim[0]) + " – " + len(lim[1]) + "." : "");
      S[k] = c; $(k).classList.remove("bad"); $(k).value = num(c);
      fixGrid(); update();
    });
  });
  function bumpCount(axis, v) {
    var mx = maxCount(S, axis), n = Math.round(v);
    if (!isFinite(n)) { update(); return; }
    n = Math.min(mx, Math.max(1, n));
    S.autoGrid = false;
    setCounts(axis === "x" ? n : S.cols, axis === "y" ? n : S.rows, Math.round(v) > mx ? "At most " + mx + " " + (axis === "x" ? "columns" : "rows") + ": cells can't get smaller than " + layout.MIN_CELL + " mm." : "");
    update();
  }
  $("cols-minus").addEventListener("click", function () { bumpCount("x", S.cols - 1); });
  $("cols-plus").addEventListener("click", function () { bumpCount("x", S.cols + 1); });
  $("rows-minus").addEventListener("click", function () { bumpCount("y", S.rows - 1); });
  $("rows-plus").addEventListener("click", function () { bumpCount("y", S.rows + 1); });
  $("cols").addEventListener("change", function () { bumpCount("x", parseFloat($("cols").value)); });
  $("rows").addEventListener("change", function () { bumpCount("y", parseFloat($("rows").value)); });
  $("suggest").addEventListener("click", function () { S.autoGrid = true; fixGrid(); update(); });

  $("autoFill").addEventListener("click", function () {
    var base = sel(), opts = base ? { h: base.h } : {};
    var added = layout.autoFill(S, S.bins, function (c, r, w, d) { return newBin(c, r, w, d, opts); });
    if (!added.length) { say("No empty cells to fill."); return; }
    S.bins = S.bins.concat(added);
    if (!sel()) S.selId = added[0].id;
    sayUndo("Added " + added.length + " bin" + (added.length > 1 ? "s" : "") + " to fill the empty cells."); update();
  });
  $("clearAll").addEventListener("click", function () {
    if (!S.bins.length) return;
    S.bins = []; S.selId = null; picked = []; sayUndo("Drawer cleared. Drag on the grid to draw a bin."); update();
  });

  function resize(dw, dd) {
    var b = sel(); if (!b) return;
    var w = b.w + dw, d = b.d + dd;
    if (w < 1 || d < 1) return;
    if (!fitsBed(S, w, d)) { var f = footprint(S, w, d); say("A " + w + "x" + d + " bin (" + num(f.x) + " × " + num(f.y) + " " + unitName(S.units) + ") won't fit " + bedName() + "."); return; }
    if (canPlace(b.c, b.r, w, d, b.id)) { b.w = w; b.d = d; say(""); update(); return; }
    var spot = layout.findSpot(S, S.bins, w, d, b.id);
    if (spot) { b.c = spot.c; b.r = spot.r; b.w = w; b.d = d; say("Moved bin " + idx(b) + " to fit " + w + "x" + d + "."); update(); }
    else say("No room for a " + w + "x" + d + ". Move or delete a bin first.");
  }
  $("w-minus").addEventListener("click", function () { resize(-1, 0); });
  $("w-plus").addEventListener("click", function () { resize(1, 0); });
  $("d-minus").addEventListener("click", function () { resize(0, -1); });
  $("d-plus").addEventListener("click", function () { resize(0, 1); });
  $("binH").addEventListener("change", function () {
    var b = sel(); if (!b) return;
    var raw = $("binH").value.trim();
    if (!raw) { b.h = 0; say(""); update(); return; }
    var v = parseLength(raw, S.units);
    if (!isFinite(v)) { $("binH").classList.add("bad"); say("Couldn't read that height."); return; }
    v = Math.round(v * 10) / 10;
    if (v >= S.drawerH) { b.h = 0; say(v > S.drawerH ? "Bins can't be taller than the drawer, so this one follows the drawer height." : ""); }
    else if (v < MIN_BIN_H) { b.h = MIN_BIN_H; say("The shortest bin is " + len(MIN_BIN_H) + "."); }
    else { b.h = v; say(""); }
    $("binH").classList.remove("bad"); $("binH").value = num(binH(b)); update();
  });
  document.querySelectorAll("[data-stack]").forEach(function (x) { x.addEventListener("click", function () { var b = sel(); if (b) { b.stack = x.getAttribute("data-stack") === "on"; update(); } }); });
  document.querySelectorAll("[data-split]").forEach(function (x) { x.addEventListener("click", function () { var b = sel(); if (b) { b.split = x.getAttribute("data-split"); update(); } }); });
  // the slider redraws as it moves and makes one undo step when let go
  $("lowerH").addEventListener("input", function () { var b = sel(); if (b) { b.lowerH = +$("lowerH").value; update(false); } });
  $("lowerH").addEventListener("change", function () { update(); });
  // Bottom and top heights: type either one, the other takes up the rest of the bin's height.
  [["stackBottom", true], ["stackTop", false]].forEach(function (f) {
    $(f[0]).addEventListener("change", function () {
      var b = sel(); if (!b) return;
      var v = parseLength($(f[0]).value, S.units);
      if (!isFinite(v)) { $(f[0]).classList.add("bad"); say("Couldn't read that height."); return; }
      var full = binH(b), want = Math.round((f[1] ? v : full - v) * 10) / 10;
      b.lowerH = Math.max(MIN_STACK_PART, Math.min(full - MIN_STACK_PART, want));
      say(b.lowerH !== want ? "Each part of a stacked bin is " + len(MIN_STACK_PART) + " to " + len(full - MIN_STACK_PART) + " here." : "");
      $(f[0]).classList.remove("bad"); $(f[0]).blur(); update();
    });
  });
  document.querySelectorAll("[data-scoop]").forEach(function (x) { x.addEventListener("click", function () { var b = sel(); if (b) { b.scoop = x.getAttribute("data-scoop") === "on"; update(); } }); });
  $("liftTrays").addEventListener("change", function () { S.liftTrays = $("liftTrays").checked; update(); });
  Object.keys(STEP_LIMITS).forEach(function (k) {
    function bump(d) { var b = sel(); if (!b) return; var v = clamp(b[k] + d, STEP_LIMITS[k]); if (v !== b[k]) { b[k] = v; update(); } }
    $(k + "-minus").addEventListener("click", function () { bump(-1); });
    $(k + "-plus").addEventListener("click", function () { bump(1); });
  });
  FIT_KEYS.forEach(function (k) {
    $(k).addEventListener("change", function () {
      var v = parseFloat($(k).value);
      if (isFinite(v)) S[k] = clamp(v, LIMITS[k]);
      fixGrid(); update();
    });
  });
  $("bedPreset").addEventListener("change", function () {
    var p = BEDS[$("bedPreset").value];
    if (!p) { S.bedPreset = ""; say("Type the bed size below."); update(); $("bedX").focus(); return; }
    S.bedPreset = p.id; S.bedX = p.x; S.bedY = p.y;
    var big = oversized(S, S.bins).length;
    say("Bed set to " + p.name + ", " + p.x + " × " + p.y + " mm." + (big ? " " + big + " bin" + (big > 1 ? "s are" : " is") + " now too big for it." : ""));
    update();
  });
  $("resetAdv").addEventListener("click", function () { Object.assign(S, FIT); fixGrid(); say("Fit and print settings are back to their defaults."); update(); });
  $("applyAll").addEventListener("click", function () {
    var b = sel(); if (!b) return;
    S.bins.forEach(function (o) { Object.keys(BIN_OPTS).forEach(function (k) { o[k] = b[k]; }); });
    sayUndo("Applied bin " + idx(b) + "'s height, dividers, stacking and scoop to all " + S.bins.length + " bins."); update();
  });
  $("delSel").addEventListener("click", function () { removeBins(ids(selection())); });
  $("splitW").addEventListener("click", function () { splitSel("w"); });
  $("splitD").addEventListener("click", function () { splitSel("d"); });
  $("merge").addEventListener("click", mergeSel);
  $("histUndo").addEventListener("click", function () { histStep(true); });
  $("histRedo").addEventListener("click", function () { histStep(false); });
  document.addEventListener("keydown", function (e) {
    if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "")) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (sel()) { e.preventDefault(); removeBins(ids(selection())); }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault(); histStep(!e.shiftKey);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
      e.preventDefault(); histStep(false);
    }
  });

  // ================================================================ saved layouts
  var LAYOUTS_KEY = "dob-layouts-v1", layouts = [];
  try { layouts = cleanLayouts(JSON.parse(localStorage.getItem(LAYOUTS_KEY) || "[]")); } catch (e) { /* no usable storage: start empty */ }
  function storeLayouts() {
    try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts)); return true; }
    catch (e) { say("Couldn't save in this browser (storage is full or blocked). Export a file instead."); return false; }
  }
  function defaultName() { return num(S.drawerW) + " × " + num(S.drawerD) + " × " + num(S.drawerH) + " " + unitName(S.units) + " drawer"; }
  function layoutMeta(d) {
    var n = Array.isArray(d.bins) ? d.bins.length : 0;
    return num(d.drawerW) + " × " + num(d.drawerD) + " × " + num(d.drawerH) + " " + unitName(S.units) + " · " + n + " bin" + (n === 1 ? "" : "s");
  }
  function when(t) { if (!t) return ""; var d = new Date(t); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  function drawLayouts() {
    var ol = $("layoutList"); ol.innerHTML = "";
    layouts.forEach(function (l, i) {
      var li = document.createElement("li"), what = document.createElement("span"), name = document.createElement("b"), meta = document.createElement("small");
      li.tabIndex = 0; li.title = "Load this layout";
      what.className = "what"; name.textContent = l.name; meta.textContent = layoutMeta(l.data) + (l.savedAt ? " · " + when(l.savedAt) : "");
      what.append(name, meta);
      var del = document.createElement("button"); del.type = "button"; del.className = "del"; del.textContent = "×"; del.setAttribute("aria-label", "Delete saved layout " + l.name);
      li.append(what, del);
      li.addEventListener("click", function (e) { if (e.target === del) deleteLayout(i); else loadLayout(l.data, "Loaded “" + l.name + "”."); });
      li.addEventListener("keydown", function (e) { if (e.target !== del && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); loadLayout(l.data, "Loaded “" + l.name + "”."); } });
      ol.appendChild(li);
    });
    $("layoutsEmpty").hidden = layouts.length > 0;
    $("layoutName").placeholder = defaultName();
  }
  // Replace the current layout with a saved one. Goes through the same checks as a restored session, and into undo.
  function loadLayout(data, msg) {
    var got = readLayout(data);
    if (!got) { say("That isn't a drawer layout."); return false; }
    var T = got.S;
    Object.keys(saveable(T)).forEach(function (k) { S[k] = T[k]; });
    nextId = Math.max(nextId, got.nextId); picked = [];
    sayUndo(msg + (got.dropped ? " " + (got.dropped > 1 ? got.dropped + " bins couldn't be placed and were" : "1 bin couldn't be placed and was") + " left out." : ""));
    update();
    return got;
  }
  $("saveForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = cleanName($("layoutName").value) || defaultName();
    var r = putLayout(layouts, name, layoutFile(S, name), Date.now()), before = layouts;
    layouts = r.list;
    if (!storeLayouts()) { layouts = before; return; }
    $("layoutName").value = ""; drawLayouts();
    say((r.replaced ? "Updated" : "Saved") + " “" + name + "”.");
  });
  function deleteLayout(i) {
    var l = layouts[i]; if (!l || !window.confirm("Delete the saved layout “" + l.name + "”? This can't be undone.")) return;
    layouts.splice(i, 1); storeLayouts(); drawLayouts(); say("Deleted the saved layout “" + l.name + "”.");
  }
  function slug(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }
  $("exportLayout").addEventListener("click", function () {
    var name = cleanName($("layoutName").value) || defaultName(), file = "drawer-layout-" + (slug(name) || "untitled") + ".json";
    save(file, new Blob([JSON.stringify(layoutFile(S, name), null, 1)], { type: "application/json" }), "Saved " + file + ".");
  });
  $("importLayout").addEventListener("click", function () { $("importFile").value = ""; $("importFile").click(); });
  $("importFile").addEventListener("change", function () {
    var f = $("importFile").files[0]; if (!f) return;
    if (f.size > 2e6) { say("That file is too big to be a drawer layout."); return; }
    f.text().then(function (text) {
      var data; try { data = JSON.parse(text); } catch (e) { say("Couldn't read " + f.name + ": it isn't a layout file."); return; }
      var got = loadLayout(data, "Imported " + f.name + ".");
      if (!got) return;
      // keep a copy in the saved list under its own name
      var name = got.name || cleanName(f.name.replace(/\.json$/i, "")) || defaultName(), before = layouts;
      layouts = putLayout(layouts, name, layoutFile(S, name), Date.now()).list;
      if (!storeLayouts()) layouts = before;
      drawLayouts();
    }, function () { say("Couldn't open " + f.name + "."); });
  });

  function starter() {
    S.bins = [newBin(0, 0, 2, 2), newBin(2, 0, 1, 2)];
    S.selId = S.bins[1].id;
  }
  if (!S.bins.length) { try { if (localStorage.getItem(KEY) === null) starter(); } catch (e) { starter(); } }
  initThree();
  update();
  drawLayouts();
})();
