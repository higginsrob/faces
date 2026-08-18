export type WebSources = {
  clock: boolean
  weather: boolean
  nationalNews: boolean
  localNews: boolean
}

export type WebConfig = {
  enabled: boolean
  sources: WebSources
  topics: string[]
  ignoreTopics: string[]
  jinaApiKey: string
}

export type WebItemSource = 'weather' | 'national' | 'local' | 'topic'

export type WebItem = {
  id: string
  source: WebItemSource
  topic?: string
  title: string
  blurb: string
  url?: string
  publishedAt?: string
  score?: number
  llmScore?: number
}

export type WebDigestStatus = 'idle' | 'fetching' | 'error'

export type WebDigest = {
  date: string
  fetchedAt: string
  fingerprint: string
  items: WebItem[]
  mentionedIds: string[]
  status: WebDigestStatus
  error?: string
}

export type OpenArticle = {
  url: string
  title: string
  host: string
  body: string
  fetchedAt: string
}
