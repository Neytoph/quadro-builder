import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useI18n } from '../i18n'

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
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-950 text-gray-200 p-6">
        <div className="max-w-md text-center space-y-3">
          <div className="text-lg font-semibold">{this.props.t('error.title')}</div>
          <p className="text-sm text-red-300 break-words">{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()}
            className="text-sm rounded-lg bg-teal-500 hover:bg-teal-400 text-gray-950 font-semibold px-4 py-2 cursor-pointer">
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
