/// <reference lib="webworker" />

interface Req { id: string; file: File; size: number }

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, file, size } = e.data
  try {
    // `from-image` honours EXIF rotation, so phone and camera shots sit upright.
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
      resizeWidth: size,
      resizeQuality: 'high',
    })
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
    ;(self as unknown as Worker).postMessage({ id, blob })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
