import { spawnSync } from 'node:child_process'
import path from 'node:path'

/**
 * 构建 Android APK。
 *
 * Windows 下 Gradle/AGP 处理不了含中文的工程路径，这里自动把工程目录映射到一个空闲盘符
 * （subst）后再调用 Gradle，构建结束撤销映射。工程本身不需要移动。
 *
 * 用法：
 *   node scripts/build-apk.mjs            # assembleDebug
 *   node scripts/build-apk.mjs assembleRelease
 *   GRADLE_BIN=/path/to/gradle node scripts/build-apk.mjs
 */

const root = path.resolve(import.meta.dirname, '..')
const isWindows = process.platform === 'win32'
const nonAsciiPath = /[^\x00-\x7F]/.test(root)

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败（退出码 ${result.status ?? 'unknown'}）`)
  }
}

/** 通过 cmd.exe 调用 .bat/.cmd；verbatim 参数避免 Node 对引号做二次转义 */
const runBatch = (command, args, cwd) => {
  const line = [command, ...args].map((part) => `"${part}"`).join(' ')
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    cwd,
    stdio: 'inherit',
    windowsVerbatimArguments: true,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败（退出码 ${result.status ?? 'unknown'}）`)
  }
}

const usedDrives = () => {
  if (!isWindows) {
    return new Set()
  }
  const result = spawnSync('subst', [], { encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout) {
    return new Set()
  }
  return new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split(':')[0]?.toUpperCase())
      .filter(Boolean)
  )
}

const freeDrive = () => {
  const used = usedDrives()
  for (let code = 'Z'.charCodeAt(0); code >= 'P'.charCodeAt(0); code -= 1) {
    const drive = String.fromCharCode(code)
    if (!used.has(drive)) {
      return drive
    }
  }
  throw new Error('没有空闲盘符可用于映射工程目录')
}

const main = () => {
  const gradleArgs = process.argv.slice(2)
  const tasks = gradleArgs.length > 0 ? gradleArgs : ['assembleDebug']
  const override = process.env.GRADLE_BIN

  let workRoot = root
  let mappedDrive = null

  if (isWindows && nonAsciiPath) {
    mappedDrive = freeDrive()
    run('subst', [`${mappedDrive}:`, root], root)
    workRoot = `${mappedDrive}:\\`
    console.log(`[apk] 工程路径含中文，已映射到 ${mappedDrive}:`)
  }

  try {
    const androidDir = path.join(workRoot, 'android')
    const gradle = override ?? path.join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew')
    if (isWindows) {
      runBatch(gradle, [...tasks, '--no-daemon'], androidDir)
    } else {
      run(gradle, [...tasks, '--no-daemon'], androidDir)
    }
  } catch (error) {
    console.error(`[apk] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    if (mappedDrive) {
      spawnSync('subst', [`${mappedDrive}:`, '/D'], { stdio: 'ignore' })
    }
  }
}

main()
