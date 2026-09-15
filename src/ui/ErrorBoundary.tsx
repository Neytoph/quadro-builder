import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { flushNow, track } from '../analytics/track'

// 崩溃打点。只发得出去"在哪个组件崩的"和"错误属于哪一类"，
// 发不出去 error.message——消息里极可能带模型名、文件名、
// 用户自己起的名字，那是用户输入，按 track.ts 第 2 条规矩不能进 props。
// 想看完整堆栈就看浏览器控制台，那儿一个字都没少。
const ERROR_KINDS: Array<[RegExp, string]> = [
  [/WebGL|context lost|THREE/i, 'webgl'],
  [/QuotaExceeded|storage/i, 'storage'],
  [/NetworkError|Failed to fetch|Load failed/i, 'network'],
  [/chunk|dynamically imported module|Importing a module/i, 'chunk'],
  [/undefined is not|null is not|Cannot read/i, 'nullref'],
]

function errorKind(err: Error): string {
  const hay = err.name + ' ' + err.message
  for (const [re, kind] of ERROR_KINDS) if (re.test(hay)) return kind
  return 'other'
}

/** 组件栈第一行就是最内层出错的组件名，取它，别的都不要。 */
function topComponent(stack: string | null | undefined): string {
  const line = (stack || '').trim().split('\n')[0] || ''
  const m = line.match(/^\s*(?:at\s+|in\s+)?([A-Za-z0-9_$]+)/)
  return m ? m[1].slice(0, 40) : 'unknown'
}

type InnerProps = {
  children: ReactNode
  t: (key: string) => string
}

type InnerState = { error: Error | null }

class ErrorBoundaryInner extends Component<InnerProps, InnerState> {
  state: InnerState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    // 崩溃后页面已经是废的，4 秒的批量窗口多半等不到——
    // 立刻冲一次，别让最该看见的这条跟着页面一起没了。
    try {
      track('builder.crash', {
        where: topComponent(info.componentStack),
        kind: errorKind(error),
      })
      flushNow()
    } catch { /* 打点失败也不能盖掉原来的错 */ }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-950 text-gray-200 p-6">
        <div className="max-w-md text-center space-y-3">
          <div className="text-lg font-semibold">{this.props.t('error.title')}</div>
          <p className="text-sm text-red-300 break-words">{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()}
            className="text-sm rounded-lg bg-teal-500 hover:bg-teal-400 text-white font-semibold px-4 py-2 cursor-pointer">
            {this.props.t('error.reload')}
          </button>
        </div>
      </div>
    )
  }
}

export default function ErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return <ErrorBoundaryInner t={t}>{children}</ErrorBoundaryInner>
}
