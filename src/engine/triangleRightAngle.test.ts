import { describe, it, expect, beforeAll } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { BuildModel } from './model.js'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { resolveNodeConnection, connectorsForNode, infeasibleConnectors } from './bom.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'

beforeAll(async () => { await loadCatalog() })
// 隔离夹具复用用户原模型 n213 的三个真实坐标，不包含其账户或其他造型。
function corner(points: number[][]) {
  const model = new BuildModel()
  const [joint, ...ends] = points.map(p => model.addNode(...p))
  for (const end of ends) model.addTube(joint.id, end.id, 'T35', 'green', 35)
  return { model, joint }
}

const cases = [
  { name: '整体倾斜后的三角形', points: [[20, 250.93, -16.49], [-8.28, 230.92, -36.48], [48.28, 230.92, -36.48]] },
  { name: '水平 45° 三角形', points: [[0, 40, 0], [28.28, 40, 28.28], [-28.28, 40, 28.28]] },
  { name: 'XY 平面 45° 三角形', points: [[0, 80, 0], [28.28, 51.72, 0], [-28.28, 51.72, 0]] },
  { name: 'YZ 平面 45° 三角形', points: [[0, 80, 0], [0, 51.72, 28.28], [0, 51.72, -28.28]] },
]

function expectAligned(model: BuildModel, joint: ReturnType<BuildModel['addNode']>) {
  const connection = resolveNodeConnection(model, joint)
  expect(connection.type).toBe('elbow')
  expect(connection.diagnostics).toEqual([])
  expect(connectorsForNode(model, joint)).toEqual(['elbow'])
  expect(infeasibleConnectors(model).has(joint.id)).toBe(false)
  const axes = connection.frame!.map((d: number[]) => new Vector3(...d))
  const matrix = new Matrix4().makeBasis(axes[0], axes[1], axes[2])
  expect(matrix.determinant()).toBeCloseTo(1, 5)
  const inverse = new Quaternion().setFromRotationMatrix(matrix).invert()
  // 使用渲染器同样的 Quaternion 转换，实际两根管必须落在两个不同端口上。
  const local = connection.worldDirs.map((d: number[]) => new Vector3(...d).applyQuaternion(inverse))
  for (const d of local) expect(Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z))).toBeGreaterThan(0.999)
  expect(Math.abs(local[0].dot(local[1]))).toBeLessThan(0.001)
}

describe('三角形直角接头', () => {
  for (const example of cases) {
    it(`${example.name}保持两通直角件，朝向与管端一致`, () => {
      const { model, joint } = corner(example.points)
      expectAligned(model, joint)
      const saved = model.toJSON()
      const reopened = new BuildModel()
      expect(reopened.loadJSON(saved).ok).toBe(true)
      expectAligned(reopened, reopened.nodes.get(joint.id)!)
      expect(model.toJSON()).toEqual(saved)
    })
  }

  it('水平和倾斜直角件导出 QDF 再导入保持真实端口', () => {
    for (const example of cases.slice(0, 2)) {
      const { model, joint } = corner(example.points)
      const opened = new BuildModel()
      expect(opened.loadJSON(parseQDF(buildQDF(model).text, {
        tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2,
      })).ok).toBe(true)
      const importedJoint = [...opened.nodes.values()].find(n => Math.hypot(n.x - joint.x, n.y - joint.y, n.z - joint.z) < 0.1)!
      const connection = resolveNodeConnection(opened, importedJoint)
      expect(connection.type).toBe('elbow')
      expect(connection.diagnostics).toEqual([])
      expect(importedJoint.arms).toHaveLength(2)
    }
  })

  it('同一倾斜直角件上的第三根不正交管仍被拦截', () => {
    const { model, joint } = corner(cases[0].points)
    const other = model.addNode(20, 230.93, -16.49)
    model.addTube(joint.id, other.id, 'T15', 'red', 15)
    expect(resolveNodeConnection(model, joint).canExport).toBe(false)
    expect(infeasibleConnectors(model).has(joint.id)).toBe(true)
  })

  it('水平 45° 锐角连接仍要求转接头', () => {
    const { model, joint } = corner([[0, 40, 0], [40, 40, 0], [28.28, 40, 28.28]])
    expect(resolveNodeConnection(model, joint).diagnostics.map((d: { code: string }) => d.code)).toContain('MISSING_C45_ADAPTER')
  })
})
