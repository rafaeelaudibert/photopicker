/**
 * Drives the real UI in real Chrome. The File System Access API cannot be
 * automated through a native picker, so window.showDirectoryPicker is replaced
 * at the page level. Application code is never modified for tests.
 *
 *   bun add -d playwright
 *   bun run dev
 *   node scripts/verify.mjs [--shots]
 *
 * PHOTOS=/path/to/jpegs picks a different folder. URL=... a different server.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const PHOTOS = process.env.PHOTOS ?? '/tmp/photopicker-test'
const URL_BASE = process.env.URL ?? 'http://localhost:5173'
const SHOTS = process.argv.includes('--shots')
const IMAGE = /\.(jpe?g|png|webp|avif)$/i

if (!fs.existsSync(PHOTOS)) {
  console.error(`No photo folder at ${PHOTOS}. Set PHOTOS=/path/to/jpegs.`)
  process.exit(1)
}

/** Mirrors the folder into the shape the mocked picker walks. */
function tree(dir, urlPrefix) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const url = `${urlPrefix}/${entry.name}`
      if (entry.isDirectory()) {
        return [{ kind: 'directory', name: entry.name, entries: tree(path.join(dir, entry.name), url) }]
      }
      return IMAGE.test(entry.name) ? [{ kind: 'file', name: entry.name, url }] : []
    })
}

const manifest = { name: path.basename(PHOTOS), entries: tree(PHOTOS, '/__photos') }
const failures = []
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures.push(`${label}: got ${actual}, expected ${expected}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual}`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && failures.push(`console error: ${m.text()}`))

// Serve the photos straight off disk rather than copying them into public/.
await page.route('**/__photos/**', (route) => {
  const file = path.join(PHOTOS, decodeURIComponent(new URL(route.request().url()).pathname.replace('/__photos/', '')))
  if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' })
  route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(file) })
})

await page.addInitScript((data) => {
  const makeFile = (name, url) => ({
    kind: 'file',
    name,
    getFile: async () => new File([await (await fetch(url)).blob()], name, { type: 'image/jpeg' }),
  })
  const makeDir = (node) => ({
    kind: 'directory',
    name: node.name,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    values: () =>
      (async function* () {
        for (const e of node.entries) yield e.kind === 'directory' ? makeDir(e) : makeFile(e.name, e.url)
      })(),
  })
  window.__written = []
  window.showDirectoryPicker = async ({ mode } = {}) =>
    mode === 'readwrite'
      ? {
          kind: 'directory',
          name: 'to-print',
          getFileHandle: async (name) => ({
            createWritable: async () => ({
              write: async (blob) => window.__written.push({ name, size: blob.size }),
              close: async () => {},
            }),
          }),
        }
      : makeDir(data)
}, manifest)

const total = JSON.stringify(manifest).split('"kind":"file"').length - 1
await page.goto(URL_BASE)
await page.getByRole('button', { name: /Open folder|Resume/ }).first().click()
await page.waitForSelector('.cell img', { timeout: 60000 })
await page.waitForTimeout(2500)

check('photos found', (await page.locator('.filter-count').first().innerText()).trim(), total)

// Only the rows on screen are in the DOM. The rest are padding, so the grid
// must still scroll as if every tile were there.
const windowed = await page.evaluate(() => {
  const style = getComputedStyle(document.querySelector('.grid'))
  return {
    cells: document.querySelectorAll('.cell').length,
    cols: style.gridTemplateColumns.split(' ').filter(Boolean).length,
    row: Number.parseFloat(style.gridTemplateRows.split(' ')[0]),
    height: document.querySelector('.grid-pane').scrollHeight,
  }
})
check('grid renders a window, not the whole list', windowed.cells < total, true)
check(
  'scroll height covers every row',
  Math.abs(windowed.height - (Math.ceil(total / windowed.cols) * (windowed.row + 8) - 8 + 20)) < 3,
  true,
)

