# Drawer Organizer Builder: scope

Print custom bins that fill a drawer. Enter the drawer's inside dimensions, split the floor into a grid, draw bins on it, preview them in 3D, and download every STL in one zip.

Third app in the family, after the [Storehouse Bin Builder](../Storehouse%20Bin%20Generator) and the [Hex Bit Holder Builder](../Hex%20Bit%20Holder%20Generator). Agreed in the interview on 2026-11-14.

- Public name: **Drawer Organizer Builder**
- Repo: `Drawer-Organizer-Generator`, Pages at `philhoyt.github.io/Drawer-Organizer-Generator/`
- Local folder: `apps/Drawer Organizer Generator` (the empty `DrawerMaxxer` folder can be deleted)

## Stack

Same as the sibling apps, **except no OpenSCAD version**.

- Plain `index.html` + ES modules in `src/`, three.js from a CDN, served over HTTP (`npm run serve`, port 8767).
- Own mesh code, no CSG library. Trig series instead of `Math.sin` so output bytes match across engines.
- Tests on Node's built-in runner: watertight check (every edge shared by exactly two opposite triangles), enclosed volume vs. expected, golden hashes of exported zips recorded from the real page, unit tests for state and layout.
- ESLint is the only dependency. `npm run check` = lint + test.
- GitHub Actions runs the check on push/PR and deploys Pages only when `main` passes.

## Drawer input

| Input | Notes |
|---|---|
| Inside width (W) | Left to right as you face the drawer |
| Inside depth (D) | Front to back |
| Inside height (H) | Default bin height comes from this |
| Inside corner radius | Corner bins get a matching rounded outer corner (only the corner touching the drawer corner) |

- **Units:** toggle between mm and inches. Inches accept decimals and fractions (`14 3/8`, `14.375`). Everything is stored in mm. Switching units converts the display, not the stored values.
- No keep-out zones and no separate usable-height field in v1.

## Grid

- The user picks **columns × rows**. Cells stretch to fill: cell W = (drawer W − wall margins) ÷ columns, and the same for depth. There's never any leftover.
- The app suggests counts that give cells near a target size (default about 50 mm), and the user can change them.
- Show the resulting cell size in the current unit next to the counts.
- Changing counts with bins already placed: keep the bins that still fit, and drop or clip the rest with a notice. (Exact behavior to settle during implementation.)

## Placing bins

- Storehouse interaction: drag across empty cells to draw a bin, drag a bin to move it, select a bin to edit it.
- **Bed size:** the user enters bed X × Y (default 220 × 220). A bin bigger than the bed in both orientations can't be drawn. Each bin gets checked in either orientation, since you can rotate it on the bed. If the grid or bed size changes, bins that no longer fit get flagged on the map, and download stays blocked until they're fixed.
- **Empty cells are allowed** and show up on the map.
- **Auto-fill** button: fills the remaining empty cells with the largest bins that fit the bed. Greedy, largest-first, deterministic so golden tests stay stable.

## Bins

- **Tapered walls** like Storehouse (1.5° draft per side by default), with rounded vertical corners. The nominal footprint is at the top rim, so neighbors touch at the rim with the clearance gap.
- **Height:** drawer height is the default for every bin, and any bin can be set shorter.
- **Dividers:** split a bin into compartments across W and/or D, like Storehouse.
- **Stacking trays:** ported from Storehouse. A shorter bottom bin plus a lift-out tray with a plug that drops inside the rim. Splits into 1, 2 across W, 2 across D, or 4. Split tops get support ribs. Trays can have their own dividers. The tray height fills up to the bin's set height.
- **Anchoring:** friction fit only. No feet, pad recesses, baseplate, or clips.
- **Not in v1:** labels, finger scoop.

## Fit and print

Defaults come from Storehouse. All of these can be changed under **Fit and print**:

| Setting | Default |
|---|---|
| Clearance between bins, per side | 0.25 mm |
| Clearance to drawer walls, per side | 0.25 mm (same default, separate setting) |
| Wall thickness | 1.6 mm |
| Floor thickness | 1.6 mm |
| Bin corner radius | 3 mm |
| Wall draft | 1.5° |
| Stacking plug depth / clearance | 4 mm / 0.4 mm |
| Bed X × Y | 220 × 220 mm |

No fit-test download in v1.

## Export

- **Download all bins** gives one zip of STLs. Identical bins share one STL, and its file name carries the count.
- File names use real millimetres, since cell size changes from drawer to drawer. For example `2x3-108x96x60-x2.stl`: grid cells, top footprint W × D, height, count. Stacked parts follow the Storehouse pattern (`-stack-base…`, `-stack-top…-split4`).
- Not in v1: layout.txt, layout image, per-bin download.

## Saving

- Autosave to `localStorage`, restored on load with a checked restore like Storehouse's `state.js` (bad or stale values fall back to defaults).
- Not in v1: share links, multiple drawers, JSON import/export.

## Files (planned)

| File | What it is |
|---|---|
| `index.html` | Markup and styles. three.js from a CDN, app from `src/`. |
| `src/app.js` | Floor map, panel, 3D view, downloads. |
| `src/layout.js` | Drawer → grid, placement rules, bed checks, auto-fill. |
| `src/geometry.js` | Tapered bins, dividers, trays, ribs, drawer-corner rounding. |
| `src/export.js` | Grouping, file names, STL and zip writers. |
| `src/state.js` | Defaults, limits, unit parsing, checked restore. |
| `test/` | Watertight, volume, golden, unit tests. |

Reuse from Storehouse wherever it fits (zip/STL writers, trig series, tray and rib geometry, the floor-map interaction), adapted from a fixed pitch to a per-drawer cell size.

## Open details to settle while building

1. What happens to placed bins when the grid counts change.
2. Corner bins in a rounded drawer: round only the drawer-facing corner, or all four corners at the drawer radius.
3. Limits: max columns/rows, min cell size (a cell has to hold two walls + clearance + a usable pocket), and min/max height.
4. Whether auto-fill prefers square-ish bins or the longest strips that fit the bed.
