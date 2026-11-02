import {expect,test} from '@playwright/test'

test('管件几何按实际尺寸缓存，近似长度和半径不受渲染顺序影响',async({page})=>{
  await page.goto('/')
  const rows=await page.evaluate(async()=>{
    const {SceneManager}=await import('/src/engine/scene.js')
    const host=document.createElement('div');host.style.width='800px';host.style.height='600px';document.body.append(host)
    const scene=new SceneManager(host),rows=[]
    for(const hollow of [false,true])for(const length of [34.997,35.003,35.001,35.003,34.997])for(const radius of [2.447,2.453]){
      const g=scene._tubeGeometry(radius,length,24,hollow);g.computeBoundingBox()
      rows.push({length,radius,hollow,actualLength:g.boundingBox.max.y-g.boundingBox.min.y,actualRadius:g.boundingBox.max.x})
    }
    return rows
  })
  for(const row of rows){expect(row.actualLength).toBeCloseTo(row.length,5);expect(row.actualRadius).toBeCloseTo(row.radius,5)}
})
