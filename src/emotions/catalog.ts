export type Emotion = {
  id: string
  emoji: string
  label: string
}

export const EMOTIONS = [
  { id: 'smile', emoji: '😊', label: 'smile' },
  { id: 'grin', emoji: '😄', label: 'grin' },
  { id: 'heart-eyes', emoji: '😍', label: 'heart eyes' },
  { id: 'wink', emoji: '😉', label: 'wink' },
  { id: 'slight-smile', emoji: '🙂', label: 'slight smile' },
  { id: 'relieved', emoji: '😌', label: 'relieved' },
  { id: 'thinking', emoji: '🤔', label: 'thinking' },
  { id: 'smirk', emoji: '😏', label: 'smirk' },
  { id: 'playful', emoji: '😜', label: 'playful' },
  { id: 'innocent', emoji: '😇', label: 'innocent' },
  { id: 'sleepy', emoji: '😴', label: 'sleepy' },
  { id: 'neutral', emoji: '😐', label: 'neutral' },
  { id: 'blank', emoji: '😶', label: 'blank' },
  { id: 'sad', emoji: '😢', label: 'sad' },
  { id: 'cry', emoji: '😭', label: 'crying' },
  { id: 'pensive', emoji: '😔', label: 'pensive' },
  { id: 'angry', emoji: '😠', label: 'angry' },
  { id: 'rage', emoji: '😡', label: 'rage' },
  { id: 'steam', emoji: '😤', label: 'frustrated' },
  { id: 'fear', emoji: '😨', label: 'fear' },
  { id: 'scream', emoji: '😱', label: 'scream' },
  { id: 'grimace', emoji: '😬', label: 'grimace' },
  { id: 'peek', emoji: '🫣', label: 'peeking' },
  { id: 'devil', emoji: '😈', label: 'devil' },
  { id: 'skull', emoji: '💀', label: 'skull' },
  { id: 'ghost', emoji: '👻', label: 'ghost' },
  { id: 'melt', emoji: '🫠', label: 'melting' },
  { id: 'hidden', emoji: '🫥', label: 'dotted' },
  { id: 'clown', emoji: '🤡', label: 'clown' },
  { id: 'love', emoji: '🥰', label: 'loving' },
  { id: 'eyeroll', emoji: '🙄', label: 'eye roll' },
  { id: 'unamused', emoji: '😒', label: 'unamused' },
  { id: 'blush', emoji: '😳', label: 'flustered' },
  { id: 'hug', emoji: '🤗', label: 'hug' },
  { id: 'cowboy', emoji: '🤠', label: 'cowboy' },
  { id: 'disguise', emoji: '🥸', label: 'disguise' },
  { id: 'cool', emoji: '😎', label: 'cool' },
  { id: 'nerd', emoji: '🤓', label: 'nerd' },
  { id: 'mask', emoji: '😷', label: 'mask' },
  { id: 'robot', emoji: '🤖', label: 'robot' },
  { id: 'alien', emoji: '👽', label: 'alien' },
  { id: 'pumpkin', emoji: '🎃', label: 'pumpkin' },
  { id: 'ogre', emoji: '👹', label: 'ogre' },
  { id: 'goblin', emoji: '👺', label: 'goblin' },
  { id: 'cop', emoji: '👮', label: 'cop' },
  { id: 'hardhat', emoji: '👷', label: 'hardhat' },
  { id: 'detective', emoji: '🕵', label: 'detective' },
  { id: 'ninja', emoji: '🥷', label: 'ninja' },
  { id: 'guard', emoji: '💂', label: 'guard' },
  { id: 'hero', emoji: '🦸', label: 'hero' },
  { id: 'villain', emoji: '🦹', label: 'villain' },
  { id: 'mage', emoji: '🧙', label: 'mage' },
  { id: 'vampire', emoji: '🧛', label: 'vampire' },
  { id: 'zombie', emoji: '🧟', label: 'zombie' },
] as const satisfies readonly Emotion[]

export type EmotionId = (typeof EMOTIONS)[number]['id']

const BY_EMOJI = new Map<string, Emotion>(EMOTIONS.map((e) => [e.emoji, e]))
const BY_ID = new Map<string, Emotion>(EMOTIONS.map((e) => [e.id, e]))

export function emotionListLine(): string {
  return EMOTIONS.map((e) => `${e.emoji} (${e.label})`).join(' ')
}

export function isCatalogEmoji(emoji: string): boolean {
  return BY_EMOJI.has(emoji)
}

export function findEmotionByEmoji(emoji: string): Emotion | undefined {
  return BY_EMOJI.get(emoji)
}

export function findEmotionById(id: string): Emotion | undefined {
  return BY_ID.get(id)
}

/** First catalog emoji found in a string, if any. */
export function firstCatalogEmoji(text: string): string | null {
  for (const e of EMOTIONS) {
    if (text.includes(e.emoji)) return e.emoji
  }
  return null
}
