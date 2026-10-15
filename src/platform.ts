/** 键盘习惯：苹果一套符号，其余按 Windows（Ctrl / Alt）。Linux、ChromeOS 同 Windows。 */
export type OsFamily = 'mac' | 'windows'

type NavigatorUA = Navigator & {
  userAgentData?: { platform?: string }
}

export function detectOsFamily(): OsFamily {
  if (typeof navigator === 'undefined') return 'windows'
  const nav = navigator as NavigatorUA
  const uaPlatform = nav.userAgentData?.platform
  if (uaPlatform) {
    if (/mac|iphone|ipad|ipod/i.test(uaPlatform)) return 'mac'
    return 'windows'
  }
  const blob = `${nav.platform || ''} ${nav.userAgent || ''}`
  if (/Mac|iPhone|iPad|iPod/.test(blob)) return 'mac'
  return 'windows'
}
