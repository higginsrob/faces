export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function easeInOutSlowStart(t: number) {
  const x = clamp(t, 0, 1)
  if (x < 0.5) return 16 * x * x * x * x * x
  return 1 - (-2 * x + 2) ** 5 / 2
}
