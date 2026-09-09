/// <reference lib="webworker" />
import { embeddedThumbnail } from './exif'

type Mode = 'quick' | 'full'
interface Req { id: string; file: File; size: number; mode: Mode }

const post = (message: { id: string; mode: Mode; blob?: Blob }) =>
  (self as unknown as Worker).postMessage(message)

/** Applies an Exif orientation by hand. Needed only for the quick pass: the
 *  IFD1 thumbnail is stored unrotated and carries no Exif to rotate it by. */
function orient(bitmap: ImageBitmap, orientation: number): OffscreenCanvas {
  const turned = orientation >= 5 && orientation <= 8
  const width = turned ? bitmap.height : bitmap.width
  const height = turned ? bitmap.width : bitmap.height
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  switch (orientation) {
    case 2: ctx.setTransform(-1, 0, 0, 1, width, 0); break
    case 3: ctx.setTransform(-1, 0, 0, -1, width, height); break
    case 4: ctx.setTransform(1, 0, 0, -1, 0, height); break
    case 5: ctx.setTransform(0, 1, 1, 0, 0, 0); break
    case 6: ctx.setTransform(0, 1, -1, 0, width, 0); break
    case 7: ctx.setTransform(0, -1, -1, 0, width, height); break
    case 8: ctx.setTransform(0, -1, 1, 0, 0, height); break
  }
  ctx.drawImage(bitmap, 0, 0)
  return canvas
}

/** Exif always sits near the start of a JPEG, so the head is all we read. */
async function quick(file: File): Promise<Blob | undefined> {
  const found = embeddedThumbnail(await file.slice(0, 256 * 1024).arrayBuffer())
  if (!found) return undefined
  const bitmap = await createImageBitmap(new Blob([found.bytes], { type: 'image/jpeg' }))
  const canvas = orient(bitmap, found.orientation)
  bitmap.close()
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
}

async function full(file: File, size: number): Promise<Blob> {
  // `from-image` honours EXIF rotation, so phone and camera shots sit upright.
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
    resizeWidth: size,
    resizeQuality: 'high',
  })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, file, size, mode } = e.data
  try {
    post({ id, mode, blob: mode === 'quick' ? await quick(file) : await full(file, size) })
  } catch {
    post({ id, mode })
  }
}
