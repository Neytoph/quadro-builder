// 构建清单的边界夹具；正式构建与实际浏览器加载另行验收。
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { startupResources } from '../../scripts/startupResources'

describe('公共启动清单', () => {
  it('只遍历静态依赖，不将导出、全部模型或个人接口加入预取', () => {
    const chunk = (fileName: string, imports: string[], extra = {}) => ({ type: 'chunk', fileName, imports, ...extra })
    const bundle = {
      'assets/main.js': chunk('assets/main.js', ['assets/three.js'], { isEntry: true, facadeModuleId: '/project/index.html', dynamicImports: ['assets/manual.js'], viteMetadata: { importedCss: new Set(['assets/main.css']) } }),
      'assets/three.js': chunk('assets/three.js', []),
      'assets/manual.js': chunk('assets/manual.js', []),
      'public-resource-manifest.json': { type: 'asset', source: JSON.stringify({ engineVersion: 'version', resources: Object.fromEntries(['connectors','fittings','surfaces'].map(name => [`data/models/${name}.json`, { url: `resources/${'a'.repeat(64)}/data/models/${name}.json` }])) }) },
    }
    let emitted: { fileName: string; source: string } | undefined
    const generate = startupResources().generateBundle as Function
    generate.call({ emitFile: (file: typeof emitted) => { emitted = file } }, {}, bundle)
    expect(emitted?.fileName).toBe('startup-resources.json')
    const manifest = JSON.parse(emitted!.source)
    expect(manifest.modules).toEqual(['assets/main.js', 'assets/three.js'])
    expect(manifest.styles).toEqual(['assets/main.css'])
    expect(manifest.meshes).toHaveLength(3)
    expect(emitted!.source).not.toMatch(/quadro\/|manual\.js|qdf\//)
  })
  it('缺少正式入口时停止构建，不发出空清单', () => {
    const generate = startupResources().generateBundle as Function
    expect(() => generate.call({ emitFile() { throw new Error('Unexpected output') } }, {}, {})).toThrow('Builder startup entry missing')
  })
})
