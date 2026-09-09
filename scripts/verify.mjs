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

await page.keyboard.press('ArrowRight')
check('arrow key moves the cursor', (await page.locator('.preview-pos').innerText()).split(' ')[0], '9')

const exif = await page.locator('.info').innerText()
console.log(`ok   exif strip: ${exif.replace(/\n/g, ' | ').slice(0, 120)}`)

await page.locator('.filter').nth(1).click()
await page.waitForTimeout(400)
check('picked filter narrows the grid', await page.locator('.cell').count(), 2)

await page.locator('.btn-primary').click()
await page.waitForTimeout(1500)
const written = await page.evaluate(() => window.__written)
check('export writes both files', written.length, 2)
check('exported files have bytes', written.every((w) => w.size > 0), true)

if (SHOTS) {
  await page.locator('.filter').nth(0).click()
  await page.waitForTimeout(5200) // let the copy toast dismiss itself
  await page.screenshot({ path: 'docs/screenshot.png' })
  console.log('ok   wrote docs/screenshot.png')
}

await browser.close()
console.log(failures.length ? `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
