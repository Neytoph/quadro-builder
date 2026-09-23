import { useEffect } from 'react'
import { useEngine } from '../store/EngineContext'
import { parseOfficialId } from '../data/official'
import { useDock } from './dock'
import { canvasCorner, usePanelLayout } from './panelLayout'

export default function CanvasHost() {
  const { hostRef, ready, error, openLibraryId, setViewCubePad } = useEngine()
  const { left, right, vw } = usePanelLayout()
  const { pane } = useDock()

  useEffect(() => {
    if (!ready) return
    const pad = canvasCorner(left, vw, { right, dockOpen: !!pane })
    setViewCubePad(pad.cubePadRight, pad.cubePadBottom, pad.cubeSize)
  }, [ready, left, right, vw, pane, setViewCubePad])
  const onDragOver = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes('text/plain')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    e.currentTarget.classList.add('ring-2', 'ring-inset', 'ring-teal-400/80')
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('ring-2', 'ring-inset', 'ring-teal-400/80')
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.currentTarget.classList.remove('ring-2', 'ring-inset', 'ring-teal-400/80')
    const raw = e.dataTransfer.getData('text/plain').trim()
    const id = parseOfficialId(raw) || (raw.startsWith('lib:') ? raw : null)
    if (!id) return
    void openLibraryId(id)
  }

  return (
    <div
      className="flex-1 relative min-w-0 min-h-0"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div id="canvas-host" ref={hostRef} className="m-canvas absolute inset-0" data-ready={ready} tabIndex={0} />
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-red-300 text-sm px-6 text-center">{error}</div>
      )}
    </div>
  )
}
