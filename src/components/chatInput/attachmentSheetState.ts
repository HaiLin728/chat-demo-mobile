import { create } from 'zustand'

/** 附件选择面板：输入框的加号打开，选中动作、点遮罩或安卓返回键关闭 */
export const useAttachmentSheet = create(() => ({ open: false }))

export const openAttachmentSheet = () => useAttachmentSheet.setState({ open: true })

export const closeAttachmentSheet = () => useAttachmentSheet.setState({ open: false })
