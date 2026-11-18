import { Camera, MediaTypeSelection, type MediaResult } from '@capacitor/camera'

const extensionFor = (media: MediaResult, mimeType: string) => {
  const format = media.metadata?.format
  if (format) {
    return format === 'jpeg' ? 'jpg' : format
  }
  if (mimeType.includes('png')) {
    return 'png'
  }
  if (mimeType.includes('webp')) {
    return 'webp'
  }
  return 'jpg'
}

const fileName = (media: MediaResult, mimeType: string) =>
  `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extensionFor(media, mimeType)}`

/** 把相机/相册返回的媒体转成上传流程使用的 File，优先用 webPath 取原图。 */
const toFile = async (media: MediaResult): Promise<File | null> => {
  if (media.webPath) {
    try {
      const response = await fetch(media.webPath)
      const blob = await response.blob()
      return new File([blob], fileName(media, blob.type), {
        type: blob.type || 'image/jpeg',
      })
    } catch {
      // 某些 WebView 不允许直接 fetch 文件 URI，退回缩略图
    }
  }
  if (media.thumbnail) {
    try {
      const response = await fetch(`data:image/jpeg;base64,${media.thumbnail}`)
      const blob = await response.blob()
      return new File([blob], fileName(media, blob.type), {
        type: blob.type || 'image/jpeg',
      })
    } catch {
      return null
    }
  }
  return null
}

/** 调起系统相机拍一张照片 */
export const capturePhoto = async (): Promise<File[]> => {
  const media = await Camera.takePhoto({
    quality: 85,
    targetWidth: 2048,
    correctOrientation: true,
  })
  const file = await toFile(media)
  return file ? [file] : []
}

/** 调起系统相册，支持多选 */
export const pickPhotos = async (): Promise<File[]> => {
  const { results } = await Camera.chooseFromGallery({
    mediaType: MediaTypeSelection.Photo,
    allowMultipleSelection: true,
    limit: 0,
    quality: 85,
    targetWidth: 2048,
    includeMetadata: true,
  })
  const files = await Promise.all(results.map(toFile))
  return files.filter((file): file is File => file !== null)
}

/** 用户主动取消相机/相册时插件会 reject，这种情况不提示错误 */
export const isMediaCancelled = (error: unknown) =>
  /cancel/i.test(error instanceof Error ? error.message : String(error))
