import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PerspectiveCamera, Spherical, Vector3 } from 'three'
import type { ViewMode } from '../chat/session'
import { clamp, easeInOutSlowStart, lerp } from './anim'
import {
  CAM_FLY_DURATION,
  CAM_FOV,
  CAM_HOME,
  GALLERY_CAM,
  GALLERY_FOV,
  LOOK_AT,
  WALL_LOOK_AT,
  WALL_TARGET,
} from './faceLayout'

const AZIMUTH_LIMIT = 0.28
const POLAR_DELTA = 0.16
const MIN_DISTANCE = 3.45
const MAX_DISTANCE = 5.35
const RETURN_DURATION = 2.6
const ROTATE_SPEED = 0.0045
const SETTLE_MS = 140
const VIEW_SHIFT = 0.2

function sphericalFromHome() {
  const s = new Spherical()
  s.setFromVector3(CAM_HOME.clone().sub(LOOK_AT))
  return s
}

type Fly = {
  fromPos: Vector3
  fromLook: Vector3
  fromFov: number
  toPos: Vector3
  toLook: Vector3
  toFov: number
  elapsed: number
}

export function SceneCameras({ viewMode }: { viewMode: ViewMode }) {
  const [lookOn, setLookOn] = useState(viewMode === 'focused')
  const [mapOn, setMapOn] = useState(viewMode === 'gallery')
  const flying = useRef(false)
  const fly = useRef<Fly | null>(null)
  const lookAt = useRef(
    (viewMode === 'gallery' ? WALL_LOOK_AT : LOOK_AT).clone(),
  )
  const mode = useRef(viewMode)

  useEffect(() => {
    if (mode.current === viewMode) return
    mode.current = viewMode
    setLookOn(false)
    setMapOn(false)
    fly.current = null
    flying.current = true
  }, [viewMode])

  return (
    <>
      <CameraRig
        viewMode={viewMode}
        flying={flying}
        fly={fly}
        lookAt={lookAt}
        onArrive={(mode) => {
          if (mode === 'gallery') setMapOn(true)
          else setLookOn(true)
        }}
      />
      <LookAroundCamera active={lookOn} />
      <FocusedViewOffset on={viewMode === 'focused'} />
      {mapOn ? (
        <MapControls
          makeDefault={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={3.2}
          maxDistance={10}
          minPolarAngle={0.35}
          maxPolarAngle={Math.PI / 2 + 0.35}
          target={WALL_TARGET}
        />
      ) : null}
    </>
  )
}

function CameraRig({
  viewMode,
  flying,
  fly,
  lookAt,
  onArrive,
}: {
  viewMode: ViewMode
  flying: { current: boolean }
  fly: { current: Fly | null }
  lookAt: { current: Vector3 }
  onArrive: (mode: ViewMode) => void
}) {
  const camera = useThree((s) => s.camera)
  const startMode = useRef(viewMode)

  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return
    const gallery = startMode.current === 'gallery'
    camera.position.copy(gallery ? GALLERY_CAM : CAM_HOME)
    lookAt.current.copy(gallery ? WALL_LOOK_AT : LOOK_AT)
    camera.fov = gallery ? GALLERY_FOV : CAM_FOV
    camera.updateProjectionMatrix()
    camera.lookAt(lookAt.current)
  }, [camera, lookAt])

  useFrame((_, dt) => {
    if (!flying.current) return
    if (!(camera instanceof PerspectiveCamera)) return

    if (!fly.current) {
      fly.current = {
        fromPos: camera.position.clone(),
        fromLook: lookAt.current.clone(),
        fromFov: camera.fov,
        toPos: (viewMode === 'gallery' ? GALLERY_CAM : CAM_HOME).clone(),
        toLook: (viewMode === 'gallery' ? WALL_LOOK_AT : LOOK_AT).clone(),
        toFov: viewMode === 'gallery' ? GALLERY_FOV : CAM_FOV,
        elapsed: 0,
      }
    }

    const f = fly.current
    f.elapsed += dt
    const u = easeInOutSlowStart(f.elapsed / CAM_FLY_DURATION)
    camera.position.set(
      lerp(f.fromPos.x, f.toPos.x, u),
      lerp(f.fromPos.y, f.toPos.y, u),
      lerp(f.fromPos.z, f.toPos.z, u),
    )
    lookAt.current.set(
      lerp(f.fromLook.x, f.toLook.x, u),
      lerp(f.fromLook.y, f.toLook.y, u),
      lerp(f.fromLook.z, f.toLook.z, u),
    )
    camera.fov = lerp(f.fromFov, f.toFov, u)
    camera.updateProjectionMatrix()
    camera.lookAt(lookAt.current)

    if (f.elapsed >= CAM_FLY_DURATION) {
      camera.position.copy(f.toPos)
      lookAt.current.copy(f.toLook)
      camera.fov = f.toFov
      camera.updateProjectionMatrix()
      camera.lookAt(lookAt.current)
      fly.current = null
      flying.current = false
      queueMicrotask(() => onArrive(viewMode))
    }
  })

  return null
}

