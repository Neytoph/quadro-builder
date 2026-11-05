import { test, expect } from '@playwright/test'

// 隔离画布使用真实场景、拾取和编辑记录，不读写账户模型。
for (const width of [1280, 390]) {
  test(`空画布直接选方向建第一根管，支持撤销重做 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await page.evaluate(async () => {
      const [{ SceneManager }, { BuildModel }, { Builder }, { loadCatalog },
        { ModelHistory }, { docFromJSON }] = await Promise.all([
        import('/src/engine/scene.js'), import('/src/engine/model.js'),
        import('/src/engine/builder.js'), import('/src/engine/catalog.js'),
        import('/src/collab/history.ts'), import('/src/collab/ymodel.ts'),
      ])
      await loadCatalog()
      document.getElementById('root')!.style.display = 'none'
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;inset:0;'
      document.body.append(host)
      const scene = new SceneManager(host)
      scene.setCameraPose({ pos: [140, 120, 180], target: [0, 0, 0], zoom: 1 })
      const model = new BuildModel()
      const builder = new Builder(scene, model)
      builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
      builder.mode = 'add'
      builder.tubeId = 'T35'
      builder.refresh()
      ;(window as any).emptyGuideTest = { scene, model, builder }
    })
    for (const tubeId of ['T35', 'TC1']) {
      const initial = await page.evaluate(async (id) => {
        const { scene, model, builder } = (window as any).emptyGuideTest
        builder.tubeId = id
        builder.refresh()
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
        const handles = scene.handleGroup.children.filter((g: any) => g.userData.arrowRoot)
        scene.camera.updateMatrixWorld()
        const p = scene.camera.position.clone().set(12, 0, 0).project(scene.camera)
        const rect = scene.renderer.domElement.getBoundingClientRect()
        return {
          empty: model.isEmpty(), names: handles.map((g: any) => g.userData.dirName).sort(),
          blueDots: scene.handleMeshes.filter((m: any) => m.material.color?.getHex() === 0x1a8cff).length,
          guides: scene._guideAt.get('0,0,0').userData.arms.length,
          x: rect.left + (p.x + 1) * rect.width / 2,
          y: rect.top + (1 - p.y) * rect.height / 2,
        }
      }, tubeId)
      expect(initial.empty).toBe(true)
      expect(initial.names).toEqual(['+X', '+Y', '+Z', '-X', '-Z'])
      expect(initial.blueDots).toBe(0)
      expect(initial.guides).toBe(5)
      await page.screenshot({ path: `.work/empty-guides-${width}-${tubeId}.png` })
      await page.mouse.click(initial.x, initial.y)
      const placed = await page.evaluate(() => {
        const { model } = (window as any).emptyGuideTest
        return { tubes: model.tubes.size, nodes: model.nodes.size,
          underground: [...model.nodes.values()].some((n: any) => n.y < 0),
          tubeId: [...model.tubes.values()][0]?.type }
      })
      expect(placed.tubes).toBe(1)
      expect(placed.nodes).toBe(2)
      expect(placed.underground).toBe(false)
      await page.evaluate(() => (window as any).emptyGuideTest.builder.undo())
      expect(await page.evaluate(() => (window as any).emptyGuideTest.model.isEmpty())).toBe(true)
      await page.evaluate(() => (window as any).emptyGuideTest.builder.redo())
      expect(await page.evaluate(() => (window as any).emptyGuideTest.model.tubes.size)).toBe(1)
      await page.evaluate(() => (window as any).emptyGuideTest.builder.undo())
    }
  })
}
