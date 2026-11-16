import { beforeAll, expect, it } from 'vitest'
import * as Y from 'yjs'
import { loadCatalog } from '../engine/catalog.js'
import { BuildModel } from '../engine/model.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON, docToJSON, type ModelJSON } from '../collab/ymodel'
import { sameModel } from '../collab/planSession'
import { homeForTab, localRoomOnly, sharedRoomSnapshot } from './collaboration'
import { placeInRoom } from './context.js'
import { createHomeEnvironment, disposeHome } from './environment.js'

beforeAll(() => loadCatalog())

it('共享房间覆盖旧本地背景，完整摆放与朝向跨端和撤销重做保持一致', () => {
  const model = new BuildModel(); model.addNode(40, 0, 80)
  model.homeContext = placeInRoom({ id: null, rev: 0, name: '客厅', data: { mode: 'furniture', room: { w: 450, d: 350, h: 260 }, items: [] } }, model.bounds(2.5))
  model.previewBackground = 'home'
  const initial = model.toJSON() as ModelJSON
  const doc = docFromJSON(initial), history = new ModelHistory(doc), peer = new Y.Doc()
  const oldHome = structuredClone(model.homeContext)
  model.homeContext.placement.position = [130, 0, 210]
  model.homeContext.placement.rotation = 90
  history.commit(JSON.stringify(initial), JSON.stringify(model.toJSON()))
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
  const other = new BuildModel(); expect(other.loadJSON(docToJSON(peer)).ok).toBe(true)
  const tab = { planId: 'shared', view: { homeContext: oldHome } }
  expect(homeForTab(tab, other.homeContext)).toEqual(model.homeContext)
  const a = createHomeEnvironment(model.homeContext), b = createHomeEnvironment(other.homeContext)
  expect(a.matrix.toArray()).toEqual(b.matrix.toArray())
  expect(sameModel(initial, docToJSON(peer))).toBe(false)
  expect(localRoomOnly('shared', false)).toBe(false)
  expect(localRoomOnly('shared', true)).toBe(true)
  expect(localRoomOnly(undefined, false)).toBe(false)
  expect(homeForTab(tab, null)).toEqual(oldHome)
  expect(homeForTab({ ...tab, readOnly: true }, other.homeContext)).toEqual(oldHome)
  expect(homeForTab({ ...tab, readOnly: true, view: { homeContext: null } }, other.homeContext)).toBeNull()
  const privateContext = { ...model.homeContext, roomId: 'private-room', roomRev: 3 }
  const shared = sharedRoomSnapshot(privateContext)!
  expect(shared.roomId).toBeNull(); expect(shared.roomRev).toBe(0)
  expect(shared.placement).toEqual(privateContext.placement)
  expect(privateContext.roomId).toBe('private-room')
  history.undo(); expect(history.toJSON().homeContext).toEqual(oldHome)
  history.redo(); expect(history.toJSON().homeContext).toEqual(model.homeContext)
  disposeHome(a); disposeHome(b); history.destroy(); doc.destroy(); peer.destroy()
})
