# Working on Photopicker

A local-only photo culling tool. React 19 + TypeScript + Vite, run with bun. No runtime
dependencies beyond React, and that is deliberate: EXIF parsing, thumbnailing, grid
virtualisation and file IO are all hand-rolled and small.

## Commands

```sh
bun install
bun run dev      # dev server on :5173
bun run build    # tsc -b && vite build, must pass before committing
```

Pushing to `main` builds and publishes `dist` to GitHub Pages
(`.github/workflows/deploy.yml`).

## Workflow

Commit and push straight to `main`. No pull requests, no feature branches. Keep each
commit a coherent change with a message that explains why, and make sure `bun run build`
passes before pushing.

## Writing style

- **No em dashes anywhere.** Not in code, comments, UI copy, docs or commit messages.
  Use a comma, a colon, or two sentences.
- Comments explain why, not what. Most code here needs none; the exceptions are the
  browser quirks called out below, which must keep their comments.
- UI copy is sentence case, active voice, and names things the way a person using the app
  would. "Copy 12" not "Export selection".

## The hard-won details

Change these only with a measurement in hand.

- **Grid rows are sized from JavaScript, on purpose.** `.cell` cannot use `aspect-ratio`
  to size itself inside the grid. Chrome does not feed `aspect-ratio` into `auto` grid row
  sizing when the cell's only content is a percentage-height child, so every row collapses
  to the 2px border height and all tiles stack on top of each other. `App.tsx` measures the
  resolved column width and sets `--row`, which `grid-auto-rows` consumes. If you change
  the grid CSS, verify `getComputedStyle(grid).gridTemplateRows` is not `2px`.
- **Do not add `content-visibility: auto` to `.cell`.** It was tried. Combined with
  `aspect-ratio` it mis-sizes rows on scroll re-entry.
- **The grid renders a window of rows, and needs two elements to do it.** Rows outside the
  window become `padding-top` and `padding-bottom` on `.grid`, which keeps cells as direct
  children so auto-placement and `--row` keep working. `.grid-pane` is the thing that
  scrolls. They cannot be one element: padding larger than the element's height inflates
  its own border box rather than its scrollable content, so the scroller grows to fit the
  window, which grows the window. `GRID_GAP` and `GRID_PAD` in `App.tsx` must match `.grid`.
- **The window is derived from a height held in state**, refreshed by the `ResizeObserver`,
  not read live inside the scroll handler. Reading `clientHeight` live meant one
  measurement taken before the flex layout settled stuck for the whole session.
- **Thumbnails decode last-in-first-out** (`thumbs.ts`). The queues are stacks so the tiles
  you just scrolled to jump ahead of a backlog. Do not switch either to FIFO.
- **Thumbnailing is two passes, and the quick one must outrank the full one.** The quick
  pass pulls the camera's own thumbnail out of EXIF IFD1 and decodes in about a
  millisecond; the full pass is a real 800px render and costs a hundred times that. If
  full ever gets served first the grid goes back to filling one tile at a time.
- **The IFD1 thumbnail is stored unrotated and carries no EXIF of its own**, so
  `thumb.worker.ts` applies IFD0's orientation tag by hand. The full pass uses
  `createImageBitmap` with `imageOrientation: 'from-image'` instead, which does it for you.
  Both paths have to agree, otherwise a tile flips as it sharpens. Check all eight
  orientation values if you touch either.
- **`frames.ts` holds five decoded frames and no more.** Each one retains a full
  resolution bitmap, which is tens of megabytes on a 24MP file. Five is the photo on
  screen plus two either side, which is what the cursor needs. Raising it trades memory
  for nothing.
- **A frame is decoded before it is displayed**, in `frames.ts` and in `Cell.tsx`. Pointing
  an `<img>` at a `src` that has not decoded paints one empty frame, which is exactly the
  blink both caches exist to remove. Do not "simplify" the `image.decode()` calls away.
- **Thumbnails use `object-fit: cover`, the preview uses `contain`.** The grid is for
  scanning and wants uniform tiles; the preview must show the true uncropped frame.
- **The preview stage only scrolls in actual size mode.** Fitting the frame to the pane
  must never produce a scrollbar. The image needs `min-width: 0; min-height: 0` for that:
  a centred grid item keeps its automatic minimum size, which stops `max-height` from
  shrinking a tall photo.
