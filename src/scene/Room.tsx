import { ContactShadows } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Color, type Camera, type Group } from 'three'
import type { ViewMode } from '../chat/session'
import { Bokeh } from './Bokeh'
import { Faces } from './Faces'
import {
  CAM_FOV,
  CAM_HOME_TUPLE,
  GALLERY_CAM_TUPLE,
  GALLERY_FOV,
  HERO_LAYER,
} from './faceLayout'
import { RoomBox } from './RoomBox'
import { SceneCameras } from './SceneCameras'
import { WallSpotlight } from './WallSpotlight'

const SHADOW_CLEAR = new Color(0x000000)

function HeroContactShadows() {
  const gl = useThree((s) => s.gl)
  const group = useRef<Group>(null)
  const savedColor = useRef(new Color())
  const savedAlpha = useRef(1)

  useFrame(() => {
    gl.getClearColor(savedColor.current)
    savedAlpha.current = gl.getClearAlpha()
    gl.autoClear = true
    gl.setClearColor(SHADOW_CLEAR, 0)
    const root = group.current
    if (!root) return
    for (const child of root.children) {
      if ((child as Camera).isCamera) child.layers.set(HERO_LAYER)
    }
  }, -1)

  useFrame(() => {
    gl.setClearColor(savedColor.current, savedAlpha.current)
  }, 0.5)

  return (
    <ContactShadows
      ref={group}
      position={[0, 0.01, 0]}
      opacity={0.38}
      scale={10}
      blur={2.4}
      far={4}
    />
  )
}

export function RoomScene({
  viewMode,
  selectedEmoji,
  heroEmoji,
  highlightedEmoji,
  onSelectEmoji,
}: {
  viewMode: ViewMode
  selectedEmoji: string
  heroEmoji: string
  highlightedEmoji: string | null
  onSelectEmoji: (emoji: string) => void
}) {
  const [faceSettled, setFaceSettled] = useState(true)
  const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null)
  const skipSettleReset = useRef(true)
  const settledRef = useCallback((settled: boolean) => {
    setFaceSettled(settled)
  }, [])

  useEffect(() => {
    if (skipSettleReset.current) {
      skipSettleReset.current = false
      return
    }
    setFaceSettled(false)
  }, [viewMode, selectedEmoji])

  useEffect(() => {
    if (viewMode !== 'gallery') setHoveredEmoji(null)
  }, [viewMode])

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{
        position: viewMode === 'gallery' ? GALLERY_CAM_TUPLE : CAM_HOME_TUPLE,
        fov: viewMode === 'gallery' ? GALLERY_FOV : CAM_FOV,
        near: 0.1,
        far: 60,
      }}
      gl={{ antialias: true, alpha: false }}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
    >
      <color attach="background" args={['#cfcfcf']} />
      <ambientLight intensity={0.78} />
      <directionalLight
        position={[2.8, 6.4, 3.6]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[-2.6, 3.2, 2.2]} intensity={0.28} />
      <RoomBox />
      <Faces
        viewMode={viewMode}
        selectedEmoji={selectedEmoji}
        heroEmoji={heroEmoji}
        onHoverEmoji={setHoveredEmoji}
        onSelectedSettled={settledRef}
        onSelectEmoji={onSelectEmoji}
      />
      <WallSpotlight
        emoji={
          viewMode === 'gallery' ? (hoveredEmoji ?? highlightedEmoji) : null
        }
      />
      {viewMode === 'focused' && faceSettled ? <HeroContactShadows /> : null}
      <SceneCameras viewMode={viewMode} />
      <Bokeh viewMode={viewMode} />
    </Canvas>
  )
}