// Tiles must be square and must not overlap. Regression guard for the grid row bug.
const grid = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.cell')].slice(0, 60)
  const a = cells[0].getBoundingClientRect()
  const rows = getComputedStyle(document.querySelector('.grid')).gridTemplateRows.split(' ')
  // Row tops must be at least one tile apart, whatever the column count is.
  const tops = [...new Set(cells.map((c) => Math.round(c.getBoundingClientRect().top)))].sort((x, y) => x - y)
  return {
    square: Math.abs(a.width - a.height) < 2,
    firstRow: Number.parseFloat(rows[0]),
    overlap: tops.some((t, i) => i > 0 && t - tops[i - 1] < a.height - 1),
  }
})
check('tiles square', grid.square, true)
check('tiles overlap', grid.overlap, false)
check('row height matches tile', grid.firstRow > 20, true)

// Scrolling to the end must land on real tiles, not on the spacer padding.
await page.evaluate(() => {
  const pane = document.querySelector('.grid-pane')
  pane.scrollTop = pane.scrollHeight
})
await page.waitForTimeout(600)
const atEnd = await page.evaluate(() => {
  const grid = document.querySelector('.grid-pane').getBoundingClientRect()
  const cells = [...document.querySelectorAll('.cell')]
  const last = cells[cells.length - 1].getBoundingClientRect()
  return { last: Number(cells[cells.length - 1].dataset.index), gap: Math.round(grid.bottom - last.bottom) }
})
check('scrolling to the end reaches the last photo', atEnd.last, total - 1)
// Only the grid's own 10px bottom padding should sit below the last row.
check('no spacer left under the last row', atEnd.gap <= 11, true)
await page.evaluate(() => {
  document.querySelector('.grid-pane').scrollTop = 0
})
await page.waitForTimeout(400)

await page.locator('.cell').nth(3).click()
await page.keyboard.press('Space')
await page.locator('.cell').nth(7).dblclick()
check('picking by keyboard and double-click', (await page.locator('.counter').innerText()).split('\n')[0], '002')

// Picks are written on an idle callback, so they must still reach localStorage.
await page.waitForTimeout(2200)
check(
  'picks reach localStorage',
  await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('photopicker:picks:'))
      .flatMap((k) => JSON.parse(localStorage.getItem(k))).length,
  ),
  2,
)

await page.keyboard.press('ArrowRight')
check('arrow key moves the cursor', (await page.locator('.preview-pos').innerText()).split(' ')[0], '9')

// The stage must never empty out between one photo and the next, and the EXIF
// strip must keep its rows so the frame above it does not shift.
const readStage = () =>
  page.evaluate(() => {
    const stage = document.querySelector('.preview-stage')
    return {
      painted: !!stage.querySelector('img'),
      scrolls: stage.scrollHeight > stage.clientHeight + 1 || stage.scrollWidth > stage.clientWidth + 1,
      rows: [...document.querySelectorAll('.info-row .label')].map((e) => e.textContent).join(','),
    }
  })
const seen = { blank: 0, samples: 0, rows: new Set(), scrolled: 0 }
for (let step = 0; step < 6; step++) {
  await page.keyboard.press('ArrowRight')
  for (let i = 0; i < 12; i++) {
    const stage = await readStage()
    seen.samples++
    if (!stage.painted) seen.blank++
    if (stage.scrolls) seen.scrolled++
    seen.rows.add(stage.rows)
  }
  await page.waitForTimeout(250)
}
check(`stage never blanks while navigating (${seen.samples} samples)`, seen.blank, 0)
check('exif strip keeps its rows while navigating', seen.rows.size, 1)
check('fitted stage never scrolls', seen.scrolled, 0)
for (let step = 0; step < 6; step++) await page.keyboard.press('ArrowLeft')
await page.waitForTimeout(600)

