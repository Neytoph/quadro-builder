export interface PublicAsset {
  sha256: string
  size: number
  mime: string
}

export interface AssetRelease {
  schemaVersion: 1
  mode: 'public-ipv6-fallback' | 'public-ipv6-off'
  release: string
  base: '/builder/'
  ipv6Origin: string
  previewOnly: boolean
  policy: { fallbackDelayMs: number; ipv6TimeoutMs: number; totalTimeoutMs: number }
  runtimeSha256: string
  assets: Record<string, PublicAsset>
}

export interface AssetBoot {
  protocol: 1
  release: string
  mode: AssetRelease['mode']
  base: '/builder/'
  entry: string
  styles: string[]
  controllerBudgetMs: number
}

export const HELLO = 'XMF_PUBLIC_ASSETS_HELLO'
export const READY = 'XMF_PUBLIC_ASSETS_READY'
