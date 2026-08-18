import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Group, Mesh } from 'three'
import { Vector3 } from 'three'
import { EMOTIONS } from '../emotions/catalog'
import type { ViewMode } from '../chat/session'
import { createCushionGeometry } from './cushionGeometry'
import { useEmojiTexture } from './emojiTexture'
import {
  FACE_FLY_DURATION,
  HERO_BULGE,
  HERO_LAYER,
  HERO_SEGMENTS,
  HERO_SIZE,
  HERO_TEXTURE_SIZE,
  SELECTED_POSE,
  WALL_BULGE,
  WALL_FACE_SIZE,
  WALL_SCALE,
  WALL_SEGMENTS,
  WALL_TEXTURE_SIZE,
  wallSlot,
  type Pose,
} from './faceLayout'
import { easeInOutSlowStart, lerp } from './anim'

const WALL_CLICK_DRAG_PX = 10

export function Faces({
  viewMode,
  selectedEmoji,
  heroEmoji,
  onHoverEmoji,
  onSelectedSettled,
  onSelectEmoji,
}: {
  viewMode: ViewMode
  selectedEmoji: string
  heroEmoji: string
  onHoverEmoji: (emoji: string | null) => void
  onSelectedSettled: (settled: boolean) => void
  onSelectEmoji: (emoji: string) => void
}) {
  const heroGeo = useMemo(
    () => createCushionGeometry(HERO_SIZE, HERO_SEGMENTS, HERO_BULGE),
    [],
  )
  const wallGeo = useMemo(
    () => createCushionGeometry(WALL_FACE_SIZE, WALL_SEGMENTS, WALL_BULGE),
    [],
  )
  useEffect(() => {
    return () => {
      heroGeo.dispose()
      wallGeo.dispose()
    }
  }, [heroGeo, wallGeo])

  useEffect(() => {
    if (viewMode !== 'gallery') document.body.style.cursor = ''
  }, [viewMode])

  return (
    <group>
      {EMOTIONS.map((emotion, index) => (
        <CatalogFace
          key={emotion.id}
          emoji={emotion.emoji}
          index={index}
          viewMode={viewMode}
          selectedEmoji={selectedEmoji}
          heroEmoji={heroEmoji}
          heroGeo={heroGeo}
          wallGeo={wallGeo}
          onHoverEmoji={onHoverEmoji}
          onSelectedSettled={onSelectedSettled}
          onSelectEmoji={onSelectEmoji}
        />
      ))}
    </group>
  )
}

function destPose(focusedHero: boolean, index: number): Pose {
  return focusedHero ? SELECTED_POSE : wallSlot(index)
}

