// Deploy step: stamp every script URL in the assembled site with a version (the commit), so a browser never runs a
// new page with modules it cached from an older deploy. GitHub Pages lets browsers reuse files for 10 minutes.
// Usage: node scripts/stamp.js <site dir> <version>. Only the copy in the site folder is changed, never the source.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

var PAGE_SCRIPT = /(<script type="module" src="src\/[\w-]+\.js)(")/g;
var IMPORT = /(\bfrom\s+"\.\/[\w-]+\.js)(")/g;

// Returns the stamped text and how many URLs were stamped.
export function stampText(text, pattern, version) {
  var n = 0;
  var out = text.replace(pattern, function (m, url, quote) { n++; return url + "?v=" + version + quote; });
  return { text: out, count: n };
}

export function stampSite(dir, version) {
  if (!/^[\w.-]+$/.test(version)) throw new Error("bad version: " + version);
  var page = stampText(readFileSync(join(dir, "index.html"), "utf8"), PAGE_SCRIPT, version);
  if (page.count !== 1) throw new Error("expected one module script in index.html, found " + page.count);
  writeFileSync(join(dir, "index.html"), page.text);
  var imports = 0;
  readdirSync(join(dir, "src")).filter(function (f) { return f.endsWith(".js"); }).forEach(function (f) {
    var p = join(dir, "src", f), r = stampText(readFileSync(p, "utf8"), IMPORT, version);
    writeFileSync(p, r.text); imports += r.count;
  });
  return { page: page.count, imports: imports };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  var r = stampSite(process.argv[2], process.argv[3]);
  console.log("Stamped " + r.page + " page script and " + r.imports + " imports with v=" + process.argv[3]);
}
