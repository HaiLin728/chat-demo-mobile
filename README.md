# 溪言（Xiyan Chat）

把 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 的网页前端封装成可安装、独立运行的 Android / iOS App。界面与交互沿用上游，通过 [Capacitor](https://capacitorjs.com/) 补齐原生外壳，不依赖浏览器地址栏，也不需要通过应用商店分发。

- 应用名：溪言
- 包名 / Bundle ID：`dev.xiyan.chat`

> 这是一个非官方项目，与 DeepSeek 没有隶属关系。"DeepSeek" 仅用于说明所调用的 API 和兼容的导入格式。发布前请自行确认名称可用性并更换图标。

## 功能

- 多会话管理：自动标题、重命名、删除、消息分支切换
- 流式回复、深度思考、智能搜索、链接阅读与来源引用
- 上传 / 粘贴 / 拖拽附件；安卓、iOS 上点回形针可选「拍照 / 相册 / 文件」，文件走系统文件选择器
- 语音输入与朗读
- Markdown、代码高亮、KaTeX 公式、Mermaid 图表
- 简体中文 / English，浅色 / 深色主题
- 历史记录 ZIP 导入导出（App 内通过系统分享面板保存）
- 原生适配：状态栏跟随主题、安卓返回键逐层关闭浮层、键盘弹出时输入框保持可见、刘海与手势条安全区
- 会话长图导出（Android）：原生逐屏截图后拼接成一张 PNG，通过系统分享保存

## 与网页版的区别

| | 网页版 | 本 App |
| --- | --- | --- |
| 运行方式 | 浏览器打开 | 独立安装，桌面图标启动 |
| 资源加载 | GitHub Pages / 本地文件 | 打包进 App，启动不依赖网络 |
| 导出历史 | 浏览器下载 | 写入缓存后调起系统分享 / 存储面板 |
| 返回键 | 浏览器后退 | 关闭弹窗 → 返回会话列表 → 退出 |
| 状态栏 | 浏览器自带 | 跟随明暗主题变色 |

调用 API 时仍然需要联网，密钥只保存在本机。

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

**Windows 中文路径**：Gradle/AGP 处理不了含中文的工程路径（例如 `F:\南枝工作区`）。`npm run apk` 会自动用 `subst` 把工程映射到一个空闲盘符再构建，结束后撤销映射，不需要移动工程。如果想用本机已安装的 Gradle 跳过 wrapper 下载，可以指定：

```sh
GRADLE_BIN=D:/DevTools/gradle-8.14/bin/gradle.bat npm run apk
```

正式发布需要自己的签名：

```sh
keytool -genkeypair -v -keystore release.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias chatdemo

# 在 android/keystore.properties 或环境变量里提供签名信息后：
npm run apk:release
```

签名文件不要提交到仓库（`.gitignore` 已排除 `*.jks` / `*.keystore`）。

## 构建 iOS

```sh
npm install
npm run sync:ios
npm run open:ios     # 在 Xcode 里配置 Team / Bundle ID 后运行
```

真机与上架需要 Apple 开发者账号；不签名可以先用模拟器运行。

## 使用

首次启动会自动打开设置，在「数据管理」里填入 API Key。密钥通过 `x-api-key` 请求头直接发往 `https://api.deepseek.com`，不经过本项目的中转服务器。

- 密钥和设置保存在 WebView 的 localStorage，聊天记录与附件保存在 IndexedDB，均只在本机。
- 「删除所有对话」不会删除 API Key，需要在设置里手动清空。
- 不要把密钥填在公共设备上；建议为这个 App 单独创建并定期轮换密钥。

## 目录结构

```text
android/             Capacitor 生成的 Android 工程（已包含在仓库中）
ios/                 Capacitor 生成的 iOS 工程
src/                 上游前端源码
  services/native.ts 原生适配：状态栏、返回键、文件分享
  services/longScreenshot.ts 长图导出：滚动控制与系统分享
android/app/src/main/java/dev/xiyan/chat/LongScreenshotPlugin.java 长图原生截图插件
capacitor.config.ts  原生壳配置
rspack.config.ts     Web 资源构建配置，API 地址在构建时注入
```

## 应用图标

图标和启动图由一张源图生成，预览见 [docs/icon-preview.png](docs/icon-preview.png)。

- 源图要求：正方形、接近纯色的浅色背景、深色主体。
- 生成命令会抠掉背景、裁掉多余留白，并输出 Android 各密度图标、圆形/自适应图标、iOS 1024 图标和两端的启动图：

```sh
python scripts/generate-icons.py --source path/to/icon.png
```

图标源文件由项目维护者提供，发布前请自行确认图片的授权与商标可用性。

## 已知限制

- 语音输入依赖 WebView 的麦克风权限，首次录音时系统会弹出授权框；拒绝后需到系统设置里重新开启。
- 导出历史走系统分享面板，不同 ROM 的保存位置不同。
- 系统的「滚动截屏」只识别原生滚动容器，WebView 会话页只能截到一屏；长图请用顶栏的「导出长图」。该功能目前仅 Android 实现，iOS 端隐藏入口。
- 未实现后台常驻、推送和深色启动屏。

## 名称与商标

- 应用名「溪言」、包名 `dev.xiyan.chat` 都是中性命名，不使用 DeepSeek 的名称、Logo 或其缩写作为品牌。
- 在 README、应用商店描述里写「支持 DeepSeek API」「兼容 DeepSeek 导出的历史记录」属于说明兼容性的描述性使用，一般没有问题；但不要把 DeepSeek 或其缩写放进 App 名称、图标、启动页，也不要使用官方视觉元素暗示授权或隶属关系。
- 不建议把「DS API」这类缩写作为应用名：`DS` 在中文语境里很容易被理解为 DeepSeek 的缩写，仍然可能造成来源误认。
- 开源和免费会降低权利人追究的意愿，但不等于没有商标风险。商标侵权通常看是否造成混淆、是否属于商业使用；上架应用商店时还要遵守商店的冒名/仿冒政策。

## 开源协议

本项目沿用上游的 [MIT License](LICENSE)，原始版权归 DeepSeek 所有。上游项目：[deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)。修改与原生适配部分同样以 MIT 协议发布，详见 [NOTICE](NOTICE)。
