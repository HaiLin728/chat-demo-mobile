# 溪言（Xiyan Chat）

把 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 的网页前端封装成可安装、独立运行的 Android / iOS App，通过 [Capacitor](https://capacitorjs.com/) 提供原生外壳，不需要浏览器地址栏，也不依赖应用商店分发。

- 应用名：溪言
- 包名 / Bundle ID：`dev.xiyan.chat`
- 当前版本：v1.0（`versionName 1.0`，`versionCode 1`）
- 项目地址：<https://github.com/HaiLin728/chat-demo-mobile>

> 本软件是非官方开源项目，与 DeepSeek 没有隶属关系。「DeepSeek」仅用于说明所调用的 API 和兼容的导入格式。

## 重要提醒

- **导入会话不可逆**：从 DeepSeek 官方 App 导入到本应用的会话没法再导回官方 App。官方 App 目前不支持导入会话，导入后想回官方 App 继续聊，历史记录不会跟过去，请考虑清楚再操作。
- **本软件不额外收费**：API 需要你自己到 DeepSeek 官网充值并复制 Key。如果遇到「本软件额外收费才能下载或使用」，请立即举报，以免财产损失。
- 最新版本与源码以 [GitHub 仓库](https://github.com/HaiLin728/chat-demo-mobile) 为准，来路不明的安装包请先核对再安装。

## 功能

- 多会话管理：自动标题、重命名、删除、消息分支切换
- 流式回复、深度思考、智能搜索、链接阅读与来源引用
- 上传 / 粘贴 / 拖拽附件；手机上点回形针可选「拍照 / 相册 / 文件」，文件走系统文件选择器
- 语音输入与朗读
- Markdown、代码高亮、KaTeX 公式、Mermaid 图表
- 简体中文 / English，浅色 / 深色主题
- 历史记录 ZIP 导入导出（App 内通过系统分享面板保存）
- 会话长图导出（Android）：原生逐屏截图后拼接成一张 PNG，通过系统分享保存
- 系统截图的「截长图」在 Android 14+ 可用：由系统驱动滚动并拼接（受系统默认上限 3 页约束）
- 上下文压缩：单会话累计超过 350K token 时，把「前三轮之后、最近六轮之前」的对话自动压缩成摘要，前三轮（通常是人设、世界书）与最近六轮保持原文；摘要保存在本机，可在会话顶部展开查看
- 原生适配：状态栏跟随主题、安卓返回键逐层关闭浮层、键盘弹出时输入框保持可见、刘海与手势条安全区

## 使用

首次启动会先显示使用须知，确认后打开设置，在「数据管理」里填入 API Key。密钥通过 `x-api-key` 请求头直接发往 `https://api.deepseek.com`，不经过任何中转服务器。

- 密钥和设置保存在 WebView 的 localStorage，聊天记录与附件保存在 IndexedDB，均只在本机。
- 「删除所有对话」不会删除 API Key，需要在设置里手动清空。
- 不要把密钥填在公共设备上；建议为本应用单独创建并定期轮换密钥。

## 与网页版的区别

| | 网页版 | 本 App |
| --- | --- | --- |
| 运行方式 | 浏览器打开 | 独立安装，桌面图标启动 |
| 资源加载 | GitHub Pages / 本地文件 | 打包进 App，启动不依赖网络 |
| 导出历史 | 浏览器下载 | 写入缓存后调起系统分享 / 存储面板 |
| 返回键 | 浏览器后退 | 关闭弹窗 → 返回会话列表 → 退出 |
| 状态栏 | 浏览器自带 | 跟随明暗主题变色 |

## 环境要求

- Node.js 22.12+
- npm（仓库使用 `package-lock.json`）
- Android：JDK 21、Android SDK（`ANDROID_HOME` 指向 SDK 目录，需安装 Platform 36 和 Build-Tools）
- iOS：macOS、Xcode 16+、CocoaPods

## 构建 Android

```sh
npm install
npm run apk            # 构建 Web 资源 + cap sync + assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`，可直接 `adb install` 安装到手机。

也可以分步执行：

```sh
npm run build          # 生成 dist/
npm run sync:android   # 把 dist/ 同步进 android/ 工程
node scripts/build-apk.mjs assembleDebug
```

**Windows 中文路径**：Gradle/AGP 处理不了含中文的工程路径。工程放在纯英文目录下时不会触发这个问题；如果路径里含中文，`npm run apk` 会自动用 `subst` 把工程映射到一个空闲盘符再构建，结束后撤销映射，不需要移动工程。想用本机已安装的 Gradle 跳过 wrapper 下载，可以指定：

```sh
GRADLE_BIN=C:/gradle/bin/gradle.bat npm run apk
```

正式版需要自己的签名。签名文件与配置文件都只留在本地，不要提交到仓库（`.gitignore` 已排除 `*.jks` / `*.keystore` / `keystore.properties`）：

```sh
keytool -genkeypair -v -keystore android/release.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias chatdemo
```

在 `android/keystore.properties` 里填写（`storeFile` 相对 `android/` 目录）：

```properties
storeFile=release.jks
storePassword=你的密码
keyAlias=chatdemo
keyPassword=你的密码
```

也可以改用环境变量 `XIYAN_KEYSTORE_PATH` / `XIYAN_KEYSTORE_PASSWORD` / `XIYAN_KEY_ALIAS` / `XIYAN_KEY_PASSWORD`。配置好后：

```sh
npm run apk:release    # 产物：android/app/build/outputs/apk/release/app-release.apk
```

没有提供签名信息时 `assembleRelease` 只会产出未签名包，不能直接安装。

## 构建 iOS

```sh
npm install
npm run sync:ios
npm run open:ios     # 在 Xcode 里配置 Team / Bundle ID 后运行
```

真机与上架需要 Apple 开发者账号；不签名可以先用模拟器运行。

## 已知限制

- 语音输入依赖 WebView 的麦克风权限，首次录音时系统会弹出授权框；拒绝后需到系统设置里重新开启。
- 导出历史走系统分享面板，不同 ROM 的保存位置不同。
- 系统截长图只在 Android 14 及以上生效；Android 13 及以下、iOS 请用聊天页顶栏的「导出长图」。
- 系统截长图默认最多 3 页（受 `screenshot.scroll_max_pages` 控制），且保存前需要在预览里拖动选择框；App 内的「导出长图」不受这个限制。
- 上下文压缩在发送时触发，会先用同一个 API Key 做一次摘要请求（额外产生少量 token 消耗），因此第一次超过 350K 时发送会稍慢；摘要请求失败时会跳过中间轮次并提示。
- 未实现后台常驻、推送和深色启动屏。

## 目录结构

```text
android/             Capacitor 生成的 Android 工程（已包含在仓库中）
ios/                 Capacitor 生成的 iOS 工程
src/                 前端源码
  services/native.ts 原生适配：状态栏、返回键、文件分享
  services/longScreenshot.ts 长图导出：滚动控制与系统分享
android/app/src/main/java/dev/xiyan/chat/LongScreenshotPlugin.java 长图原生截图插件
android/app/src/main/java/dev/xiyan/chat/WebViewScrollCaptureCallback.java 系统级滚动截屏回调
capacitor.config.ts  原生壳配置
rspack.config.ts     Web 资源构建配置，API 地址在构建时注入
```

## 应用图标

图标与启动图由 `scripts/generate-icons.py` 从一张方形源图生成，预览见 [docs/icon-preview.png](docs/icon-preview.png)。脚本会抠掉背景、裁掉多余留白，并输出 Android 各密度图标、自适应图标、iOS 1024 图标和两端的启动图：

```sh
python scripts/generate-icons.py --source path/to/icon.png
```

## 开源协议

本项目沿用上游的 [MIT License](LICENSE)，原始版权归 DeepSeek 所有。上游项目：[deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)。修改与原生适配部分同样以 MIT 协议发布，详见 [NOTICE](NOTICE)。
