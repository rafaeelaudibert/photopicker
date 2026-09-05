/** Minimal EXIF reader. Only the fields a person culling photos actually wants,
 *  parsed locally with no dependency and no network. */

const TAG = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  exifIfd: 0x8769,
  exposureTime: 0x829a,
  fNumber: 0x829d,
  iso: 0x8827,
  dateTimeOriginal: 0x9003,
  exposureBias: 0x9204,
  focalLength: 0x920a,
  lensModel: 0xa434,
} as const

export const FIELDS = [
  { id: 'camera', label: 'Camera' },
  { id: 'lens', label: 'Lens' },
  { id: 'date', label: 'Taken' },
  { id: 'shutter', label: 'Shutter' },
  { id: 'aperture', label: 'Aperture' },
  { id: 'iso', label: 'ISO' },
  { id: 'focal', label: 'Focal length' },
  { id: 'ev', label: 'Exposure' },
  { id: 'dimensions', label: 'Dimensions' },
  { id: 'size', label: 'File size' },
  { id: 'path', label: 'Path' },
] as const

export type FieldId = (typeof FIELDS)[number]['id']
export const DEFAULT_FIELDS: FieldId[] = ['camera', 'lens', 'date', 'shutter', 'aperture', 'iso', 'dimensions', 'path']

type Raw = Map<number, number | number[] | string>

function readIfd(view: DataView, tiff: number, ifd: number, le: boolean, out: Raw) {
  const count = view.getUint16(ifd, le)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > view.byteLength) return
    const tag = view.getUint16(entry, le)
    const type = view.getUint16(entry + 2, le)
    const num = view.getUint32(entry + 4, le)
    const width = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8][type] ?? 0
    if (!width) continue
    const bytes = width * num
    const at = bytes <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, le)
    if (at + bytes > view.byteLength) continue

    if (type === 2) {
      let s = ''
      for (let c = 0; c < num; c++) {
        const code = view.getUint8(at + c)
        if (!code) break
        s += String.fromCharCode(code)
      }
      out.set(tag, s.trim())
    } else if (type === 3) {
      out.set(tag, view.getUint16(at, le))
    } else if (type === 4) {
      out.set(tag, view.getUint32(at, le))
    } else if (type === 5) {
      out.set(tag, [view.getUint32(at, le), view.getUint32(at + 4, le)])
    } else if (type === 10) {
      out.set(tag, [view.getInt32(at, le), view.getInt32(at + 4, le)])
    }
  }
}

/** Locates the APP1 Exif segment and walks IFD0 plus the Exif sub-IFD. */
function parse(buffer: ArrayBuffer): Raw {
  const view = new DataView(buffer)
  const raw: Raw = new Map()
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return raw

  let p = 2
  while (p + 4 <= view.byteLength) {
    if (view.getUint8(p) !== 0xff) break
    const marker = view.getUint16(p)
    if (marker === 0xffda) break
    const length = view.getUint16(p + 2)
    if (marker === 0xffe1 && view.getUint32(p + 4) === 0x45786966) {
      const tiff = p + 10
      if (tiff + 8 > view.byteLength) break
      const le = view.getUint16(tiff) === 0x4949
      readIfd(view, tiff, tiff + view.getUint32(tiff + 4, le), le, raw)
      const sub = raw.get(TAG.exifIfd)
      if (typeof sub === 'number') readIfd(view, tiff, tiff + sub, le, raw)
      break
    }
    p += 2 + length
  }
  return raw
}

const ratio = (v: unknown) => (Array.isArray(v) && v[1] ? v[0] / v[1] : undefined)
const trim = (n: number) => String(Number(n.toFixed(1)))

function formatDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const m = value.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/)
  if (!m) return value
  const date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  return date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Reads the head of the file only. Exif always sits near the start of a JPEG. */
export async function readExif(file: File): Promise<Partial<Record<FieldId, string>>> {
  let raw: Raw
  try {
    raw = parse(await file.slice(0, 256 * 1024).arrayBuffer())
  } catch {
    return {}
  }

  const out: Partial<Record<FieldId, string>> = {}
  const make = raw.get(TAG.make)
  const model = raw.get(TAG.model)
  if (typeof model === 'string' && model) {
    const brand = typeof make === 'string' ? make.split(' ')[0] : ''
    out.camera = brand && !model.toUpperCase().startsWith(brand.toUpperCase()) ? `${brand} ${model}` : model
  }

  const lens = raw.get(TAG.lensModel)
  if (typeof lens === 'string' && lens) out.lens = lens

  out.date = formatDate(raw.get(TAG.dateTimeOriginal))

  const shutter = ratio(raw.get(TAG.exposureTime))
  if (shutter !== undefined) out.shutter = shutter >= 1 ? `${trim(shutter)}s` : `1/${Math.round(1 / shutter)}s`

  const aperture = ratio(raw.get(TAG.fNumber))
  if (aperture !== undefined) out.aperture = `f/${trim(aperture)}`

  const iso = raw.get(TAG.iso)
  if (typeof iso === 'number') out.iso = String(iso)

  const focal = ratio(raw.get(TAG.focalLength))
  if (focal !== undefined) out.focal = `${Math.round(focal)}mm`

  const ev = ratio(raw.get(TAG.exposureBias))
  if (ev !== undefined) out.ev = `${ev > 0 ? '+' : ''}${trim(ev)} EV`

  for (const key of Object.keys(out) as FieldId[]) if (!out[key]) delete out[key]
  return out
}
