/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * 后端同步的前缀，例如 '/api'。
   * 只有托管版构建时才设；开源本地版不设，同步整个不启动。
   */
  readonly VITE_SYNC_BASE?: string
  /**
   * 托管版的发帖页地址，例如 '/write.html'。设了才会在「我的设计」里
   * 出现「发到社区」，而且还要后端说这个人看得见社区。
   * 开源本地版不设——它没有社区可发。
   */
  readonly VITE_COMMUNITY_WRITE?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
