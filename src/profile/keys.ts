export const PROFILES_KEY = 'faces:profiles'
export const WEB_KEY = 'faces:web'
export const LEGACY_USER_PROFILE_KEY = 'faces:user-profile'
export const LEGACY_CHAT_KEY = 'faces:chat-session'
export const LEGACY_DIGEST_KEY = 'faces:web-digest'
export const LEGACY_PREFS_KEY = 'faces:news-prefs'
export const LEGACY_ARTICLES_KEY = 'faces:web-articles'
export const LEGACY_DROPPED_KEY = 'faces:web-dropped'
export const LEGACY_WEATHER_TALK_KEY = 'faces:weather-talked-date'

export function chatKey(profileId: string): string {
  return `faces:chat:${profileId}`
}

export function digestKey(profileId: string): string {
  return `faces:web-digest:${profileId}`
}

export function prefsKey(profileId: string): string {
  return `faces:news-prefs:${profileId}`
}

export function articlesKey(profileId: string): string {
  return `faces:web-articles:${profileId}`
}

export function droppedKey(profileId: string): string {
  return `faces:web-dropped:${profileId}`
}

export function weatherTalkKey(profileId: string): string {
  return `faces:weather-talked-date:${profileId}`
}

export function profileDataKeys(profileId: string): string[] {
  return [
    chatKey(profileId),
    digestKey(profileId),
    prefsKey(profileId),
    articlesKey(profileId),
    droppedKey(profileId),
    weatherTalkKey(profileId),
  ]
}
