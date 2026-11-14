import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, toSTL, zip } from "../src/export.js";
import { fresh, unzip } from "./helpers.js";

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("STL is binary with an 80 byte header, a count, and 50 bytes per triangle", () => {
  const tris = [[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 0, 0], [0, 1, 0], [0, 0, 1]]];
  const u = toSTL(tris, "test");
  assert.equal(u.length, 84 + 2 * 50);
  assert.equal(new DataView(u.buffer).getUint32(80, true), 2);
  assert.equal(new TextDecoder().decode(u.subarray(0, 15)), "Drawer bin test");
  assert.ok(Math.abs(new DataView(u.buffer).getFloat32(84 + 8, true) - 1) < 1e-6); // first normal points +z
});

test("zip round-trips names and sizes", async () => {
  const files = [{ name: "a.txt", data: "hello" }, { name: "b.bin", data: new Uint8Array([1, 2, 3]) }];
  assert.deepEqual((await unzip(files)).map(f => [f.name, f.size]), [["a.txt", 5], ["b.bin", 3]]);
  const u = new Uint8Array(await zip(files).arrayBuffer());
  assert.equal(new DataView(u.buffer).getUint32(u.length - 22, true), 0x06054b50); // end of central directory
});

test("file names carry cells, real millimetres, and options; matching bins share one file", async () => {
  const { S, ex, newBin } = fresh();
  S.bins = [newBin(0, 0, 2, 3), newBin(2, 0, 2, 3), newBin(4, 0, 1, 1, { h: 35.25 }), newBin(5, 0, 2, 2, { divW: 3, divD: 2 })];
  assert.deepEqual(S.bins.map(ex.fileStem), ["2x3-100x150x60", "2x3-100x150x60", "1x1-50x50x35.3", "2x2-100x100x60-div3x2"]);
  const z = ex.allBinsFiles();
  assert.equal(z.name, "drawer-400x300x60-4-bins.zip");
  assert.deepEqual((await unzip(z.files)).map(f => f.name), ["2x3-100x150x60-x2.stl", "1x1-50x50x35.3.stl", "2x2-100x100x60-div3x2.stl"]);
  assert.deepEqual(z.groups.map(g => [g.count, g.bins]), [[2, [1, 2]], [1, [3]], [1, [4]]]);
});

test("stacked bins export a base and trays, and identical trays share a file", async () => {
  const { S, ex, newBin } = fresh();
  S.bins = [newBin(0, 0, 2, 2, { stack: true, split: "4", lowerH: 20, trayDivW: 2 }), newBin(2, 0, 2, 2, { stack: true, split: "w" })];
  const names = (await unzip(ex.allBinsFiles().files)).map(f => f.name);
  assert.deepEqual(names, ["2x2-100x100x60-stack-base20-rib4.stl", "2x2-100x100x60-stack-top44-split4-div2x1-x4.stl",
                           "2x2-100x100x60-stack-base30-ribw.stl", "2x2-100x100x60-stack-top34-split2w-x2.stl"]);
});

test("a rounded drawer corner gets its own file, named for the corner", async () => {
  const { S, ex, newBin } = fresh({ drawerR: 10 });
  S.bins = [newBin(0, 0, 1, 1), newBin(7, 5, 1, 1), newBin(3, 0, 1, 1), newBin(0, 5, 1, 1, { stack: true, split: "d" })];
  assert.deepEqual(S.bins.map(ex.fileStem), ["1x1-50x50x60-round9.8-FL", "1x1-50x50x60-round9.8-BR", "1x1-50x50x60", "1x1-50x50x60-stack-base30-ribd-round9.8-BL"]);
  assert.deepEqual(ex.partsOf(S.bins[3]).slice(1).map(p => p.stem), ["1x1-50x50x60-stack-top34-split2d", "1x1-50x50x60-stack-top34-split2d-round9.8-BL"]);
  assert.equal(ex.describe(S.bins[0]), "rounded corner");
});
