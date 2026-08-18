import type { WebItem } from '../types'
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
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
  }
}

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
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1&temperature_unit=${unit}`,
    combinedSignal(signal, 12_000),
  )

  const temp = forecast.current?.temperature_2m
  const code = forecast.current?.weather_code
  const high = forecast.daily?.temperature_2m_max?.[0]
  const low = forecast.daily?.temperature_2m_min?.[0]
  const place = placeLabel(hit)
  const parts = [
    temp != null && Number.isFinite(temp)
      ? `${Math.round(temp)}${suffix}, ${conditionLabel(code)}`
      : conditionLabel(code),
  ]
  if (high != null && low != null) {
    parts.push(`High ${Math.round(high)}${suffix}, low ${Math.round(low)}${suffix}`)
  }

  return {
    id: itemId('weather', place),
    source: 'weather',
    title: `Weather in ${place}`,
    blurb: clip(parts.join('. ') + '.'),
  }
}
