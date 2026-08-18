import { ROOM_D, ROOM_H, ROOM_W } from './faceLayout'

const WALL = '#d4d4d4'
const FLOOR = '#c8c8c8'
const CEILING = '#e4e4e4'

export function RoomBox() {
  const y = ROOM_H / 2
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color={FLOOR} roughness={0.92} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOM_H, 0]} receiveShadow>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color={CEILING} roughness={1} />
      </mesh>
      <mesh position={[0, y, -ROOM_D / 2]} receiveShadow>
        <planeGeometry args={[ROOM_W, ROOM_H]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-ROOM_W / 2, y, 0]} receiveShadow>
        <planeGeometry args={[ROOM_D, ROOM_H]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[ROOM_W / 2, y, 0]} receiveShadow>
        <planeGeometry args={[ROOM_D, ROOM_H]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
    </group>
  )
}
