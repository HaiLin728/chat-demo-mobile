import type { CapacitorConfig } from '@capacitor/cli'

/**
 * 原生壳配置。
 * - `webDir` 指向 rspack 的构建产物，`npm run sync` 会把它拷进 Android/iOS 工程。
 * - Android 使用 https://localhost 作为页面来源，接口跨域已确认可用，SSE 流式回复不需要走原生 HTTP。
 */
const config: CapacitorConfig = {
  appId: 'dev.xiyan.chat',
  appName: '溪言',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  android: {
    backgroundColor: '#ffffff',
    allowMixedContent: false,
  },
  ios: {
    // 安全区统一交给 CSS 的 env(safe-area-inset-*)，避免和 WebView 自身的内边距叠加
    contentInset: 'never',
    backgroundColor: '#ffffff',
  },
  plugins: {
    Keyboard: {
      // 键盘弹出时压缩 WebView，配合页面里的 visualViewport 处理输入框位置
      resize: 'body',
    },
    StatusBar: {
      overlaysWebView: false,
      backgroundColor: '#ffffff',
    },
  },
}

export default config
