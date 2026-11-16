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
- Changing counts with bins already placed: keep the bins that still fit, and drop or clip the rest with a notice. (Settled below.)

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
- **Not in v1:** labels. (Finger scoops came in v1.1, below.)

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

## Settled while building (v1)

The four open details from the interview, and the choices made in v1:

1. **Grid counts change with bins placed.** Every bin keeps its cell position and size. A bin that now runs past the right or back edge is cut back to the grid. A bin whose first cell is gone is removed. The status line says how many were cut back or removed, with an **Undo**. Nothing grows, so nothing can end up overlapping. Changing the drawer size or the clearances goes through the same rule when the counts follow the suggestion.
2. **Corner bins in a rounded drawer.** Only the corner that touches the drawer corner is rounded, concentric with the drawer: radius = drawer radius − wall clearance. It only kicks in when that is bigger than the bin corner radius. A stacking tray that sits on that corner gets the same radius there. Rounded bins get their own STL, tagged with the radius and corner, e.g. `1x4-50x198x63.5-round12.5-FR` (FL, FR, BL, BR as you face the drawer).
3. **Limits.**
   - Columns and rows: 1 to 30.
   - Smallest cell: 15 mm. That's two 1.6 mm walls, two clearances, and a pocket of about 11 mm. The count steppers stop there.
   - Bin height: 10 mm up to the drawer height.
   - Stacking needs a bin at least 30 mm tall, so the bottom bin and the tray each get at least 15 mm.
   - Drawer: 30 to 1500 mm wide and deep, 10 to 300 mm tall, corner radius 0 to 50 mm.
   - Bed: 50 to 1000 mm per side.
4. **Auto-fill picks squarish bins.** Biggest area first, then the squarest of equal area, then wider before deeper. It walks the empty cells front row first, left to right. At each one it places the first size that fits the space and the bed. Squarer bins are stiffer, and long thin prints warp more.

Other choices made in v1:

- **Grid math.** Pitch = (drawer length − 2 × wall clearance + 2 × bin clearance) ÷ count. Every bin is (cells × pitch − 2 × bin clearance) at the rim. Neighbours are exactly 2 × bin clearance apart, and the outer bins sit exactly the wall clearance off the drawer walls. Bins with the same cell size have the same footprint anywhere in the drawer, so they share an STL. The panel shows the pitch as the cell size.
- **Suggested counts** follow the drawer until you change a count by hand. After that, a **Suggest** button puts them back.
- **Units.** The mm/inch toggle covers the drawer measurements, the bin height, and the stacking split. Fit and print settings and the bed size stay in mm, since slicer and printer specs use mm.
- **Stored precision.** Drawer measurements are kept to 0.01 mm, bin heights to 0.1 mm, so typed inches convert cleanly (`15 3/4` → 400.05 mm).
- **File names.** The footprint is rounded to whole mm. The height is to 0.1 mm, so two different heights never share a name. The zip is `drawer-<W>x<D>x<H>-<n>-bins.zip`.
- **Defaults.** First visit: a 400 × 300 × 60 mm drawer with square corners on an 8 × 6 grid, plus two starter bins.
- **Dividers** run full height, or stop 1 mm under the tray plug on a stacked bin. There's no divider-height setting in v1.
- **Drawing over the bed limit.** A drag stops growing at the last size that fits the bed, and the status line says why. The W/D steppers refuse the same way.

## Added in v1.1

Some features matched to GigaPrint's drawer organizer. Not taken: its 3MF plate packing, kitchen presets, randomized layouts, and per-bin wall and corner settings.

- **Stack heights you type.** **Bottom bin** and **Top tray** fields, in the current unit, plus the slider. Type either and the other takes up the rest of the bin's height. Each part is still at least 15 mm, and a value outside that is clamped with a message.
- **Split and merge.** Split cuts the selected bin in two across W or D. The left or front part gets the extra cell of an odd size, and both halves keep the bin's options. Shift-, ⌘- or Ctrl-click picks more bins. **Merge** is offered when two or more are picked and is enabled only when they fill a rectangle exactly (their cells add up to the bounding box). The merged bin keeps the options of the bin selected first and must fit the bed. Delete removes every picked bin.
- **Undo and redo** replace the one-step undo. `update()` records a step whenever the bins, grid counts, drawer, or fit settings changed since the last step. It doesn't record mid-drag or while the stack slider is moving. The history holds 100 steps and isn't saved. ⌘Z undoes; ⇧⌘Z or ⌘Y redoes.
- **Finger scoops,** a per-bin option. Each one is a closed prism whose profile is a quarter-circle fillet from the floor up the front face of each row of compartments, in bins and in every tray. Like the dividers, it overlaps the wall, floor, and dividers, and the slicer unions them. Its ends stop where a rounded corner starts, so it never pokes out through a corner. Radius = min(setting, 0.6 × compartment depth minus a divider, 0.8 × usable height). It is skipped below 2 mm. The setting defaults to 12 mm (4–30). Files get `-scoop`. Without scoops, exports are byte-identical to v1, and the golden hashes are unchanged.
- **Saved layouts.** Named layouts are kept in localStorage under `dob-layouts-v1`, newest first, at most 50. Each one is the same object as an exported file: the saved state plus `format: "drawer-organizer-layout"`, `version: 1` and a name of up to 60 characters. Saving under an existing name (case-insensitive) replaces it. Loading or importing goes through `restoreState` on a fresh state, so a hand-edited or old file can't break the page. Bins that can't be placed are counted and reported. A load is one undo step. Deleting a saved layout asks first, because undo doesn't cover the saved list. Import refuses anything without the format tag, and files over 2 MB.
- **Printer presets.** A **Printer** picker in **Fit and print**, above the bed X and Y, sets the bed X × Y from a list of about 30 common printers, using each maker's printable area. The H2D uses its single-nozzle area, 325 × 320. The chosen preset is saved as `bedPreset` and is part of undo and of layout files. It only shows while the bed still matches its size; typing a different X or Y turns the picker back to **Custom size**. Bed-size messages name the printer. Sizes were checked against makers' and retailers' specs on 2026-11-16.
