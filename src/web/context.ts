import { getUserProfile } from '../profile/store'
import { filterItemsForAge, isConversationalItem } from './age'
import { getOpenArticles } from './articles'
import { getWebDigest } from './digest'
import { formatLocalClock } from './fetchers/clock'
import { getWebConfig } from './store'
import { resolveIgnoreTopics, textHitsAnyTopic } from './topics'
import type { OpenArticle, WebItem } from './types'
import { weatherTalkedToday } from './weatherTalk'

function sortByScore(items: WebItem[]): WebItem[] {
  return [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

function whenLabel(item: WebItem): string {
  if (!item.publishedAt) return ''
  const ms = Date.parse(item.publishedAt)
  if (!Number.isFinite(ms)) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(ms))
}

function itemHay(item: WebItem): string {
  return `${item.title} ${item.blurb} ${item.topic ?? ''}`
}

function itemLine(item: WebItem): string {
  const kind =
    item.source === 'topic' && item.topic
      ? `topic: ${item.topic}`
      : item.source
  const when = whenLabel(item)
  const prefix = when ? `${when}: ` : ''
  const link = item.url ? `\n  ${item.url}` : ''
  return `- [${kind}] ${prefix}${item.title} — ${item.blurb}${link}`
}

function titleLine(item: WebItem): string {
  const kind =
    item.source === 'topic' && item.topic
      ? `topic: ${item.topic}`
      : item.source
  const when = whenLabel(item)
  const prefix = when ? `${when}: ` : ''
  const link = item.url ? `\n  ${item.url}` : ''
  return `- [${kind}] ${prefix}${item.title}${link}`
}

export function formatWebContext(opts?: {
  topicPriority?: 'newspaper'
}): string {
  const cfg = getWebConfig()
  if (!cfg.enabled) return ''

  const profile = getUserProfile()
  const digest = getWebDigest()
  const items = filterItemsForAge(digest.items, profile.age)
  const mentioned = new Set(digest.mentionedIds)

  const lines: string[] = ['TODAY']
  if (cfg.sources.clock) {
    const clock = formatLocalClock()
    lines.push(`Local date and time: ${clock.line}.`)
  }

  const weather = items.find((item) => item.source === 'weather')
  const weatherUsed = Boolean(weather) && weatherTalkedToday()
  if (cfg.sources.weather && weather) {
    const facts = `${weather.title}: ${weather.blurb}`
    if (weatherUsed) {
      lines.push(
        `Weather already came up today. Keep these facts in case they ask; do not mention the weather again unless the user asks. ${facts}`,
      )
    } else {
      lines.push(
        `Weather (optional small talk, at most once today; skip it when a news story or the user's subject fits better): ${facts}`,
      )
    }
  }

  const ignoreTopics = resolveIgnoreTopics(cfg)
  const conversational = items.filter(isConversationalItem)
  const unused = sortByScore(
    conversational.filter(
      (item) =>
        !mentioned.has(item.id) &&
        !textHitsAnyTopic(itemHay(item), ignoreTopics),
    ),
  ).slice(0, 15)
  const used = conversational.filter((item) => mentioned.has(item.id))
  const open = getOpenArticles()

  if (
    !cfg.sources.clock &&
    !weather &&
    !conversational.length &&
    !open.length &&
    !ignoreTopics.length
  ) {
    return ''
  }

  lines.push(
    'These notes were gathered for you. Do not say you were briefed, quote this list, or dump several items at once. Use them like things you happened to know.',
    'Never re-raise a story that already came up today unless the user clearly asks about it, or it is in OPEN ARTICLES.',
    'When you mention a news story, after your spoken sentences add one metadata line per story using the exact URL from the notes. Never read the URL aloud, never say "LINK", never explain the line:',
    'LINK: https://example.com/story',
  )

  if (ignoreTopics.length) {
    lines.push(
      `They do not care about: ${ignoreTopics.join(', ')}. Do not bring these subjects up, even as small talk, unless they clearly ask.`,
    )
  }

  if (unused.length) {
    lines.push(
      opts?.topicPriority === 'newspaper'
        ? 'Bring up one of these unused stories as your main topic. Prefer the stories listed first. Speak about it in your own voice; do not dump the list or say you were given notes.'
        : 'You may bring one of these up naturally if the chat is idle, thin, or it fits. Prefer the stories listed first. Skip it when the user is already on another subject.',
      ...unused.map(itemLine),
    )
  }

  if (used.length) {
    lines.push(
      'Already brought up today. Do not mention these again. If the user asks, answer briefly from memory. If the story is in OPEN ARTICLES, you may keep discussing it:',
      ...used.map(titleLine),
    )
  }

  if (open.length) {
    lines.push(
      'OPEN ARTICLES',
      'These source pages were loaded so you can discuss them in detail. Use facts from the text. Keep spoken replies short. Do not recite long passages or dump the article. Do not say a page was loaded unless they ask how you know.',
      ...open.map(openArticleBlock),
    )
  }

  return lines.join('\n')
}

function openArticleBlock(article: OpenArticle): string {
  return `### ${article.title}\nSource: ${article.host}\n${article.url}\n${article.body}`
}
