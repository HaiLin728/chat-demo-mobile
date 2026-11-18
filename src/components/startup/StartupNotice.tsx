import { useTranslate } from '../../i18n/index.js'
import { acknowledgeStartupNotice, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import styles from './StartupNotice.module.css'

const GITHUB_URL = 'https://github.com/HaiLin728/chat-demo-mobile'

/**
 * 首次启动的风险提示：导入会话不可逆、官方渠道不额外收费。
 * 必须点按钮确认才能继续；确认结果写入 localStorage，之后不再弹出。
 */
export const StartupNotice = () => {
  const t = useTranslate()
  const acknowledged = useSettings((state) => state.startupNoticeAcknowledged)

  if (acknowledged) {
    return null
  }

  /** 确认后再检查 API Key，避免两个弹窗叠在一起。 */
  const confirm = () => {
    acknowledgeStartupNotice()
    ensureApiKey()
  }

  return (
    <Modal
      title={t('startupNoticeTitle')}
      className={styles.dialog}
      // 只能通过底部按钮确认，点遮罩和 Esc 都不关闭
      onClose={() => {}}
      footer={
        <Button block onClick={confirm}>
          {t('startupNoticeConfirm')}
        </Button>
      }
    >
      <p className={styles.unofficial}>{t('startupNoticeUnofficial')}</p>
      <div className={styles.block}>
        <div className={styles.blockTitle}>{t('startupNoticeImportTitle')}</div>
        <p className={styles.blockBody}>{t('startupNoticeImportBody')}</p>
      </div>
      <div className={styles.block}>
        <div className={styles.blockTitle}>{t('startupNoticeFeeTitle')}</div>
        <p className={styles.blockBody}>{t('startupNoticeFeeBody')}</p>
      </div>
      <p className={styles.github}>
        {t('startupNoticeGithub')}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          {GITHUB_URL}
        </a>
      </p>
    </Modal>
  )
}
