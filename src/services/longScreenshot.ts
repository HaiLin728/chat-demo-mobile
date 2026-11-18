import { Capacitor, registerPlugin } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type { TranslationKey } from '../i18n/index.js'

/** 原生长图插件：逐屏抓取 WebView 画面并拼成一张 PNG，返回缓存目录里的文件名。 */
type LongScreenshotResult = {
  name: string
  width: number
  height: number
  /** 会话超过单张长图上限时为 true，只包含开头部分。 */
  truncated: boolean
}

interface LongScreenshotPlugin {
  capture(options?: { maxHeight?: number }): Promise<LongScreenshotResult>
}

const LongScreenshot = registerPlugin<LongScreenshotPlugin>('LongScreenshot')

/** 目前只有 Android 侧实现了原生插件。 */
export const canExportLongImage = () => Capacitor.getPlatform() === 'android'

const SCROLL_ROOT_SELECTOR = '[data-scroll-root]'

/** 移动端真正的滚动容器带 data-scroll-root 标记；内容不足一屏时也返回它，由原生提示。 */
const findScroller = (): HTMLElement | null => {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(SCROLL_ROOT_SELECTOR))
  return candidates.find((el) => el.scrollHeight > el.clientHeight + 4) ?? candidates[0] ?? null
}

let savedScroll: { scrollTop: number; behavior: string } | null = null

type LongShotBridge = {
  metrics(): string
  prepare(): void
  scrollTo(y: number): void
  restore(): void
}

declare global {
  interface Window {
    __xiyanLongShot?: LongShotBridge
  }
}

/** 原生截图插件通过 evaluateJavascript 调用这几个方法；网页端不挂载。 */
export const installLongScreenshotBridge = () => {
  if (!Capacitor.isNativePlatform()) {
    return
  }
  window.__xiyanLongShot = {
    metrics: () => {
      const el = findScroller()
      if (!el) {
        return 'null'
      }
      const rect = el.getBoundingClientRect()
      return JSON.stringify({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: el.clientHeight,
        content: el.scrollHeight,
        scrollTop: el.scrollTop,
        dpr: window.devicePixelRatio || 1,
      })
    },
    prepare: () => {
      const el = findScroller()
      if (!el) {
        return
      }
      savedScroll = { scrollTop: el.scrollTop, behavior: el.style.scrollBehavior }
      // 逐屏截图不能有平滑滚动动画，否则每帧都会截到过渡中的画面。
      el.style.scrollBehavior = 'auto'
    },
    scrollTo: (y: number) => {
      const el = findScroller()
      if (el) {
        el.scrollTop = y
      }
    },
    restore: () => {
      const el = findScroller()
      if (el && savedScroll) {
        el.scrollTop = savedScroll.scrollTop
        el.style.scrollBehavior = savedScroll.behavior
      }
      savedScroll = null
    },
  }
}

const ERROR_KEYS: Record<string, TranslationKey> = {
  busy: 'longShotBusy',
  unsupported: 'longShotUnsupported',
  'not-ready': 'longShotNotReady',
  'too-short': 'longShotTooShort',
  'save-failed': 'longShotSaveFailed',
}

/** 原生拒绝时返回的是约定的错误码，其余异常原样展示。 */
export const longShotErrorKey = (error: unknown): TranslationKey | null => {
  const message = error instanceof Error ? error.message : String(error)
  return ERROR_KEYS[message] ?? null
}

export const exportLongImage = async (dialogTitle: string): Promise<LongScreenshotResult> => {
  const result = await LongScreenshot.capture({ maxHeight: 20000 })
  const { uri } = await Filesystem.getUri({
    path: result.name,
    directory: Directory.Cache,
  })
  await Share.share({ title: dialogTitle, url: uri, dialogTitle })
  return result
}
