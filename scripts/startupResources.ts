import type { Plugin } from 'vite'

/** 清单只包含当前入口的静态依赖及常用基础网格，不预取个人造型。 */
export function startupResources(): Plugin {
  return {
    name: 'builder-startup-resources',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(file => file.type === 'chunk' && file.isEntry && (file.facadeModuleId?.endsWith('/index.html') || file.facadeModuleId?.endsWith('/src/main.tsx')))
      if (!entry || entry.type !== 'chunk') throw new Error('Builder startup entry missing')
      const modules = new Set<string>(), styles = new Set<string>()
      const visit = (name: string) => {
        if (modules.has(name)) return
        const file = bundle[name]
        if (!file || file.type !== 'chunk') throw new Error(`Builder startup dependency missing: ${name}`)
        modules.add(name)
        for (const dependency of file.imports) visit(dependency)
        const metadata = (file as typeof file & { viteMetadata?: { importedCss: Set<string> } }).viteMetadata
        for (const css of metadata?.importedCss || []) styles.add(css)
      }
      visit(entry.fileName)
      const asset = bundle['public-resource-manifest.json']
      if (!asset || asset.type !== 'asset') throw new Error('Public resource manifest missing')
      const manifest = JSON.parse(String(asset.source)) as { engineVersion: string; resources: Record<string, { url: string }> }
      const meshes = ['connectors', 'fittings', 'surfaces'].map(name => manifest.resources[`data/models/${name}.json`]?.url)
      if (meshes.some(url => !url)) throw new Error('Builder startup mesh missing')
      this.emitFile({ type: 'asset', fileName: 'startup-resources.json', source: JSON.stringify({
        schemaVersion: 1, engineVersion: manifest.engineVersion,
        modules: [...modules], styles: [...styles], meshes,
      }) })
    },
  }
}
