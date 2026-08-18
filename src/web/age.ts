import { parseAgeYears } from '../profile/types'
import type { WebItem } from './types'

export type NewsAccess = 'full' | 'teen' | 'child'

export function newsAccess(age: string): NewsAccess {
  const years = parseAgeYears(age)
  if (years === null) return 'full'
  if (years < 13) return 'child'
  if (years < 18) return 'teen'
  return 'full'
}

const TEEN_SKIP =
  /\b(killed|murder|massacre|rape|sexual|behead|execution|genocide|porn|suicide|torture)\b/i

export function isConversationalItem(item: WebItem): boolean {
  return (
    item.source === 'national' ||
    item.source === 'local' ||
    item.source === 'topic'
  )
}

export function filterItemsForAge(items: WebItem[], age: string): WebItem[] {
  const access = newsAccess(age)
  if (access === 'full') return items
  if (access === 'child') {
    return items.filter((item) => !isConversationalItem(item))
  }
  return items.filter((item) => {
    if (!isConversationalItem(item)) return true
    const text = `${item.title} ${item.blurb}`
    return !TEEN_SKIP.test(text)
  })
}
