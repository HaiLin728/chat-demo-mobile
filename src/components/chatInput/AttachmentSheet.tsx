import { useEffect } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCameraOutline24,
  IconFileOutline24,
  IconGalleryOutline24,
} from '../base/icons.js'
import { closeAttachmentSheet, useAttachmentSheet } from './attachmentSheetState.js'
import styles from './AttachmentSheet.module.css'

type Props = {
  onPhoto: () => void | Promise<void>
  onGallery: () => void | Promise<void>
  onFile: () => void
}

/** 从底部弹出的附件面板：拍照 / 相册 / 文件 */
export const AttachmentSheet = ({ onPhoto, onGallery, onFile }: Props) => {
  const t = useTranslate()
  const open = useAttachmentSheet((state) => state.open)

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAttachmentSheet()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) {
    return null
  }

  const choose = (action: () => void | Promise<void>) => () => {
    closeAttachmentSheet()
    void action()
  }

  return (
    <div className={styles.overlay} role="presentation" onClick={closeAttachmentSheet}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={t('addAttachment')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.handle} aria-hidden />
        <div className={styles.options}>
          <button type="button" className={styles.option} onClick={choose(onPhoto)}>
            <IconCameraOutline24 />
            <span>{t('attachPhoto')}</span>
          </button>
          <button type="button" className={styles.option} onClick={choose(onGallery)}>
            <IconGalleryOutline24 />
            <span>{t('attachGallery')}</span>
          </button>
          <button type="button" className={styles.option} onClick={choose(onFile)}>
            <IconFileOutline24 />
            <span>{t('attachFile')}</span>
          </button>
        </div>
        <button type="button" className={styles.cancel} onClick={closeAttachmentSheet}>
          {t('attachCancel')}
        </button>
      </div>
    </div>
  )
}
