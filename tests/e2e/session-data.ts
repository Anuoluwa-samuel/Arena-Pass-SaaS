/**
 * Realistic, varied session data for e2e runs, so sessions created by tests
 * don't read as copies of each other on the public site.
 */
const AREAS = ["Lekki", "Surulere", "Yaba", "Ikeja", "Victoria Island", "Ikoyi", "Gbagada", "Ajah", "Magodo", "Festac"]
const EVENTS = ["Floodlit Derby", "Sunset Cup", "Midweek Match", "Lunchtime League", "Night Kickabout", "Weekend Showdown", "Champions Night", "Early Birds Match", "Rush Hour Rumble", "Friday Fixture"]
const VENUES = ["Main Pitch", "Pitch A", "Pitch B", "Rooftop Arena", "Indoor Dome", "Astro Court 2"]
const START_HOURS = [7, 9, 12, 16, 17, 18, 19, 20]
const PRICES = [1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000]
// Game Slots sessions are always 4 players per team; only the number of teams varies.
const FORMATS: Array<[teams: number, players: number]> = [[4, 4], [5, 4], [6, 4], [8, 4]]

const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]

export interface GeneratedSession {
  title: string
  venue: string
  start: Date
  end: Date
  teams: number
  players: number
  capacity: number
  price: number
}

/** A random session between 2 and 6 days out. `taken` titles are avoided so the test can find its own card. */
export function generateSession(taken: Iterable<string> = []): GeneratedSession {
  const used = new Set(taken)
  let title = `${pick(AREAS)} ${pick(EVENTS)}`
  for (let i = 0; used.has(title) && i < 50; i++) title = `${pick(AREAS)} ${pick(EVENTS)}`
  if (used.has(title)) title = `${title} ${Math.floor(Math.random() * 90) + 10}`

  const start = new Date(Date.now() + (2 + Math.floor(Math.random() * 5)) * 86_400_000)
  start.setHours(pick(START_HOURS), pick([0, 30]), 0, 0)
  const end = new Date(start.getTime() + pick([60, 90, 120]) * 60_000)
  const [teams, players] = pick(FORMATS)
  return { title, venue: pick(VENUES), start, end, teams, players, capacity: teams * players, price: pick(PRICES) }
}
