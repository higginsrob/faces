import { useFrame, useThree } from '@react-three/fiber'
import { DepthOfField, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode, type DepthOfFieldEffect } from 'postprocessing'
import { useEffect, useMemo, useRef } from 'react'
import {
  ACESFilmicToneMapping,
  type Camera,
  type Light,
  type Object3D,
} from 'three'
import type { ViewMode } from '../chat/session'
import { easeInOutSlowStart, lerp } from './anim'
import {
  FACE_FLY_DURATION,
  HERO_LAYER,
  SELECTED_POSE,
  WALL_LOOK_AT,
} from './faceLayout'

const MAX_BOKEH = 6.4
const FOCUS_RANGE = 1.45
const WIDE_FOCUS_RANGE = 12

function isLight(obj: Object3D): obj is Light {
  return (obj as Light).isLight
}

function isCameraObj(obj: Object3D): obj is Camera {
  return (obj as Camera).isCamera
}

export function Bokeh({ viewMode }: { viewMode: ViewMode }) {
  const dof = useRef<DepthOfFieldEffect>(null)
  const amount = useRef(viewMode === 'focused' ? 1 : 0)
  const from = useRef(amount.current)
  const dest = useRef(amount.current)
  const elapsed = useRef(0)
  const flying = useRef(false)
  const focusTarget = useMemo(() => SELECTED_POSE.position.clone(), [])
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const overlay = viewMode === 'focused'

  useEffect(() => {
    const next = viewMode === 'focused' ? 1 : 0
    from.current = amount.current
    dest.current = next
    elapsed.current = 0
    flying.current = Math.abs(from.current - next) > 1e-4
  }, [viewMode])

  useFrame((_, dt) => {
    camera.layers.set(0)
    scene.traverse((obj) => {
      if (isLight(obj)) obj.layers.enable(HERO_LAYER)
      if (isCameraObj(obj) && obj !== camera) obj.layers.enable(HERO_LAYER)
    })

    if (flying.current) {
      elapsed.current += dt
      const u = easeInOutSlowStart(elapsed.current / FACE_FLY_DURATION)
      amount.current = lerp(from.current, dest.current, u)
      if (elapsed.current >= FACE_FLY_DURATION) {
        amount.current = dest.current
        flying.current = false
      }
    }

    const effect = dof.current
    if (!effect) return

    const a = amount.current
    focusTarget.set(
      lerp(WALL_LOOK_AT.x, SELECTED_POSE.position.x, a),
      lerp(WALL_LOOK_AT.y, SELECTED_POSE.position.y, a),
      lerp(WALL_LOOK_AT.z, SELECTED_POSE.position.z, a),
    )
    if (effect.target && effect.target !== focusTarget) {
      effect.target.copy(focusTarget)
    }
    effect.bokehScale = a * MAX_BOKEH
    effect.cocMaterial.focusRange = lerp(WIDE_FOCUS_RANGE, FOCUS_RANGE, a)
  })

  useFrame(() => {
    if (!overlay) return
    const prevAutoClear = gl.autoClear
    const prevTone = gl.toneMapping
    const background = scene.background
    gl.autoClear = false
    gl.toneMapping = ACESFilmicToneMapping
    scene.background = null
    camera.layers.set(HERO_LAYER)
    gl.clear(false, true, false)
    gl.render(scene, camera)
    camera.layers.set(0)
    scene.background = background
    gl.toneMapping = prevTone
    gl.autoClear = prevAutoClear
  }, 2)

  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <DepthOfField
        ref={dof}
        target={focusTarget}
        focusRange={FOCUS_RANGE}
        bokehScale={MAX_BOKEH}
        resolutionScale={0.55}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
