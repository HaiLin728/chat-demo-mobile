import { streamMessage } from '../api/client.js'
import type { ChatModel, CreateMessageRequest, MessageUsage } from '../api/types.js'
import { getContextRounds, getReplyText } from './reply.js'
import type { AssistantMessage, Message, SessionCompression, UserMessage } from './types.js'

/**
 * 上下文预算：自己带 API Key 调用，单轮输入放宽到 350K token。
 * 超过后把较早的轮次压缩成摘要，前三轮（通常是系统提示、人设和世界书）始终原样保留。
 */
export const CONTEXT_TOKEN_LIMIT = 350_000
/** 开头不压缩的轮次：前几轮一般是人设、世界书与规则，压缩会破坏设定。 */
export const KEEP_HEAD_ROUNDS = 3
/** 末尾原样保留的轮次，保证最近剧情细节不丢。 */
export const KEEP_TAIL_ROUNDS = 6
/** 单次摘要请求最多读取的对话 token；超出就分块合并，避免摘要请求自己超上下文。 */
const SUMMARY_CHUNK_TOKENS = 60_000
/** 摘要正文的软上限，提示模型控制篇幅 */
const SUMMARY_LENGTH_HINT = 2000
/** 每条消息的角色与格式开销 */
const MESSAGE_OVERHEAD = 8

export type ContextRound = [UserMessage, AssistantMessage]

/** 估算文本 token 数：中日韩字符按 0.75 计，其余按 4 字符 1 token；宁可高估，提前压缩。 */
export const estimateTokens = (text: string) => {
  if (!text) {
    return 0
  }
  let cjk = 0
  let other = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0x3400 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      cjk += 1
    } else {
      other += 1
    }
  }
  return Math.ceil(cjk * 0.75) + Math.ceil(other / 4) + MESSAGE_OVERHEAD
}

export const roundTokens = ([user, reply]: ContextRound) =>
  estimateTokens(user.content) + estimateTokens(getReplyText(reply))

const usageTokens = (usage: MessageUsage) =>
  usage.input_tokens +
  (usage.cache_creation_input_tokens ?? 0) +
  (usage.cache_read_input_tokens ?? 0) +
  usage.output_tokens

/** 本次请求的上下文大小：优先用上一轮服务端回报的用量，其次按文本估算。 */
export const contextTokens = (
  rounds: ContextRound[],
  question: UserMessage,
  summary: string
) => {
  const estimated =
    rounds.reduce((total, round) => total + roundTokens(round), 0) +
    estimateTokens(question.content) +
    estimateTokens(summary)
  const usage = rounds.at(-1)?.[1].usage
  const measured = usage ? usageTokens(usage) + estimateTokens(question.content) : 0
  return Math.max(estimated, measured)
}

const findCoveredIndex = (rounds: ContextRound[], coveredId: string) =>
  rounds.findIndex(([, reply]) => reply.id === coveredId)

const flattenRounds = (rounds: ContextRound[]): Message[] =>
  rounds.flatMap(([user, reply]) => [user, reply])

export type ContextPlan = {
  /** 本次实际发送的历史 */
  history: Message[]
  /** 已有的有效摘要；没有压缩过或摘要与当前分支对不上时为空 */
  summary: string
  /** 超过预算、需要新压缩的轮次；null 表示本次不需要生成摘要 */
  pending: ContextRound[] | null
  /** 压缩后累计的轮次数 */
  compressedRounds: number
}

/**
 * 规划本次请求的上下文：
 * - 摘要只在其覆盖的那条回复仍在当前分支上时有效；
 * - 需要压缩时取「前三轮之后、最近几轮之前」的中间部分；
 * - 发送时丢掉已被摘要覆盖的轮次，前三轮与最近的轮次保持原文。
 */
