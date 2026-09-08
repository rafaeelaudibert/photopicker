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
  `aspect-ratio` it mis-sizes rows on scroll re-entry. Plain DOM is fine: 2000 cells scan
  in ~300ms and scroll at 60fps.
- **Thumbnails decode last-in-first-out** (`thumbs.ts`). The queue is a stack so the tiles
  you just scrolled to jump ahead of a backlog. Do not switch it to FIFO.
- **`createImageBitmap` needs `imageOrientation: 'from-image'`**, otherwise photos with an
  EXIF rotation tag appear sideways in the grid while looking correct in the preview.
- **Thumbnails use `object-fit: cover`, the preview uses `contain`.** The grid is for
  scanning and wants uniform tiles; the preview must show the true uncropped frame.
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

It asserts tile geometry (the bug above), that all three picking gestures work, that EXIF
parses, that filters narrow the list, and that export writes the right bytes. Point it at
a folder of JPEGs with `PHOTOS=/path/to/folder`.

Generating test photos without a camera:

```sh
magick -size 1600x1200 plasma:fractal -blur 0x4 -quality 88 out.jpg
```

## Layout

```
src/
  App.tsx        state, keyboard, layout, divider drag
  TopBar.tsx     folder, filters, size, quota counter, export
  Preview.tsx    large frame, pick button, EXIF strip, field chooser
  Cell.tsx       one memoised tile, lazily thumbnailed
  fs.ts          directory scan, permissions, copy out
  thumbs.ts      worker pool, LIFO queue, LRU blob cache
  thumb.worker.ts
  exif.ts        JPEG APP1 / TIFF IFD parser
  idb.ts         folder handle persistence
  useInView.ts   shared IntersectionObserver
```

State that outlives a session: picks, target, tile size, pane width and EXIF field choice
in `localStorage`; the folder handle in IndexedDB.