function FocusedViewOffset({ on }: { on: boolean }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return
    if (!on) {
      camera.clearViewOffset()
      return
    }
    camera.setViewOffset(
      size.width,
      size.height,
      0,
      size.height * VIEW_SHIFT,
      size.width,
      size.height,
    )
    return () => camera.clearViewOffset()
  }, [camera, size.width, size.height, on])
  return null
}

function LookAroundCamera({ active }: { active: boolean }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const spherical = useRef(sphericalFromHome())
  const home = useRef(sphericalFromHome())
  const offset = useRef(new Vector3())
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef(0)
  const holding = useRef(false)
  const lastInput = useRef(0)
  const returning = useRef(false)
  const returnElapsed = useRef(0)
  const returnFrom = useRef({ theta: 0, phi: 0, radius: 0 })

  useEffect(() => {
    if (active) spherical.current = sphericalFromHome()
  }, [active])

  useEffect(() => {
    const el = gl.domElement
    const minPhi = home.current.phi - POLAR_DELTA
    const maxPhi = home.current.phi + POLAR_DELTA

    const pinchDistance = () => {
      const pts = [...pointers.current.values()]
      if (pts.length < 2) return 0
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
    }

    const onDown = (e: PointerEvent) => {
      if (!active) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      holding.current = true
      if (pointers.current.size === 2) pinch.current = pinchDistance()
    }

    const onMove = (e: PointerEvent) => {
      if (!active) return
      const prev = pointers.current.get(e.pointerId)
      if (!prev) return
      const next = { x: e.clientX, y: e.clientY }
      if (pointers.current.size === 2) {
        pointers.current.set(e.pointerId, next)
        const dist = pinchDistance()
        if (pinch.current > 0 && dist > 0) {
          spherical.current.radius = clamp(
            spherical.current.radius * (pinch.current / dist),
            MIN_DISTANCE,
            MAX_DISTANCE,
          )
        }
        pinch.current = dist
        return
      }
      spherical.current.theta = clamp(
        spherical.current.theta - (next.x - prev.x) * ROTATE_SPEED,
        -AZIMUTH_LIMIT,
        AZIMUTH_LIMIT,
      )
      spherical.current.phi = clamp(
        spherical.current.phi - (next.y - prev.y) * ROTATE_SPEED,
        minPhi,
        maxPhi,
      )
      pointers.current.set(e.pointerId, next)
    }

    const onUp = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId)
      pinch.current = 0
      if (pointers.current.size === 0) {
        holding.current = false
        lastInput.current = performance.now()
      }
    }

    const onWheel = (e: WheelEvent) => {
      if (!active) return
      e.preventDefault()
      lastInput.current = performance.now()
      spherical.current.radius = clamp(
        spherical.current.radius + Math.sign(e.deltaY) * 0.18,
        MIN_DISTANCE,
        MAX_DISTANCE,
      )
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl, active])

  useFrame((_, dt) => {
    if (!active) return
    if (!(camera instanceof PerspectiveCamera)) return

    const s = spherical.current
    const h = home.current
    const canReturn =
      !holding.current && performance.now() - lastInput.current > SETTLE_MS

    if (!canReturn) {
      returning.current = false
    } else if (!returning.current) {
      const away =
        Math.abs(s.theta - h.theta) +
        Math.abs(s.phi - h.phi) +
        Math.abs(s.radius - h.radius)
      if (away > 1e-4) {
        returnFrom.current = { theta: s.theta, phi: s.phi, radius: s.radius }
        returnElapsed.current = 0
        returning.current = true
      }
    }

    if (returning.current) {
      returnElapsed.current += dt
      const u = easeInOutSlowStart(returnElapsed.current / RETURN_DURATION)
      const from = returnFrom.current
      s.theta = lerp(from.theta, h.theta, u)
      s.phi = lerp(from.phi, h.phi, u)
      s.radius = lerp(from.radius, h.radius, u)
      if (returnElapsed.current >= RETURN_DURATION) {
        s.theta = h.theta
        s.phi = h.phi
        s.radius = h.radius
        returning.current = false
      }
    }

    offset.current.setFromSpherical(s)
    camera.position.copy(LOOK_AT).add(offset.current)
    camera.lookAt(LOOK_AT)
    if (camera.fov !== CAM_FOV) {
      camera.fov = CAM_FOV
      camera.updateProjectionMatrix()
    }
  })

  return null
}