// The frame must not resize or move when the full size replaces the thumbnail
// standing in for it. The image box fills the stage and object-fit letterboxes
// inside it, so the painted photo depends only on its aspect ratio, which the
// thumbnail shares. Sizing with max-width and max-height instead only shrinks:
// a thumbnail smaller than the pane would sit at its own natural size in the
// middle, and the full frame would jump up and across to fill.
check(
  'fitted image box fills the stage, so every resolution lands in one place',
  await page.evaluate(() => {
    const stage = document.querySelector('.preview-stage')
    const img = stage.querySelector('img')
    if (!img) return 'no image'
    const style = getComputedStyle(stage)
    const pad = (side) => Number.parseFloat(style[`padding${side}`])
    const box = stage.getBoundingClientRect()
    const seen = img.getBoundingClientRect()
    const off = [
      seen.left - (box.left + pad('Left')),
      seen.top - (box.top + pad('Top')),
      seen.width - (box.width - pad('Left') - pad('Right')),
      seen.height - (box.height - pad('Top') - pad('Bottom')),
    ]
    return off.every((n) => Math.abs(n) < 2) ? true : `off by ${off.map(Math.round)}`
  }),
  true,
)

await page.keyboard.press('Home')
await page.waitForTimeout(600)

const exif = await page.locator('.info').innerText()
console.log(`ok   exif strip: ${exif.replace(/\n/g, ' | ').slice(0, 120)}`)

// Ordering by date taken reads a capture time out of every file. It must keep
// the whole list, keep the selection on the photo it was on rather than on a
// position, and hand the list back untouched when it is switched off again.
// Only the windowed rows are in the DOM, so the list is read from the top and
// compared over a fixed prefix.
const names = async () => {
  await page.evaluate(() => {
    document.querySelector('.grid-pane').scrollTop = 0
  })
  await page.waitForTimeout(400)
  return page.evaluate(() => [...document.querySelectorAll('.cell-name')].slice(0, 12).map((e) => e.textContent))
}
await page.locator('.cell').nth(2).click()
await page.waitForTimeout(300)
const byName = { photo: await page.locator('.preview-name').innerText(), order: await names() }

await page.keyboard.press('S')
await page.waitForTimeout(500) // let the read start, so its progress is there to wait on
await page.waitForFunction(() => !document.querySelector('.sort-count'), null, { timeout: 120000 })
await page.waitForTimeout(600)
check('date order keeps every photo', (await page.locator('.filter-count').first().innerText()).trim(), total)
check('date order keeps the selected photo', await page.locator('.preview-name').innerText(), byName.photo)
console.log(`ok   date order starts at ${(await names())[0]}, name order at ${byName.order[0]}`)

await page.keyboard.press('S')
await page.waitForTimeout(600)
check('name order comes back as it was', (await names()).join(','), byName.order.join(','))
await page.keyboard.press('Home')
await page.waitForTimeout(400)

await page.locator('.filter').nth(1).click()
await page.waitForTimeout(400)
check('picked filter narrows the grid', await page.locator('.cell').count(), 2)

await page.locator('.btn-primary').click()
await page.waitForTimeout(1500)
const written = await page.evaluate(() => window.__written)
check('export writes both files', written.length, 2)
check('exported files have bytes', written.every((w) => w.size > 0), true)

// More than one copy batch, so the parallel path and its name assignment run.
await page.locator('.filter').nth(0).click()
await page.waitForTimeout(300)
await page.evaluate(() => {
  window.__written = []
})
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowRight')
}
const expected = Number((await page.locator('.counter').innerText()).split('\n')[0])
await page.locator('.btn-primary').click()
await page.waitForTimeout(3000)
const batch = await page.evaluate(() => window.__written)
check('a batch larger than five copies every file', batch.length, expected)
check('exported names are unique', new Set(batch.map((w) => w.name)).size, batch.length)

if (SHOTS) {
  await page.locator('.filter').nth(0).click()
  await page.waitForTimeout(5200) // let the copy toast dismiss itself
  await page.screenshot({ path: 'docs/screenshot.png' })
  console.log('ok   wrote docs/screenshot.png')
}

await browser.close()
console.log(failures.length ? `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
