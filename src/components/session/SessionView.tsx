import clsx from 'clsx'
import { useCallback } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { canExportLongImage, exportLongImage, longShotErrorKey } from '../../services/longScreenshot.js'
import { showToast } from '../base/toastState.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')

  /** 长图由原生逐屏截图拼接；回答生成中内容还在变，先让用户等这一轮结束。 */
  const exportImage = useCallback(async () => {
    if (streaming) {
      showToast({ key: 'longShotStreaming' })
      return
    }
    try {
      const result = await exportLongImage(t('longShotSaveTitle'))
      if (result.truncated) {
        showToast({ key: 'longShotTruncated' })
      }
    } catch (error) {
      if (error instanceof Error && /cancel/i.test(error.message)) {
        return
      }
      const key = longShotErrorKey(error)
      if (key) {
        showToast({ key })
        return
      }
      showToast(error instanceof Error ? error.message : t('longShotSaveFailed'))
    }
  }, [streaming, t])

  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader
          title={title}
          onExport={
            canExportLongImage() && session.messages.length > 0 ? exportImage : undefined
          }
        />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
