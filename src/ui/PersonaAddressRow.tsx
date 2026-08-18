import {
  cancelAddressAuto,
  respondToAddress,
  type AddressStatus,
} from '../chat/session'
import { getPersonaById } from '../personas/store'

export function PersonaAddressRow({
  messageId,
  personaIds,
  status,
}: {
  messageId: string
  personaIds: string[]
  status?: AddressStatus
}) {
  const personas = personaIds
    .map((id) => getPersonaById(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
  if (!personas.length) return null

  const label = personas
    .map((p) => `${p.defaultFace} ${p.name}`.trim())
    .join(', ')

  return (
    <div className="persona-address">
      <span className="persona-address-title" title={label}>
        {label}
      </span>
      {status === 'auto' ? (
        <button
          type="button"
          className="persona-address-cancel"
          title="Cancel the automatic reply"
          onClick={() => cancelAddressAuto(messageId)}
        >
          Cancel
        </button>
      ) : null}
      {status === 'respond' ? (
        <button
          type="button"
          className="persona-address-respond"
          title="Let them reply"
          onClick={() => respondToAddress(messageId)}
        >
          Respond
        </button>
      ) : null}
    </div>
  )
}