- **Vite's `base` is `'./'`, not `'/'`.** The Pages deploy serves the app from
  `/photopicker/`, and an absolute base would make every asset 404 there. Relative keeps
  one bundle working on the dev server, on Pages and from a local `dist`. The worker is
  unaffected either way: `new URL('./thumb.worker.ts', import.meta.url)` resolves against
  the chunk's own URL at runtime.
- **The list is ordered before it is filtered, not after.** With no filter on, `view` is
  the ordered array itself, so a pick does not hand the grid a new array and nothing
  re-renders. Filtering first and ordering after would rebuild the list on every pick.
- **Capture times are read lazily, once per folder.** Date order needs a `getFile` and an
  Exif parse per photo, which on 2000 files is seconds, so it only runs when the user
  asks for that order. A photo with no `DateTimeOriginal` falls back to the file's
  `lastModified`, which keeps it near its neighbours instead of at the epoch.
- **Re-ordering has to carry the selection with it.** The cursor is an index, so without
  `keepKey` in `App.tsx` changing the order would leave it pointing at whatever photo
  landed in that position.
- **Shortcuts are declared once, in `shortcut-list.ts`.** Controls label themselves from
  `KEY`, and the `?` sheet lists the same values, so a rebound key cannot leave a stale
  hint printed on a button. Add a shortcut there first, then handle it in `App.tsx`.
  Note `shortcut-list.ts` and `Shortcuts.tsx` cannot be named the same: a case-insensitive
  filesystem makes `./shortcuts` ambiguous and the build fails.

## Privacy constraint

The app must never make a network request. No fonts from a CDN, no analytics, no image
services. System font stacks only. This is the main reason a user would choose this over
a hosted tool, and it is worth turning down a feature to keep.

## Verifying changes

The File System Access API cannot be driven through a native file picker, so the harness
in `scripts/verify.mjs` substitutes `window.showDirectoryPicker` at the page level and
drives the real UI in real Chrome. Application code is never modified for tests.

```sh
bun add -d playwright        # not a declared dependency, install when you need it
bun run dev                  # in another shell
node scripts/verify.mjs      # geometry, picking, EXIF, filters, export
```

It asserts tile geometry (the bug above), that the grid really is a window and still
scrolls the full length of the list, that all three picking gestures work, that picks
reach `localStorage`, that EXIF parses, that navigating never blanks the stage or shifts
the EXIF rows, that the fitted stage never scrolls, that filters narrow the list, that
date order keeps every photo and keeps the selection on the photo it was on, and that
export writes the right bytes. Point it at a folder of JPEGs with `PHOTOS=/path/to/folder`.

Generating test photos without a camera:

```sh
magick -size 1600x1200 plasma:fractal -blur 0x4 -quality 88 out.jpg
```

Those carry neither an EXIF thumbnail nor a date, so they exercise neither the quick
thumbnail pass nor date ordering: with no `DateTimeOriginal` every file falls back to its
timestamp, which for a folder generated in one go is already name order. To check that path
you need files with an IFD1 thumbnail, which means either real camera JPEGs or splicing an
APP1 segment in by hand. Vary the orientation tag across the set: the quick and full
passes disagreeing on which way is up is the failure mode worth catching.

## Layout

```
src/
  App.tsx        state, keyboard, row window, divider drag
  TopBar.tsx     folder, filters, size, quota counter, export
  Preview.tsx    large frame, pick button, EXIF strip, field chooser
  Cell.tsx       one memoised tile in the window
  fs.ts          directory scan, permissions, capture times, copy out
  thumbs.ts      worker pool, quick and full LIFO lanes, LRU blob cache
  thumb.worker.ts
  frames.ts      five decoded full frames around the cursor
  exif.ts        JPEG APP1 / TIFF IFD parser, including the IFD1 thumbnail
  idb.ts         folder handle persistence
```

State that outlives a session: picks, target, tile size, pane width, list order and EXIF
field choice in `localStorage`; the folder handle in IndexedDB. The `localStorage` writes go through
`persist()` in `App.tsx`, which defers them to an idle callback and flushes on `pagehide`.
