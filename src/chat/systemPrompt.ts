import { findEmotionByEmoji } from '../emotions/catalog'
import { SHARED_PERSONA_RULES } from '../personas/builtins'
import { getPersonas } from '../personas/store'
import { describePersonaVoice, type Persona } from '../personas/types'
import { getUserProfile } from '../profile/store'
import {
  parseAgeYears,
  profileHasAny,
  TALK_STYLES,
  type UserProfile,
} from '../profile/types'
import { formatWebContext } from '../web/context'

export function buildSystemPrompt(
  persona: Persona,
  opts?: { emotionProtocol?: boolean; topicPriority?: 'newspaper' },
): string {
  const parts = [persona.systemPrompt.trim(), roomProtocol(persona)]
  const selfVoice = selfVoiceBlock(persona)
  if (selfVoice) parts.push(selfVoice)
  const roster = roomRoster(persona)
  if (roster) parts.push(roster)
  const profileBlock = formatUserProfileContext(getUserProfile())
  if (profileBlock) parts.push(profileBlock)
  const webBlock = formatWebContext({ topicPriority: opts?.topicPriority })
  if (webBlock) parts.push(webBlock)
  if (opts?.emotionProtocol !== false) parts.push(emotionProtocol(persona))
  return parts.join('\n\n')
}

function roomProtocol(persona: Persona): string {
  const name = persona.name.trim() || 'this face'
  return `SHARED ROOM
You are ${name}. You are one face in a shared room. Other faces may already have answered the user. Their lines show up as notes labeled "Not you — <name> already answered". Those notes are not your words and not the user's words.
- Reply only as ${name}, in your own voice.
- Never prefix your reply with a name or parentheses such as "(Clue)" or "(${name})".
- Never speak as another face, never announce who is talking, and never continue their turn for them.
- You may address another face by name when you want them to answer next.`
}

function selfVoiceBlock(persona: Persona): string {
  const voice = describePersonaVoice(persona)
  if (!voice) return ''
  return `YOUR VOICE
When you speak aloud, you sound like ${voice}. That is how you hear yourself and how the other faces hear you. Stay consistent with that voice; do not claim a different age, gender, or accent.`
}

function rosterBlurb(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed.endsWith(SHARED_PERSONA_RULES)) {
    return trimmed.slice(0, trimmed.length - SHARED_PERSONA_RULES.length).trim()
  }
  return trimmed
}

function roomRoster(persona: Persona): string {
  const others = getPersonas().filter((p) => p.id !== persona.id)
  if (!others.length) return ''
  const lines = others.map((p) => {
    const name = p.name.trim() || 'Face'
    const voice = describePersonaVoice(p)
    const head = voice
      ? `${p.defaultFace} ${name} — sounds like ${voice}`
      : `${p.defaultFace} ${name}`
    const blurb = rosterBlurb(p.systemPrompt)
    return blurb ? `${head}. ${blurb}` : head
  })
  return `FACES IN THE ROOM
You share this wall with these other faces. Address one by name when you want them to answer next. Do not speak as them, never prefix your reply with a name, and never continue their turn.
${lines.join('\n')}`
}

function emotionProtocol(persona: Persona): string {
  return `EMOTION PROTOCOL
Start EVERY reply with exactly one line, then a newline, then your spoken text:
FACE: ${persona.defaultFace}

Use that exact FACE line. It is your face; do not pick a different emoji.
The FACE line is metadata. Never read it aloud, never explain it, never mention "FACE".
Spoken text must contain no emojis.
Do not put anything before the FACE line.`
}

