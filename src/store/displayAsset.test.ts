import { describe, expect, it } from 'vitest'
import { BoxGeometry, BufferAttribute, CubeUVReflectionMapping, Group, InstancedMesh, Mesh, MeshPhysicalMaterial, ObjectLoader, Texture } from 'three'
import { displayObject, usesDisplayEnvironment } from './displayAsset'

describe('只读分享几何', () => {
  it('共享几何只序列化一次，保留实例、顶点颜色和变换，不修改原件', async () => {
    const group = new Group(), geometry = new BoxGeometry()
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(.5), 3))
    geometry.userData = { part: 'private-part' }
    const material = new MeshPhysicalMaterial({ vertexColors: true })
    const first = new Mesh(geometry, material), second = new Mesh(geometry, material)
    first.userData = { id: 'private-node' };first.name = 'private-name'
    second.position.set(10,20,30)
    const instances = new InstancedMesh(geometry,material,2)
    group.add(first,second,instances)
    const encoded = displayObject(group)
    expect(encoded).toHaveProperty('geometries.length',1)
    expect(encoded).toHaveProperty('materials.length',1)
    expect(JSON.stringify(encoded)).not.toContain('private-')
    const loaded = await new ObjectLoader().parseAsync(encoded)
    expect(loaded.children[1].position.toArray()).toEqual([10,20,30])
    expect((loaded.children[0] as Mesh).geometry.attributes.color.array).toEqual(geometry.attributes.color.array)
    expect((loaded.children[2] as InstancedMesh).count).toBe(2)
    expect(first.geometry).toBe(geometry)
    expect(first.userData.id).toBe('private-node')
    expect(geometry.userData.part).toBe('private-part')
  })

  it('GPU 环境贴图不进入分享文件，原材质保持，旧数据可识别并重建', async () => {
    const texture = new Texture();texture.mapping = CubeUVReflectionMapping
    const material = new MeshPhysicalMaterial({ envMap: texture, envMapIntensity: .3 })
    material.userData = { confirmedEnvironment: 'room', privateId: 'private-material' }
    const group = new Group();group.add(new Mesh(new BoxGeometry(),material))
    const encoded = displayObject(group)
    expect(encoded).not.toHaveProperty('textures')
    expect(encoded).not.toHaveProperty('images')
    expect(JSON.stringify(encoded)).not.toContain('private-material')
    const loaded = await new ObjectLoader().parseAsync(encoded)
    const restored = (loaded.children[0] as Mesh).material as MeshPhysicalMaterial
    expect(restored.envMap).toBeNull()
    expect(usesDisplayEnvironment(restored)).toBe(true)
    expect(restored.envMapIntensity).toBe(.3)
    expect(material.envMap).toBe(texture)
    expect(material.userData.privateId).toBe('private-material')
    expect(usesDisplayEnvironment(new MeshPhysicalMaterial({envMap:texture}))).toBe(true)
  })
})
