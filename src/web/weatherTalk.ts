import { loadJson, saveJson } from '../storage'
import { localDateKey } from './digest'

const KEY = 'faces:weather-talked-date'

const WEATHER_TALK =
  /\b(weather|forecast|temperature|humidity|fahrenheit|celsius)\b|\b\d{1,3}\s*(°|degrees?)\s*([fc]|fahrenheit|celsius)?\b|\b(sunny|cloud(?:y|s)?|overcast|rain(?:ing|y)?|snow(?:ing|y)?|sleet|hail|fog(?:gy)?|humid|muggy|windy|drizzle|downpour|thunderstorm|heatwave|blizzard)\b/i

export function weatherTalkedToday(): boolean {
  return loadJson<string>(KEY, '') === localDateKey()
}

export function markWeatherTalkedToday(): void {
  const today = localDateKey()
  if (loadJson<string>(KEY, '') === today) return
  saveJson(KEY, today)
}

export function textTalksAboutWeather(text: string): boolean {
  return WEATHER_TALK.test(text)
}

export function noteWeatherTalkFromText(text: string): void {
  if (textTalksAboutWeather(text)) markWeatherTalkedToday()
}
