// The deploy stamp: run it on a copy of the real site and check every module URL carries the version.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stampSite } from "../scripts/stamp.js";

test("the deploy stamp versions the page script and every relative import, and nothing else", () => {
  const dir = mkdtempSync(join(tmpdir(), "dob-stamp-"));
  try {
    cpSync("index.html", join(dir, "index.html")); cpSync("src", join(dir, "src"), { recursive: true });
    const r = stampSite(dir, "abc1234");
    assert.equal(r.page, 1);
    const page = readFileSync(join(dir, "index.html"), "utf8");
    assert.ok(page.includes('<script type="module" src="src/app.js?v=abc1234">'));
    assert.ok(page.includes("three.min.js\" integrity"), "CDN scripts left alone");
    let seen = 0;
    readdirSync(join(dir, "src")).forEach(f => {
      const text = readFileSync(join(dir, "src", f), "utf8"), src = readFileSync(join("src", f), "utf8");
      const imports = [...text.matchAll(/from\s+"(\.\/[^"]+)"/g)].map(m => m[1]);
      imports.forEach(u => assert.match(u, /^\.\/[\w-]+\.js\?v=abc1234$/, f));
      seen += imports.length;
      assert.equal(text.replace(/\?v=abc1234/g, ""), src, f + ": only the URLs change");
    });
    assert.equal(r.imports, seen); assert.ok(seen >= 10);
    assert.throws(() => stampSite(dir, "bad version!"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
