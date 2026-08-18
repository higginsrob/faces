import type { UserProfile } from '../profile/types'
import type { WebConfig } from './types'
import { resolveFetchTopics } from './topics'

export function webFingerprint(cfg: WebConfig, profile: UserProfile): string {
  return JSON.stringify({
    sources: {
      weather: cfg.sources.weather,
      nationalNews: cfg.sources.nationalNews,
      localNews: cfg.sources.localNews,
    },
    news: 7,
    jina: Boolean(cfg.jinaApiKey),
    topics: resolveFetchTopics(cfg, profile),
    location: profile.location.trim().toLowerCase(),
    politics: profile.politics.trim().toLowerCase(),
    religion: profile.religion.trim().toLowerCase(),
    age: profile.age.trim(),
  })
}
