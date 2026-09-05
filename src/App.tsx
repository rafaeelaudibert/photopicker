import { useCallback, useEffect, useState } from 'react'
import { ensureReadPermission, pickSourceFolder, scanFolder, supportsFileSystemAccess } from './fs'
import { clearHandle, loadHandle, saveHandle } from './idb'
import type { PhotoItem } from './types'

export default function App() {
  const [folderName, setFolderName] = useState('')
  const [items, setItems] = useState<PhotoItem[]>([])
  const [scanning, setScanning] = useState<number | null>(null)
  const [resumable, setResumable] = useState<FileSystemDirectoryHandle | null>(null)
  const supported = supportsFileSystemAccess()

  useEffect(() => {
    loadHandle().then((h) => h && setResumable(h)).catch(() => {})
  }, [])

  const openFolder = useCallback(async (handle: FileSystemDirectoryHandle) => {
    if (!(await ensureReadPermission(handle))) return
    setScanning(0)
    setResumable(null)
    try {
      const found = await scanFolder(handle, setScanning)
      setItems(found)
      setFolderName(handle.name)
      await saveHandle(handle).catch(() => {})
    } finally {
      setScanning(null)
    }
  }, [])

  const chooseFolder = useCallback(async () => {
    try {
      await openFolder(await pickSourceFolder())
    } catch {
      /* the picker was dismissed */
    }
  }, [openFolder])

  if (!supported) {
    return (
      <div className="app">
        <div className="center">
          <div className="intro">
            <h1>Open this in Chrome</h1>
            <p>
              Photopicker writes your selects straight into a folder on this Mac using the File
              System Access API. Safari and Firefox do not support it yet.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="app">
        <div className="center">
          <div className="intro">
            <h1>Photopicker</h1>
            <p>
              Open a folder of photos, mark the ones worth printing, and copy them out. Everything
              stays on this Mac. No uploads, no network.
            </p>
            <div className="intro-actions">
              <button type="button" className="btn btn-primary" onClick={chooseFolder}>
                {scanning === null ? 'Open folder' : `Reading ${scanning} photos`}
              </button>
              {resumable && scanning === null && (
                <button type="button" className="btn" onClick={() => openFolder(resumable)}>
                  Resume {resumable.name}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="center">
        <div className="intro">
          <h1>{folderName}</h1>
          <p>{items.length} photos ready to sort through.</p>
          <div className="intro-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                clearHandle().catch(() => {})
                chooseFolder()
              }}
            >
              Open a different folder
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
