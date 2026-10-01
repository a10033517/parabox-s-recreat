// Generates assets/icon.svg: a blue room that contains itself (4 levels deep), with the
// magenta player and an orange box — the app icon. Render it to PNG with any SVG renderer.
import { writeFileSync } from 'node:fs'

const WALL = '#4aa3ff', FLOOR = '#1b4f86', OUTLINE = '#101418'
function room(x, y, s, depth) {
  const c = s / 5
  let out = `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${WALL}"/>`
  out += `<rect x="${x + c}" y="${y + c}" width="${3 * c}" height="${3 * c}" fill="${FLOOR}"/>`
  out += `<rect x="${x + 2 * c}" y="${y}" width="${c}" height="${c}" fill="${FLOOR}"/>` // doorway
  // player (bottom-left) and box (top-right) inside
  out += `<rect x="${x + c}" y="${y + 3 * c}" width="${c}" height="${c}" fill="#c4006f" stroke="${OUTLINE}" stroke-width="${c * 0.05}"/>`
  out += `<circle cx="${x + c * 1.3}" cy="${y + c * 3.45}" r="${c * 0.08}" fill="#2a0016"/><circle cx="${x + c * 1.7}" cy="${y + c * 3.45}" r="${c * 0.08}" fill="#2a0016"/>`
  out += `<rect x="${x + 3 * c}" y="${y + c}" width="${c}" height="${c}" fill="#ffb236" stroke="${OUTLINE}" stroke-width="${c * 0.05}"/>`
  if (depth > 0) {
    out += room(x + 2 * c, y + 2 * c, c, depth - 1)
    out += `<rect x="${x + 2 * c}" y="${y + 2 * c}" width="${c}" height="${c}" fill="none" stroke="${OUTLINE}" stroke-width="${c * 0.05}"/>`
  }
  return out
}
const size = 1024, pad = 150
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" fill="#0b0b0b"/>
${room(pad, pad, size - 2 * pad, 4)}
</svg>`
writeFileSync(new URL('./icon.svg', import.meta.url), svg)
