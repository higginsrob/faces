import {
  MAX_CARE_TOPICS,
  MAX_SKIP_TOPICS,
  mergeTopics,
  parseOneTopic,
  splitTopicHint,
  topicOnList,
} from './topics'

export type TopicOverlap = {
  care: string
  skip: string
  reason: string
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsPhrase(hay: string, needle: string): boolean {
  if (needle.length < 2 || hay === needle) return false
  if (!hay.includes(needle)) return false
  const re = new RegExp(`(?:^|\\s)${escapeRe(needle)}(?:\\s|$)`)
  return re.test(hay)
}

function topicStem(term: string): string {
  const t = term.toLowerCase()
  if (t.length >= 5 && t.endsWith('ies')) return `${t.slice(0, -3)}y`
  if (t.length >= 5 && t.endsWith('es')) return t.slice(0, -2)
  if (t.length >= 5 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1)
  return t
}

/** Same word with different parenthetical hints is allowed (drums (music) vs drums (oil)). */
export function topicOverlapReason(care: string, skip: string): string | null {
  const a = care.trim()
  const b = skip.trim()
  if (!a || !b) return null
  if (a.toLowerCase() === b.toLowerCase()) return 'same topic'

  const ca = splitTopicHint(a)
  const cb = splitTopicHint(b)
  const termA = ca.term.toLowerCase()
  const termB = cb.term.toLowerCase()
  const hintA = ca.hint?.toLowerCase() ?? null
  const hintB = cb.hint?.toLowerCase() ?? null
  const distinguished = Boolean(hintA && hintB && hintA !== hintB)

  if (termA === termB) {
    if (distinguished) return null
    if (hintA && hintB) return 'same topic'
    return `both mean “${ca.term}”`
  }

  if (!distinguished && topicStem(termA) === topicStem(termB) && topicStem(termA).length >= 3) {
    return `both mean “${ca.term}”`
  }

  if (containsPhrase(termA, termB) || containsPhrase(termB, termA)) {
    if (distinguished) return null
    const shorter = termA.length <= termB.length ? ca.term : cb.term
    const longer = termA.length <= termB.length ? cb.term : ca.term
    return `“${shorter}” overlaps “${longer}”`
  }

  return null
}

export function findTopicOverlaps(topics: string[], ignoreTopics: string[]): TopicOverlap[] {
  const out: TopicOverlap[] = []
  for (const care of topics) {
    for (const skip of ignoreTopics) {
      const reason = topicOverlapReason(care, skip)
      if (reason) out.push({ care, skip, reason })
    }
  }
  return out
}

export function dropsForAdd(
  adding: string[],
  otherList: string[],
  side: 'care' | 'skip',
): { adding: string[]; dropping: string[]; overlaps: TopicOverlap[] } {
  const dropping: string[] = []
  const seen = new Set<string>()
  const overlaps: TopicOverlap[] = []
  for (const item of adding) {
    for (const other of otherList) {
      const reason =
        side === 'care'
          ? topicOverlapReason(item, other)
          : topicOverlapReason(other, item)
      if (!reason) continue
      overlaps.push(
        side === 'care'
          ? { care: item, skip: other, reason }
          : { care: other, skip: item, reason },
      )
      const key = other.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      dropping.push(other)
    }
  }
  return { adding, dropping, overlaps }
}

function notIn(items: string[], list: string[]): string[] {
  const have = new Set(list.map((t) => t.toLowerCase()))
  return items.filter((t) => !have.has(t.toLowerCase()))
}

export type PendingTopicChange = {
  addCare: string[]
  addSkip: string[]
  dropCare: string[]
  dropSkip: string[]
  mutual: boolean
}

export function planTopicAdds(
  lists: { topics: string[]; ignoreTopics: string[] },
  addCareRaw: string[],
  addSkipRaw: string[],
): {
  immediateCare: string[]
  immediateSkip: string[]
  pending: PendingTopicChange[]
} {
  const addCare = notIn(addCareRaw, lists.topics)
  const addSkip = notIn(addSkipRaw, lists.ignoreTopics)
  const mutualOverlaps = findTopicOverlaps(addCare, addSkip)
  const mutualCare = new Set(mutualOverlaps.map((o) => o.care.toLowerCase()))
  const mutualSkip = new Set(mutualOverlaps.map((o) => o.skip.toLowerCase()))

  const pending: PendingTopicChange[] = []
  if (mutualOverlaps.length) {
    pending.push({
      addCare: addCare.filter((t) => mutualCare.has(t.toLowerCase())),
      addSkip: addSkip.filter((t) => mutualSkip.has(t.toLowerCase())),
      dropCare: [],
      dropSkip: [],
      mutual: true,
    })
  }

  const restCare = addCare.filter((t) => !mutualCare.has(t.toLowerCase()))
  const restSkip = addSkip.filter((t) => !mutualSkip.has(t.toLowerCase()))
  const careDrops = dropsForAdd(restCare, lists.ignoreTopics, 'care')
  const skipDrops = dropsForAdd(restSkip, lists.topics, 'skip')
  const dropSkipKeys = new Set(careDrops.dropping.map((t) => t.toLowerCase()))
  const dropCareKeys = new Set(skipDrops.dropping.map((t) => t.toLowerCase()))

  const pendingCare = restCare.filter((t) =>
    careDrops.overlaps.some((o) => o.care.toLowerCase() === t.toLowerCase()),
  )
  const pendingSkip = restSkip.filter((t) =>
    skipDrops.overlaps.some((o) => o.skip.toLowerCase() === t.toLowerCase()),
  )
  const immediateCare = restCare.filter(
    (t) => !pendingCare.some((p) => p.toLowerCase() === t.toLowerCase()),
  )
  const immediateSkip = restSkip.filter(
    (t) => !pendingSkip.some((p) => p.toLowerCase() === t.toLowerCase()),
  )

  if (pendingCare.length || pendingSkip.length) {
    pending.push({
      addCare: pendingCare,
      addSkip: pendingSkip,
      dropCare: skipDrops.dropping,
      dropSkip: careDrops.dropping,
      mutual: false,
    })
  }

  // An immediate add on one list should not keep a pending drop of that same phrase.
  return {
    immediateCare: immediateCare.filter((t) => !dropCareKeys.has(t.toLowerCase())),
    immediateSkip: immediateSkip.filter((t) => !dropSkipKeys.has(t.toLowerCase())),
    pending,
  }
}

export function applyTopicChange(
  lists: { topics: string[]; ignoreTopics: string[] },
  change: {
    addCare?: string[]
    addSkip?: string[]
    dropCare?: string[]
    dropSkip?: string[]
  },
  limits: { care: number; skip: number },
): { topics: string[]; ignoreTopics: string[] } {
  const dropCare = new Set((change.dropCare ?? []).map((t) => t.toLowerCase()))
  const dropSkip = new Set((change.dropSkip ?? []).map((t) => t.toLowerCase()))
  const topics = mergeTopics(
    lists.topics.filter((t) => !dropCare.has(t.toLowerCase())),
    change.addCare ?? [],
    limits.care,
  )
  const ignoreTopics = mergeTopics(
    lists.ignoreTopics.filter((t) => !dropSkip.has(t.toLowerCase())),
    change.addSkip ?? [],
    limits.skip,
  )
  return { topics, ignoreTopics }
}

export type TopicLists = { topics: string[]; ignoreTopics: string[] }

export const TOPIC_LIMITS = { care: MAX_CARE_TOPICS, skip: MAX_SKIP_TOPICS }

export type PrepareKeywordResult =
  | { status: 'empty' }
  | { status: 'full'; limit: number }
  | { status: 'ready'; next: TopicLists }
  | { status: 'conflict'; keyword: string; overlaps: TopicOverlap[] }

function wouldBeLists(
  lists: TopicLists,
  keyword: string,
  side: 'care' | 'skip',
): TopicLists {
  if (side === 'care') {
    return { topics: [...lists.topics, keyword], ignoreTopics: lists.ignoreTopics }
  }
  return { topics: lists.topics, ignoreTopics: [...lists.ignoreTopics, keyword] }
}

export function prepareKeywordAdd(
  lists: TopicLists,
  raw: string,
  side: 'care' | 'skip',
): PrepareKeywordResult {
  const keyword = parseOneTopic(raw)
  if (!keyword) return { status: 'empty' }

  const same = side === 'care' ? lists.topics : lists.ignoreTopics
  const limit = side === 'care' ? TOPIC_LIMITS.care : TOPIC_LIMITS.skip
  if (topicOnList(same, keyword)) return { status: 'ready', next: lists }
  if (same.length >= limit) return { status: 'full', limit }

  const planned = planTopicAdds(
    lists,
    side === 'care' ? [keyword] : [],
    side === 'skip' ? [keyword] : [],
  )
  if (planned.pending.length) {
    return {
      status: 'conflict',
      keyword,
      overlaps: findTopicOverlaps(
        wouldBeLists(lists, keyword, side).topics,
        wouldBeLists(lists, keyword, side).ignoreTopics,
      ),
    }
  }

  return {
    status: 'ready',
    next: applyTopicChange(
      lists,
      {
        addCare: planned.immediateCare,
        addSkip: planned.immediateSkip,
      },
      TOPIC_LIMITS,
    ),
  }
}

export function resolveKeywordKeep(
  lists: TopicLists,
  keyword: string,
  keep: 'care' | 'skip',
): PrepareKeywordResult {
  const parsed = parseOneTopic(keyword)
  if (!parsed) return { status: 'empty' }

  const same = keep === 'care' ? lists.topics : lists.ignoreTopics
  const limit = keep === 'care' ? TOPIC_LIMITS.care : TOPIC_LIMITS.skip
  if (!topicOnList(same, parsed) && same.length >= limit) {
    return { status: 'full', limit }
  }

  if (keep === 'care') {
    const { dropping } = dropsForAdd([parsed], lists.ignoreTopics, 'care')
    return {
      status: 'ready',
      next: applyTopicChange(
        lists,
        { addCare: [parsed], dropSkip: dropping },
        TOPIC_LIMITS,
      ),
    }
  }

  const { dropping } = dropsForAdd([parsed], lists.topics, 'skip')
  return {
    status: 'ready',
    next: applyTopicChange(
      lists,
      { addSkip: [parsed], dropCare: dropping },
      TOPIC_LIMITS,
    ),
  }
}
