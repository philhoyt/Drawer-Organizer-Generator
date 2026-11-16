# Drawer Organizer Builder

Print custom bins that fill a drawer edge to edge. Enter the drawer's inside measurements, split the floor into a grid, draw bins on it, preview them in 3D, and download every STL in one zip.

[![Open the app](https://img.shields.io/badge/Open_the_app-Drawer_Organizer_Builder-F2B200?style=for-the-badge&labelColor=1C1C1A)](https://philhoyt.github.io/Drawer-Organizer-Generator/)

The third app in the family, after the [Storehouse Bin Builder](https://github.com/philhoyt/Storehouse-Bin-Generator) and the Hex Bit Holder Builder.

## Use it

**[Open the Drawer Organizer Builder](https://philhoyt.github.io/Drawer-Organizer-Generator/)**

It runs in your browser. No install, no account. To run it from a local checkout, serve the folder (for example `npm run serve`, then open http://localhost:8767). Opening `index.html` straight from disk won't work, because the app is split into modules that browsers only load over HTTP.

1. Measure the inside of the drawer: width (left to right as you face it), depth (front to back), height, and the corner radius if the corners are rounded. Measure height to the lowest thing above the drawer, so it still closes.
2. Pick how many columns and rows. The app suggests counts that give cells near 50 mm.
3. Drag across empty cells on the floor map to draw a bin. Drag a bin to move it. Or press **Auto-fill** to fill the empty cells.
4. Select a bin to set a shorter height, dividers, a finger scoop, or stacking. Split it in two, or shift-click several bins and merge them.
5. Click **Download all bins**. Matching bins share one STL, and the file name says how many to print.

Your layout saves itself in the browser and comes back next time. **Undo** and **Redo** (⌘Z, ⇧⌘Z) step back through every change to the bins, grid, drawer, and fit settings.

## Units

Switch between mm and inches at the top of the **Drawer** panel. Inches take decimals or fractions: `14.375`, `14 3/8`, and `14-3/8` all work. You can also type a unit on the end (`365mm`, `2"`) to override the toggle for one field. Everything is stored in millimetres, so switching back and forth never drifts.

**Fit and print** settings and the bed size stay in millimetres.

## The grid

Cells stretch to fill the drawer. There's never any leftover. With the default clearances, a 400 mm drawer with 8 columns has 50 mm cells.

Every bin's footprint is measured at its top rim. Neighbours sit 2 × the bin clearance apart there, and the outer bins sit the wall clearance off the drawer walls. The walls taper inward toward the floor, so there's more room down low.

If you change the counts with bins already placed, every bin keeps its cell position. A bin that now runs off the grid is cut back to fit, or removed if its first cell is gone. The status line tells you, with an **Undo**.

## Bed size

Set your printer's bed under **Fit and print** (default 220 × 220 mm). A bin fits if its footprint fits either way round, since you can turn it on the bed. You can't draw a bin bigger than the bed. If you shrink the bed or the grid makes a bin too big, it's flagged on the map and **Download all bins** stays off until you fix it.

## Rounded drawers

If the drawer has rounded inside corners, enter the radius. A bin in a corner gets that one corner rounded to match, so it sits flush. Its other corners stay at the normal bin radius. Rounded bins print as their own files, named for the corner: `-round12.5-FL` is front-left.

## Bins

- **Height.** Every bin is the drawer height unless you set it shorter. Clear the box to follow the drawer again.
- **Dividers.** Split a bin into compartments across W, D, or both.
- **Split and merge.** **Split left | right** or **Split front | back** cuts the selected bin in two; both halves keep its options. Shift-click (or ⌘-click) more bins to pick them, then **Merge** joins them, as long as they fill a rectangle with no gaps.
- **Finger scoop.** A curved ramp from the floor up the front wall of each compartment, so small parts slide out instead of catching in the corner. It follows the dividers, goes in every tray of a stacked bin, and shrinks to fit short bins and narrow compartments. Set the radius under **Fit and print** (default 12 mm).
- **Stacking.** A stacked bin is a shorter bottom bin plus a lift-out tray. The tray has a plug that drops inside the bin's rim, and together they fill the bin's height. Type the **Bottom bin** or **Top tray** height (or drag the slider) and the other takes up the rest; each is at least 15 mm. The top can be one tray, two (across W or D), or four. Split tops get support ribs in the bottom bin. Trays can have their own dividers. It works the same way as in the Storehouse Bin Builder; see its [STACKING.md](https://github.com/philhoyt/Storehouse-Bin-Generator/blob/main/STACKING.md) for how the parts fit together.

Bins stay put by friction. There are no feet, clips, or baseplate.

## File names

`2x3-100x150x60-x2.stl` is 2 × 3 cells, 100 × 150 mm at the rim, 60 mm tall, print 2. Real millimetres, because cell size changes from drawer to drawer. Extra tags:

| Tag | Meaning |
|---|---|
| `-div3x2` | 3 compartments across W, 2 across D |
| `-scoop` | finger scoops |
| `-stack-base30-rib4` | bottom bin of a stacked bin, 30 mm tall, ribs for 4 trays |
| `-stack-top34-split4` | top tray, 34 mm tall including the plug, one of 4 |
| `-round12.5-FL` | front-left corner rounded to 12.5 mm |

## Fit

| Setting | Default |
|---|---|
| Clearance between bins, per side | 0.25 mm |
| Clearance to drawer walls, per side | 0.25 mm |
| Wall | 1.6 mm |
| Floor | 1.6 mm |
| Bin corner radius | 3 mm |
| Taper per side | 1.5° |
| Stack plug depth / clearance | 4 mm / 0.4 mm |
| Finger scoop radius | 12 mm |
| Bed | 220 × 220 mm |

If bins are tight in the drawer, raise the wall clearance. If they're tight against each other, raise the bin clearance. Print one small bin first.

## Development

```bash
npm install
npm run check
```

`npm run check` lints with ESLint and runs the tests; `npm run lint` and `npm test` do each on its own. ESLint is the only dependency. The tests run on Node's built-in runner:

- unit tests for unit parsing, the grid math, placement and bed checks, regridding, auto-fill, split and merge, and the checked restore of saved state
- every bin, divided bin, scooped bin, stacked base, and tray is checked for a closed mesh, and its enclosed volume is compared with the volume worked out from the spec
- golden tests hash the exported zips for a set of layouts and compare them with values recorded from the real page, so any change to the geometry or the export format shows up as a failure. Re-record them only when the change is intended.

The mesh code uses its own trig series instead of `Math.sin` and friends so that every JavaScript engine produces the same bytes. GitHub Actions runs the same check on every push and pull request, and publishes the site to GitHub Pages only when it passes on `main`.

## Files

| File | What it is |
|---|---|
| `index.html` | The page: markup and styles. Loads three.js from a CDN and the app from `src/`. |
| `src/app.js` | Everything that touches the page: drawer inputs, the floor map, the panel, the 3D view, downloads. |
| `src/layout.js` | The stretching grid, placement rules, bed checks, regridding, auto-fill, split and merge, drawer-corner rounding. |
| `src/geometry.js` | Meshes for tapered bins, dividers, finger scoops, stacking trays, and ribs. |
| `src/export.js` | File names, grouping, the STL and zip writers. |
| `src/state.js` | Defaults, limits, unit parsing, and the checked restore of saved state. |
| `test/` | Node tests. Golden checksums of exports, mesh checks, and unit tests. |
| `SCOPE.md` | What v1 covers, and the choices made while building it. |
