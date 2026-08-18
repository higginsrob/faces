import { Vector3 } from 'three'
import { EMOTIONS } from '../emotions/catalog'

export const ROOM_W = 10.5
export const ROOM_H = 6.2
export const ROOM_D = 7

export const WALL_Z = -ROOM_D / 2
export const FACE_Z = WALL_Z + 0.12

export const HERO_SIZE = 1.64
export const HERO_SEGMENTS = 80
export const HERO_BULGE = 0.5

export const WALL_FACE_SIZE = 0.72
export const WALL_SEGMENTS = 32
export const WALL_BULGE = 0.22
export const WALL_SCALE = WALL_FACE_SIZE / HERO_SIZE

export const GRID_COLS = 9
export const GRID_ROWS = 6
export const GRID_WIDTH = 8.6
export const GRID_HEIGHT = 5.2

export type Pose = {
  position: Vector3
  scale: number
}

export const SELECTED_POSE: Pose = {
  position: new Vector3(0, 0.82, 0),
  scale: 1,
}

const CELL_W = GRID_WIDTH / GRID_COLS
const CELL_H = GRID_HEIGHT / GRID_ROWS
const GRID_ORIGIN_X = -GRID_WIDTH / 2 + CELL_W / 2
const GRID_ORIGIN_Y = ROOM_H - 0.5 - CELL_H / 2

const wallSlots: Pose[] = EMOTIONS.map((_, index) => {
  const col = index % GRID_COLS
  const row = Math.floor(index / GRID_COLS)
  return {
    position: new Vector3(
      GRID_ORIGIN_X + col * CELL_W,
      GRID_ORIGIN_Y - row * CELL_H,
      FACE_Z,
    ),
    scale: WALL_SCALE,
  }
})

export function wallSlot(index: number): Pose {
  return wallSlots[index] ?? wallSlots[0]!
}

export function wallSlotForEmoji(emoji: string): Pose | undefined {
  const index = EMOTIONS.findIndex((e) => e.emoji === emoji)
  if (index < 0) return undefined
  return wallSlots[index]
}

export const WALL_LOOK_AT = new Vector3(0, GRID_ORIGIN_Y - GRID_HEIGHT / 2 + CELL_H / 2, FACE_Z)

export const CAM_HOME = new Vector3(0, 1.35, 5.05)
export const LOOK_AT = new Vector3(0, 0.92, 0)
export const CAM_FOV = 32

export const GALLERY_CAM = new Vector3(0, WALL_LOOK_AT.y, 4.35)
export const GALLERY_FOV = 50
export const WALL_TARGET: [number, number, number] = [
  WALL_LOOK_AT.x,
  WALL_LOOK_AT.y,
  WALL_LOOK_AT.z,
]
export const CAM_HOME_TUPLE: [number, number, number] = [
  CAM_HOME.x,
  CAM_HOME.y,
  CAM_HOME.z,
]
export const GALLERY_CAM_TUPLE: [number, number, number] = [
  GALLERY_CAM.x,
  GALLERY_CAM.y,
  GALLERY_CAM.z,
]

export const FACE_FLY_DURATION = 0.85
export const CAM_FLY_DURATION = 1.05

export const HERO_LAYER = 1

export const WALL_TEXTURE_SIZE = 512
export const HERO_TEXTURE_SIZE = 2048
