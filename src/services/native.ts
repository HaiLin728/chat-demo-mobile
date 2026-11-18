import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { StatusBar, Style } from '@capacitor/status-bar'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { closeSettings, useSettingsDialog } from '../components/settings/settingsDialogState.js'
import {
  closeAttachmentSheet,
  useAttachmentSheet,
} from '../components/chatInput/attachmentSheetState.js'
import { newChat, useChatStore } from './chat/store.js'
import { stopReadAloud } from './speech/readAloud.js'

/** 是否运行在 Capacitor 原生壳里；浏览器里开发时仍走原来的网页行为。 */
export const isNative = () => Capacitor.isNativePlatform()

const statusBarColors = { light: '#ffffff', dark: '#151517' } as const

/** 原生状态栏跟随页面深浅色，避免深色页面顶部出现一条白条。 */
const syncStatusBar = () => {
  if (!isNative()) {
    return
  }
  const dark = document.body.classList.contains('dark')
  void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
  if (Capacitor.getPlatform() === 'android') {
    void StatusBar.setBackgroundColor({
      color: dark ? statusBarColors.dark : statusBarColors.light,
    }).catch(() => {})
  }
}

/**
 * 安卓返回键：优先关闭最上层浮层，其次回到新对话页，最后才退出 App。
 * 不拦截时系统会直接杀掉页面，输入框里的草稿会丢失。
 */
const onAndroidBack = () => {
  if (useAttachmentSheet.getState().open) {
    closeAttachmentSheet()
    return
  }
  if (useSettingsDialog.getState().open) {
    closeSettings()
    return
  }
  if (useSearchPanel.getState().entry !== null) {
    closeSearchPanel()
    return
  }
  if (useMobileSider.getState().open) {
    closeMobileSider()
    return
  }
  if (useChatStore.getState().activeId !== null) {
    stopReadAloud()
    newChat()
    return
  }
  void NativeApp.exitApp()
}

/** 只在原生壳里挂载：状态栏、返回键和键盘行为。 */
export const setupNativeShell = () => {
  if (!isNative()) {
    return
  }
  syncStatusBar()
  new MutationObserver(syncStatusBar).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  })
  void NativeApp.addListener('backButton', onAndroidBack)
}

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read blob failed'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('unexpected reader result'))
        return
      }
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })

const downloadInBrowser = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 导出文件：网页里触发下载，原生壳里写入缓存目录后调起系统分享/存储面板。 */
export const saveFile = async (name: string, blob: Blob) => {
  if (!isNative()) {
    downloadInBrowser(name, blob)
    return
  }
  const { uri } = await Filesystem.writeFile({
    path: name,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  })
  await Share.share({ title: name, url: uri, dialogTitle: name })
}
