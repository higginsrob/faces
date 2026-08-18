export type LocalClock = {
  weekdayDate: string
  time: string
  timeZone: string
  line: string
}

export function formatLocalClock(date = new Date()): LocalClock {
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'
  const weekdayDate = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
  return {
    weekdayDate,
    time,
    timeZone,
    line: `${weekdayDate}, ${time} (${timeZone})`,
  }
}
