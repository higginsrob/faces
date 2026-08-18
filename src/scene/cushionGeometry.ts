import { PlaneGeometry } from 'three'

/**
 * Square patch with a circular bulge in the center — a spherical cap that
 * eases into a flat brim. Emoji textures map across the full square, so
 * horns, hair, and cheeks in the corners stay on camera instead of wrapping
 * around a sphere.
 */
export function createCushionGeometry(
  size: number,
  segments: number,
  bulgeHeight: number,
): PlaneGeometry {
  const geo = new PlaneGeometry(size, size, segments, segments)
  const pos = geo.attributes.position
  const radius = size / 2
  const sphereRadius = (radius * radius + bulgeHeight * bulgeHeight) / (2 * bulgeHeight)
  const sphereOffset = sphereRadius - bulgeHeight
  const fadeStart = 0.88

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const u = Math.hypot(x, y) / radius
    if (u >= 1) continue

    const cap =
      Math.sqrt(Math.max(0, sphereRadius * sphereRadius - (u * radius) ** 2)) - sphereOffset
    let weight = 1
    if (u > fadeStart) {
      const t = (u - fadeStart) / (1 - fadeStart)
      weight = 1 - t * t * (3 - 2 * t)
    }
    pos.setZ(i, cap * weight)
  }

  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}
