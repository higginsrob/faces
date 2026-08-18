import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { Group, SpotLight } from 'three'
import { Vector3 } from 'three'
import { lerp } from './anim'
import { FACE_Z, wallSlotForEmoji } from './faceLayout'

export function WallSpotlight({ emoji }: { emoji: string | null }) {
  const group = useRef<Group>(null)
  const spot = useRef<SpotLight>(null)
  const aim = useMemo(() => new Vector3(0, 3.1, FACE_Z), [])
  const level = useRef(0)

  useLayoutEffect(() => {
    const s = spot.current
    const g = group.current
    if (!s || !g) return
    if (s.target.parent !== g) g.add(s.target)
    s.target.position.set(0, 0, 0)
  }, [])

  useFrame((_, dt) => {
    const slot = emoji ? wallSlotForEmoji(emoji) : undefined
    if (slot) aim.lerp(slot.position, 1 - Math.exp(-dt * 10))
    const want = slot ? 1 : 0
    level.current = lerp(level.current, want, 1 - Math.exp(-dt * 7))
    const k = level.current
    if (group.current) group.current.position.copy(aim)
    const s = spot.current
    const g = group.current
    if (s && g) {
      if (s.target.parent !== g) g.add(s.target)
      s.target.position.set(0, 0, 0)
      s.target.updateMatrixWorld()
      s.intensity = 2.1 * k
      s.visible = k > 0.02
    }
  })

  return (
    <group ref={group}>
      <spotLight
        ref={spot}
        position={[0, 0.78, 1.85]}
        angle={0.28}
        penumbra={0.04}
        distance={8}
        decay={2}
        color="#fff8dc"
        castShadow={false}
      />
    </group>
  )
}
