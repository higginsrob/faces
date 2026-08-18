import type { WeatherRow, WebItem } from '../types'
import { clip, combinedSignal, fetchJson, itemId } from './http'

type GeoResult = {
  name: string
  latitude: number
  longitude: number
  country?: string
  admin1?: string
}

type GeoResponse = { results?: GeoResult[] }

type ForecastResponse = {
  current_units?: { temperature_2m?: string }
  current?: { temperature_2m?: number; weather_code?: number }
  daily?: {
    time?: string[]
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    weather_code?: number[]
  }
}

type DailyDay = {
  date: string
  high?: number
  low?: number
  condition: string
}

const FORECAST_DAYS = 5

const WMO: Record<number, string> = {
  0: 'clear',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'rime fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'dense drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  80: 'rain showers',
  81: 'rain showers',
  82: 'heavy rain showers',
  85: 'snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'thunderstorm with hail',
}

function conditionLabel(code: number | undefined): string {
  if (code == null || !Number.isFinite(code)) return 'unknown conditions'
  return WMO[code] ?? WMO[Math.floor(code)] ?? 'mixed conditions'
}

function useFahrenheit(): boolean {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || ''
  return locale.toLowerCase().startsWith('en-us')
}

function placeLabel(hit: GeoResult): string {
  const parts = [hit.name, hit.admin1, hit.country].filter(Boolean)
  return [...new Set(parts)].join(', ')
}

function queryCandidates(location: string): string[] {
  const trimmed = location.trim()
  if (!trimmed) return []
  const first = trimmed.split(',')[0]?.trim()
  return first && first.toLowerCase() !== trimmed.toLowerCase()
    ? [trimmed, first]
    : [trimmed]
}

function finite(n: number | undefined): number | undefined {
  return n != null && Number.isFinite(n) ? n : undefined
}

function dayName(isoDate: string, index: number): string {
  if (index === 0) return 'today'
  if (index === 1) return 'tomorrow'
  const d = new Date(`${isoDate}T12:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(d)
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s
}

function parseDaily(forecast: ForecastResponse): DailyDay[] {
  const times = forecast.daily?.time ?? []
  const highs = forecast.daily?.temperature_2m_max ?? []
  const lows = forecast.daily?.temperature_2m_min ?? []
  const codes = forecast.daily?.weather_code ?? []
  const days: DailyDay[] = []
  for (let i = 0; i < times.length; i++) {
    const date = times[i]?.trim()
    if (!date) continue
    const high = finite(highs[i])
    const low = finite(lows[i])
    if (high == null && low == null) continue
    days.push({
      date,
      high,
      low,
      condition: conditionLabel(codes[i]),
    })
  }
  return days
}

function displayRange(day: DailyDay): string | null {
  if (day.high != null && day.low != null) {
    return `${Math.round(day.high)}° / ${Math.round(day.low)}°`
  }
  if (day.high != null) return `H ${Math.round(day.high)}°`
  if (day.low != null) return `L ${Math.round(day.low)}°`
  return null
}

function spokenRange(day: DailyDay): string | null {
  if (day.high != null && day.low != null) {
    return `a high of ${Math.round(day.high)} and a low of ${Math.round(day.low)}`
  }
  if (day.high != null) return `a high of ${Math.round(day.high)}`
  if (day.low != null) return `a low of ${Math.round(day.low)}`
  return null
}

function buildForecast(
  temp: number | undefined,
  condition: string,
  days: DailyDay[],
  suffix: string,
): WeatherRow[] {
  const rows: WeatherRow[] = []
  if (temp != null) {
    rows.push({
      label: 'Now',
      condition,
      temp: `${Math.round(temp)}${suffix}`,
    })
  } else if (condition && condition !== 'unknown conditions') {
    rows.push({ label: 'Now', condition })
  }
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!
    const range = displayRange(day)
    rows.push({
      label: capitalize(dayName(day.date, i)),
      condition: day.condition,
      ...(range ? { temp: range } : {}),
    })
  }
  return rows
}

function buildBlurb(rows: WeatherRow[]): string {
  const parts = rows.map((row) =>
    [row.label, row.condition, row.temp].filter(Boolean).join(' '),
  )
  return clip(parts.join('. ') + (parts.length ? '.' : ''), 360)
}

function buildSpokenText(
  place: string,
  temp: number | undefined,
  condition: string,
  days: DailyDay[],
  fahrenheit: boolean,
): string {
  const unit = fahrenheit ? 'Fahrenheit' : 'Celsius'
  const sentences: string[] = []
  if (temp != null) {
    sentences.push(
      `Right now in ${place}, it's ${Math.round(temp)} degrees ${unit} and ${condition}.`,
    )
  } else {
    sentences.push(`Weather in ${place}: ${condition}.`)
  }

  for (let i = 0; i < days.length; i++) {
    const day = days[i]!
    const range = spokenRange(day)
    if (!range) continue
    const name = capitalize(dayName(day.date, i))
    if (i === 0) {
      const sameAsNow = day.condition === condition
      sentences.push(
        sameAsNow
          ? `${name}, ${range}.`
          : `${name} looks ${day.condition}, with ${range}.`,
      )
    } else {
      sentences.push(`${name}: ${day.condition}, with ${range}.`)
    }
  }

  return sentences.join(' ')
}

export async function fetchWeatherItem(
  location: string,
  signal?: AbortSignal,
): Promise<WebItem> {
  const queries = queryCandidates(location)
  if (!queries.length) {
    throw new Error('Add a location in Profile to fetch weather.')
  }

  let hit: GeoResult | undefined
  for (const q of queries) {
    const geo = await fetchJson<GeoResponse>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
      combinedSignal(signal, 12_000),
    )
    hit = geo.results?.[0]
    if (hit) break
  }
  if (!hit) throw new Error(`Could not geocode “${location.trim()}”.`)

  const fahrenheit = useFahrenheit()
  const unit = fahrenheit ? 'fahrenheit' : 'celsius'
  const suffix = fahrenheit ? '°F' : '°C'
  const forecast = await fetchJson<ForecastResponse>(
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=${FORECAST_DAYS}&temperature_unit=${unit}`,
    combinedSignal(signal, 12_000),
  )

  const temp = finite(forecast.current?.temperature_2m)
  const code = forecast.current?.weather_code
  const condition = conditionLabel(code)
  const days = parseDaily(forecast)
  const place = placeLabel(hit)
  const forecastRows = buildForecast(temp, condition, days, suffix)
  const spokenText = buildSpokenText(place, temp, condition, days, fahrenheit)

  return {
    id: itemId('weather', place),
    source: 'weather',
    title: `Weather in ${place}`,
    blurb: buildBlurb(forecastRows),
    spokenText,
    ...(forecastRows.length ? { forecast: forecastRows } : {}),
  }
}