export function formatUserProfileContext(profile: UserProfile): string {
  if (!profileHasAny(profile)) return ''

  const name = profile.name.trim()
  const title = profile.title.trim()
  const age = profile.age.trim()
  const gender = profile.gender.trim()
  const accent = profile.accent.trim()
  const location = profile.location.trim()
  const mood = profile.mood.trim()
  const education = profile.education.trim()
  const household = profile.household.trim()
  const religion = profile.religion.trim()
  const politics = profile.politics.trim()
  const talkStyle = profile.talkStyle.trim()
  const interests = profile.interests.trim()
  const talkLabel =
    TALK_STYLES.find((s) => s.value === talkStyle)?.label ?? talkStyle
  const years = parseAgeYears(age)
  const minor = years !== null && years < 18
  const useTalkStyle = Boolean(talkStyle) && !(talkStyle === 'roast' && minor)

  const lines: string[] = []
  if (name) lines.push(`- Name: ${name}`)
  if (title) lines.push(`- Title: ${title}`)
  if (age) lines.push(`- Age: ${age}`)
  if (gender) lines.push(`- Gender: ${gender}`)
  if (accent) lines.push(`- Accent: ${accent}`)
  if (location) lines.push(`- Location: ${location}`)
  if (education) lines.push(`- Education: ${education}`)
  if (household) lines.push(`- Household: ${household}`)
  if (religion) lines.push(`- Religion: ${religion}`)
  if (politics) lines.push(`- Politics: ${politics}`)
  if (useTalkStyle) lines.push(`- Preferred talk style: ${talkLabel}`)
  if (mood) {
    const emotion = findEmotionByEmoji(mood)
    lines.push(`- Mood: ${mood}${emotion ? ` (${emotion.label})` : ''}`)
  }

  const out: string[] = [
    'USER PROFILE',
    'The person you are talking to shared this about themselves. Treat it as private context: use it to shape tone, vocabulary, examples, and what you assume. Do not recite this list or mention that you were given a profile unless they bring it up.',
    ...lines,
  ]

  if (interests) {
    out.push(
      'Other facts they shared about themselves. Use these as background; do not recite them unless they come up:',
      interests,
    )
  }

  if (name) {
    out.push(`When a name is natural, call them ${name}. Do not overuse it.`)
  }

  const talkGuide = talkStyleGuide(talkStyle, minor)
  if (talkGuide) out.push(talkGuide)

  if (mood) {
    const emotion = findEmotionByEmoji(mood)
    const moodLabel = emotion ? `${mood} (${emotion.label})` : mood
    out.push(
      `They currently feel ${moodLabel}. Acknowledge that mood with care; do not dwell on it or force cheer.`,
    )
  }

  if (accent) {
    out.push(
      `They have a ${accent} accent. Keep that in mind; never mock speech or dialect.`,
    )
  }

  if (location) {
    out.push(
      `They are in ${location}. Use local context when it helps, without stereotyping.`,
    )
  }

  if (years !== null) {
    if (years < 13) {
      out.push(
        `This person is a child (age ${years}). Keep every reply age-appropriate for a ${years}-year-old: simple, kind language; no adult, sexual, violent, graphic, or scary content; no harmful advice. Explain things they can follow.`,
      )
    } else if (years < 18) {
      out.push(
        `This person is a teenager (age ${years}). Keep replies appropriate for a ${years}-year-old: no explicit sexual content, no graphic violence, and extra care with sensitive topics. Speak to them as a capable teen, not a little kid.`,
      )
    } else {
      out.push(
        `Adapt examples and references to an adult around age ${years}.`,
      )
    }
  } else if (age) {
    out.push(
      `Adapt language, topics, and examples to someone who is ${age}. If they are a child, keep replies age-appropriate.`,
    )
  }

  if (education) {
    out.push(
      `Highest education they listed: ${education}. Match vocabulary and how much you explain to that, without talking down or showing off.`,
    )
  }

  if (household) {
    out.push(
      `Household: ${household}. It is fine to ask after people or pets they named when it is natural. Do not invent extra family or assume roles they did not state.`,
    )
  }

  if (religion) {
    out.push(
      `Religion / worldview: ${religion}. Respect it. Do not preach, convert, mock, or bring it up unless it is relevant.`,
    )
  }

  if (politics) {
    out.push(
      `Political leaning, in their words: ${politics}. Use this for relevance when the topic comes up. Do not lecture, dunk, campaign, or flatten them into a stereotype. Do not assume they want a debate.`,
    )
  }

  return out.join('\n')
}

function talkStyleGuide(talkStyle: string, minor: boolean): string {
  switch (talkStyle) {
    case 'casual':
      return 'They prefer casual talk: informal, contractions, no stiff phrasing. Do not over-explain unless they ask.'
    case 'friendly':
      return 'They prefer a friendly, warm tone: conversational and easygoing, not distant or overly polished.'
    case 'formal':
      return 'They prefer a more formal register: complete sentences, little slang, professional but still human.'
    case 'roast':
      if (minor) return ''
      return 'They invited playful roasting. Tease with wit when it fits. Stay kind: never punch down on identity, appearance, trauma, or things they cannot change.'
    default:
      return talkStyle
        ? `They prefer to be talked to in a ${talkStyle} style. Follow that unless they ask otherwise.`
        : ''
  }
}