function CatalogFace({
  emoji,
  index,
  viewMode,
  selectedEmoji,
  heroEmoji,
  heroGeo,
  wallGeo,
  onHoverEmoji,
  onSelectedSettled,
  onSelectEmoji,
}: {
  emoji: string
  index: number
  viewMode: ViewMode
  selectedEmoji: string
  heroEmoji: string
  heroGeo: ReturnType<typeof createCushionGeometry>
  wallGeo: ReturnType<typeof createCushionGeometry>
  onHoverEmoji: (emoji: string | null) => void
  onSelectedSettled: (settled: boolean) => void
  onSelectEmoji: (emoji: string) => void
}) {
  const group = useRef<Group>(null)
  const mesh = useRef<Mesh>(null)
  const downRef = useRef<{ x: number; y: number; id: number } | null>(null)
  const isSelected = emoji === selectedEmoji
  const focusedHero = viewMode === 'focused' && isSelected
  const dest = destPose(focusedHero, index)
  const displayEmoji = focusedHero ? heroEmoji : emoji
  const texSize = focusedHero ? HERO_TEXTURE_SIZE : WALL_TEXTURE_SIZE
  const faceMap = useEmojiTexture(displayEmoji, texSize)
  const [heroMesh, setHeroMesh] = useState(focusedHero)
  const fromPos = useRef(new Vector3())
  const fromScale = useRef(focusedHero ? 1 : WALL_SCALE)
  const elapsed = useRef(0)
  const flying = useRef(false)
  const destRef = useRef(dest)
  const heroMeshRef = useRef(heroMesh)
  heroMeshRef.current = heroMesh

  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    g.position.copy(dest.position)
    g.scale.setScalar(1)
  }, [])

  useLayoutEffect(() => {
    mesh.current?.layers.set(focusedHero ? HERO_LAYER : 0)
  }, [focusedHero])

  useEffect(() => {
    const g = group.current
    if (!g) return
    const prev = destRef.current
    destRef.current = dest
    if (prev === dest) return
    fromPos.current.copy(g.position)
    if (!heroMeshRef.current) g.scale.setScalar(WALL_SCALE)
    fromScale.current = g.scale.x
    elapsed.current = 0
    flying.current = true
    setHeroMesh(true)
    if (isSelected) onSelectedSettled(false)
  }, [dest, isSelected, onSelectedSettled])

  useFrame((state, dt) => {
    const g = group.current
    if (!g) return
    const pose = destRef.current
    const t = state.clock.elapsedTime

    if (flying.current) {
      elapsed.current += dt
      const u = easeInOutSlowStart(elapsed.current / FACE_FLY_DURATION)
      g.position.lerpVectors(fromPos.current, pose.position, u)
      g.scale.setScalar(lerp(fromScale.current, pose.scale, u))
      if (elapsed.current >= FACE_FLY_DURATION) {
        g.position.copy(pose.position)
        flying.current = false
        if (pose === SELECTED_POSE) {
          g.scale.setScalar(1)
          setHeroMesh(true)
        } else {
          g.scale.setScalar(WALL_SCALE)
          setHeroMesh(false)
        }
        if (isSelected) onSelectedSettled(true)
      }
    } else if (focusedHero) {
      g.position.x = SELECTED_POSE.position.x
      g.position.y = SELECTED_POSE.position.y + Math.sin(t * 0.7) * 0.03
      g.position.z = SELECTED_POSE.position.z
      g.scale.setScalar(1)
    } else {
      g.position.copy(pose.position)
      g.scale.setScalar(heroMesh ? WALL_SCALE : 1)
    }

    if (mesh.current) {
      mesh.current.layers.set(focusedHero ? HERO_LAYER : 0)
      mesh.current.rotation.y =
        focusedHero && !flying.current ? Math.sin(t * 0.35) * 0.08 : 0
    }
  })

  return (
    <group ref={group}>
      {focusedHero ? (
        <pointLight
          position={[0, 0.2, 1.85]}
          intensity={2.1}
          distance={7}
          decay={2}
        />
      ) : null}
      <mesh
        ref={mesh}
        geometry={heroMesh ? heroGeo : wallGeo}
        castShadow={focusedHero}
        receiveShadow={false}
        onPointerOver={(e) => {
          if (viewMode !== 'gallery') return
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
          onHoverEmoji(emoji)
        }}
        onPointerOut={() => {
          document.body.style.cursor = ''
          if (viewMode === 'gallery') onHoverEmoji(null)
        }}
        onPointerDown={(e) => {
          if (viewMode !== 'gallery') return
          downRef.current = {
            x: e.clientX,
            y: e.clientY,
            id: e.pointerId,
          }
        }}
        onPointerUp={(e) => {
          const down = downRef.current
          downRef.current = null
          if (viewMode !== 'gallery' || !down || down.id !== e.pointerId) return
          const dx = e.clientX - down.x
          const dy = e.clientY - down.y
          if (dx * dx + dy * dy > WALL_CLICK_DRAG_PX * WALL_CLICK_DRAG_PX) {
            return
          }
          e.stopPropagation()
          onSelectEmoji(emoji)
        }}
      >
        <meshStandardMaterial
          map={faceMap}
          roughness={0.42}
          metalness={0.04}
          transparent
          alphaTest={0.08}
          depthWrite
        />
      </mesh>
    </group>
  )
}
