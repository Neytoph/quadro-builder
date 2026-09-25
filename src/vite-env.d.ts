/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * 后端同步的前缀，例如 '/api'。
   * 只有托管版构建时才设；开源本地版不设，同步整个不启动。
   */
  readonly VITE_SYNC_BASE?: string
  /**
   * 托管版每种界面语言的发帖页地址，写成 JSON，例如
   * '{"zh":"/write.html","en":"/en/write.html","de":"/de/write.html"}'。
   * 设了才会在「我的设计」里出现「发到社区」，而且还要后端说这个人看得见社区。
   * 开源本地版不设——它没有社区可发。
   */
  readonly VITE_COMMUNITY_WRITE?: string
  /**
   * 托管版的方案页接口，例如 '/quadro/shares'。设了之后，导出安装手册、料表、
   * 分享图时先把这一座存成一个方案页，文件的每一页角上印它的网址和二维码。
   * 契约见 src/sharePage.ts。开源本地版不设，导出的文件不带网址。
   */
  readonly VITE_SHARE_API?: string
  /**
   * 托管版的注册页，例如 '/register'。设了之后，导出文件和保存到账号要先有账号：
   * 没登录的人点导出，先去这个地址注册，带着 ?next= 回到 Builder 接着导出。
   * 开源本地版不设，导出不拦。
   */
  readonly VITE_REGISTER_URL?: string
  /**
   * 托管版的登录页，例如 '/login'。共享方案的邀请链接没登录时先去这里，
   * 带着 ?next= 回到 Builder 接着加入。开源本地版不设（也就没有共享方案）。
   */
  readonly VITE_LOGIN_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
