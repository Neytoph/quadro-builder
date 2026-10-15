import { expect, test } from '@playwright/test'

test('弯管两端只显示可接管的空插口，地面接头可向上弯曲', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/')
  const actual = await page.evaluate(async () => {
    const [{ SceneManager }, { BuildModel }, { Builder }, { loadCatalog }] = await Promise.all([
      import('/src/engine/scene.js'), import('/src/engine/model.js'),
      import('/src/engine/builder.js'), import('/src/engine/catalog.js'),
    ])
    await loadCatalog()
    const host = document.createElement('div')
    host.style.width = '800px'
    host.style.height = '600px'
    document.body.append(host)
    const scene = new SceneManager(host)
    const model = new BuildModel()
    const quat = [0.227902967, 0, 0, 0.973683849]
    const node = (x: number, y: number, z: number) => {
      const result = model.addNode(x, y, z)
      result.quat = quat
      return result
    }
    const upper = node(40, 55.89, 58.07)
    const lower = node(40, 2.28, 76.17)
    const far = node(40, 73.64, 22.23)
    const middle = node(40, 20.03, 40.32)
    const right = node(80, 2.28, 76.17)
    model.addTube(far.id, upper.id, 'T35', 'yellow', 35)
    model.addTube(upper.id, middle.id, 'T35', 'green', 35)
    model.addTube(middle.id, lower.id, 'T35', 'yellow', 35)
    model.addTube(lower.id, right.id, 'T35', 'green', 35)
    const bow = model.addTube(lower.id, upper.id, 'TC1', 'red', null)!
    bow.bow = true
    bow.bowCenter = [40, 20.04, 40.34]
    const builder = new Builder(scene, model)
    builder.mode = 'add'
    const handles = (tubeId: string) => {
      builder.tubeId = tubeId
      builder._buildHandles()
      return [upper, lower].map((n) => {
        const found = scene.handleGroup.children.filter((group) =>
          group.userData.arrowRoot && group.userData.nodeId === n.id)
        const key = [n.x, n.y, n.z].map((value) => Math.round(value * 10)).join(',')
        return { names: found.map((group) => group.userData.dirName).sort(),
          guideCount: scene._guideAt.get(key)?.userData.arms.length || 0 }
      })
    }
    const curved = handles('TC1')
    const straight = handles('T35')
    const occupied = {
      upperBow: model.canExtendFrom(upper, builder._armDirsOf(upper).find((d) => d.name === '+Z')!.vec),
      lowerBow: model.canExtendFrom(lower, builder._armDirsOf(lower).find((d) => d.name === '+Y')!.vec),
    }
    builder.tubeId = 'TC1'
    const underground = builder._targetBelowGround(lower, [0, -0.896120475, -0.443810876])
    const upwardNormal = builder._bowNormal([-1, 0, 0], lower)
    const made = model.extendBow(lower.id, [-1, 0, 0], upwardNormal, 'TC1', 'red', 40)
    const newEndY = made?.node?.y
    scene.dispose()
    host.remove()
    return { curved, straight, occupied, underground, upwardNormal, newEndY }
  })

  expect(actual.curved).toEqual([
    { names: ['+X', '+Y', '-X'], guideCount: 3 },
    { names: ['-X'], guideCount: 1 },
  ])
  expect(actual.straight).toEqual(actual.curved)
  expect(actual.occupied).toEqual({ upperBow: false, lowerBow: false })
  expect(actual.underground).toBe(true)
  expect(Math.abs(actual.upwardNormal[0])).toBe(0)
  expect(actual.upwardNormal[1]).toBe(1)
  expect(Math.abs(actual.upwardNormal[2])).toBe(0)
  expect(actual.newEndY).toBeGreaterThan(2.28)
})
