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
  thumbOffset: 0x0201,
  thumbLength: 0x0202,
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

/** Fills `out` with this IFD's tags and returns the offset of the next IFD,
 *  relative to the TIFF header, or 0 when this is the last one. */
function readIfd(view: DataView, tiff: number, ifd: number, le: boolean, out: Raw): number {
  if (ifd + 2 > view.byteLength) return 0
  const count = view.getUint16(ifd, le)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > view.byteLength) return 0
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
  const after = ifd + 2 + count * 12
  return after + 4 <= view.byteLength ? view.getUint32(after, le) : 0
}

interface Tiff {
  view: DataView
  /** Byte offset of the TIFF header. Every IFD offset is relative to it. */
  tiff: number
  le: boolean
}

/** Locates the APP1 Exif segment and the TIFF header inside it. */
function locateTiff(view: DataView): Tiff | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null

  let p = 2
  while (p + 4 <= view.byteLength) {
    if (view.getUint8(p) !== 0xff) break
    const marker = view.getUint16(p)
    if (marker === 0xffda) break
    const length = view.getUint16(p + 2)
    if (marker === 0xffe1 && view.getUint32(p + 4) === 0x45786966) {
      const tiff = p + 10
      if (tiff + 8 > view.byteLength) break
      return { view, tiff, le: view.getUint16(tiff) === 0x4949 }
    }
    p += 2 + length
  }
  return null
}

const firstIfd = ({ view, tiff, le }: Tiff) => tiff + view.getUint32(tiff + 4, le)

/** Walks IFD0 plus the Exif sub-IFD. */
function parse(buffer: ArrayBuffer): Raw {
  const raw: Raw = new Map()
  const head = locateTiff(new DataView(buffer))
  if (!head) return raw
  const { view, tiff, le } = head

  readIfd(view, tiff, firstIfd(head), le, raw)
  const sub = raw.get(TAG.exifIfd)
  if (typeof sub === 'number') readIfd(view, tiff, tiff + sub, le, raw)
  return raw
}

export interface EmbeddedThumbnail {
  /** JPEG bytes exactly as the camera wrote them. */
  bytes: Uint8Array<ArrayBuffer>
  /** From IFD0. The thumbnail carries no Exif of its own, so it is stored
   *  unrotated and this tag is the only thing that says which way is up. */
  orientation: number
}

/** Pulls the camera's own thumbnail out of IFD1. It is usually 160x120 and
 *  already encoded, so it decodes in about a millisecond against a hundred or
 *  more for the full frame. Returns null for files that do not carry one. */
export function embeddedThumbnail(buffer: ArrayBuffer): EmbeddedThumbnail | null {
  const head = locateTiff(new DataView(buffer))
  if (!head) return null
  const { view, tiff, le } = head

  const ifd0: Raw = new Map()
  const next = readIfd(view, tiff, firstIfd(head), le, ifd0)
  if (!next) return null

  const ifd1: Raw = new Map()
  readIfd(view, tiff, tiff + next, le, ifd1)
  const at = ifd1.get(TAG.thumbOffset)
  const length = ifd1.get(TAG.thumbLength)
  if (typeof at !== 'number' || typeof length !== 'number' || length < 4) return null

  const start = tiff + at
  if (start + length > view.byteLength) return null
  const bytes = new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset + start, length)
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  const orientation = ifd0.get(TAG.orientation)
  return { bytes, orientation: typeof orientation === 'number' ? orientation : 1 }
}

const ratio = (v: unknown) => (Array.isArray(v) && v[1] ? v[0] / v[1] : undefined)
const trim = (n: number) => String(Number(n.toFixed(1)))

/** An Exif date is local time with no zone: "2024:03:11 18:02:57". */
function toEpoch(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const m = value.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return undefined
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).getTime()
}

function formatDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const at = toEpoch(value)
  if (at === undefined) return value
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** The capture time on its own, for ordering the list. Undefined for a photo
 *  that carries no date, which the caller has to stand in for. */
export async function readTakenAt(file: File): Promise<number | undefined> {
  try {
    const raw = parse(await file.slice(0, 256 * 1024).arrayBuffer())
    return toEpoch(raw.get(TAG.dateTimeOriginal))
  } catch {
    return undefined
  }
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