export const planContext = ({
  history,
  question,
  compression,
}: {
  history: Message[]
  question: UserMessage
  compression?: SessionCompression
}): ContextPlan => {
  const rounds = getContextRounds(history)
  const coveredIndex = compression ? findCoveredIndex(rounds, compression.coveredId) : -1
  const summary = compression && coveredIndex >= 0 ? compression.summary : ''
  const overLimit = contextTokens(rounds, question, summary) >= CONTEXT_TOKEN_LIMIT

  const start = Math.max(KEEP_HEAD_ROUNDS, coveredIndex + 1)
  const end = Math.max(start + 1, rounds.length - KEEP_TAIL_ROUNDS)
  const pending = overLimit && start < end && end <= rounds.length ? rounds.slice(start, end) : null

  const kept = rounds.filter((_round, index) =>
    pending ? index < KEEP_HEAD_ROUNDS || index >= end : index < KEEP_HEAD_ROUNDS || index > coveredIndex
  )
  return {
    history: pending || coveredIndex >= 0 ? flattenRounds(kept) : history,
    summary,
    pending,
    compressedRounds: compression && coveredIndex >= 0 ? compression.rounds : 0,
  }
}

const SUMMARY_SYSTEM_PROMPT = [
  '你是对话记忆压缩器。把给定的对话记录压缩成一段信息密集的摘要，供后续对话作为长期记忆使用。',
  '必须保留：角色姓名、称呼与身份；性格、语气和说话方式；世界观、设定与规则；重要事件及其因果；承诺、约定与秘密；当前状态（时间、地点、物品、关系、伤势）；尚未解决的线索和冲突。',
  '保留专有名词原样，数字与单位不要改写。不要评论、不要续写、不要使用第一人称，只输出摘要正文。',
  `用与对话记录相同的语言输出，篇幅尽量控制在 ${SUMMARY_LENGTH_HINT} 字以内。`,
].join('\n')

const transcript = (rounds: ContextRound[]) =>
  rounds
    .map(([user, reply], index) => {
      const files = user.files.map((file) => file.name).join('、')
      const question = [user.content, files ? `（附件：${files}）` : ''].filter(Boolean).join(' ')
      return `【第 ${index + 1} 轮】\n用户：${question}\n助手：${getReplyText(reply)}`
    })
    .join('\n\n')

/** 按轮次切块，保证单次摘要请求不会自己超出上下文 */
const chunkRounds = (rounds: ContextRound[], budget: number): ContextRound[][] => {
  const chunks: ContextRound[][] = []
  let current: ContextRound[] = []
  let size = 0
  for (const round of rounds) {
    const tokens = roundTokens(round)
    if (current.length > 0 && size + tokens > budget) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(round)
    size += tokens
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

const readSummary = async (
  apiKey: string,
  model: ChatModel,
  previousSummary: string,
  rounds: ContextRound[],
  signal: AbortSignal
): Promise<string> => {
  const body: CreateMessageRequest = {
    model,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          previousSummary ? `已有摘要（需要与新对话合并）：\n${previousSummary}\n\n` : '',
          `新增对话记录：\n${transcript(rounds)}\n\n`,
          previousSummary ? '请输出合并后的完整摘要，不要遗漏已有摘要里的关键信息。' : '请输出摘要。',
        ].join(''),
      },
    ],
    thinking: { type: 'disabled' },
    safety_check: { level: 'high' },
    tools: [],
  }

  let text = ''
  for await (const event of streamMessage(apiKey, body, signal)) {
    if (event.type === 'content_block_start' && event.content_block.type === 'text') {
      text += event.content_block.text
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }
  const result = text.trim()
  if (!result) {
    throw new Error('empty summary')
  }
  return result
}

/** 把待压缩的轮次并入已有摘要；轮次过多时按块依次合并。 */
export const summarizeRounds = async ({
  apiKey,
  model,
  previousSummary,
  rounds,
  signal,
}: {
  apiKey: string
  model: ChatModel
  previousSummary: string
  rounds: ContextRound[]
  signal: AbortSignal
}): Promise<string> => {
  let summary = previousSummary
  for (const chunk of chunkRounds(rounds, SUMMARY_CHUNK_TOKENS)) {
    signal.throwIfAborted()
    summary = await readSummary(apiKey, model, summary, chunk, signal)
  }
  return summary
}

/** 摘要作为系统提示的一部分发送，不改动消息序列，避免破坏提问与回答的对应关系。 */
export const composeSystem = (summary: string, base: string) =>
  summary ? `${base}\n\n【更早对话摘要】\n${summary}` : base
