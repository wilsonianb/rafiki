import { randomInt } from 'crypto'

export function randomAsset(): { code: string; scale: number } {
  const letters = []
  while (letters.length < 3) {
    letters.push(randomInt(65, 91))
  }
  return {
    code: String.fromCharCode(...letters),
    scale: randomInt(0, 256)
  }
}
