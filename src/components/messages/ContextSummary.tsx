import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { SessionCompression } from '../../services/chat/types.js'
import styles from './ContextSummary.module.css'

/** 会话顶部提示：较早的轮次已经被压缩成摘要，可展开查看。 */
export const ContextSummary = ({ compression }: { compression: SessionCompression }) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>
          {t('contextSummaryTitle', { rounds: compression.rounds })}
        </span>
        <button type="button" className={styles.toggle} onClick={() => setOpen(!open)}>
          {t(open ? 'contextSummaryHide' : 'contextSummaryShow')}
        </button>
      </div>
      {open ? <div className={styles.body}>{compression.summary}</div> : null}
    </div>
  )
}
