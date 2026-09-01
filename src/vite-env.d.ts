/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * 后端同步的前缀，例如 '/api'。
   * 只有托管版构建时才设；开源本地版不设，同步整个不启动。
   */
  readonly VITE_SYNC_BASE?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
