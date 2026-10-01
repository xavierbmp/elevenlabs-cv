// Dates in Europe/Madrid with no dependencies: wall clock ↔ Date, sending window, sending days
// and the format Zoho expects for scheduled emails.
export const SEND_TZ = "Europe/Madrid"

/** Days of the week (0 = Sunday … 6 = Saturday). By default emails go out Monday to Friday. */
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5]
export const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6]

const dtf = new Intl.DateTimeFormat("en-US", {
  timeZone: SEND_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

type Parts = { y: number; m: number; d: number; h: number; min: number; s: number }

function rawParts(date: Date): Parts {
  const p = dtf.formatToParts(date).reduce(
    (a, x) => {
      a[x.type] = x.value
      return a
    },
    {} as Record<string, string>,
  )
  const h = p.hour === "24" ? 0 : Number(p.hour)
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h, min: Number(p.minute), s: Number(p.second) }
}

/** Day of the week (0 = Sunday … 6 = Saturday) of a calendar date. */
export function dayOfWeek(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function madridParts(date: Date) {
  const p = rawParts(date)
  return { ...p, dow: dayOfWeek(p.y, p.m, p.d) }
}

/** Madrid wall clock → UTC instant, daylight saving included. */
export function madridWallToDate(y: number, m: number, d: number, h: number, min: number): Date {
  const guessUTC = Date.UTC(y, m - 1, d, h, min, 0)
  const p = rawParts(new Date(guessUTC))
  const asUTC = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s)
  const offset = asUTC - guessUTC
  return new Date(guessUTC - offset)
}

function nextDay(y: number, m: number, d: number) {
  const noon = madridWallToDate(y, m, d, 12, 0)
  const p = rawParts(new Date(noon.getTime() + 24 * 3600_000))
  return { y: p.y, m: p.m, d: p.d }
}

/** Accepts the old format (true = weekdays, false = every day) or a list of days. */
export function normalizeDays(days: readonly number[] | boolean | null | undefined): readonly number[] {
  if (days === false) return ALL_DAYS
  if (days === true || days == null) return WEEKDAYS
  const valid = [...new Set(days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort((a, b) => a - b)
  return valid.length ? valid : WEEKDAYS
}

/** Do emails go out on that day (Madrid time)? */
export function isSendDay(date: Date, days: readonly number[] | boolean = WEEKDAYS): boolean {
  return normalizeDays(days).includes(madridParts(date).dow)
}

/** Moves an instant into the [startH, endH) window and onto a sending day (Monday to Friday by default). */
export function clampToWindow(slot: Date, startH: number, endH: number, days: readonly number[] | boolean = WEEKDAYS): Date {
  const allowed = normalizeDays(days)
  let { y, m, d, h, min } = madridParts(slot)
  if (h >= endH) {
    ;({ y, m, d } = nextDay(y, m, d))
    h = startH
    min = 0
  } else if (h < startH) {
    h = startH
    min = 0
  }
  let dow = dayOfWeek(y, m, d)
  for (let i = 0; i < 7 && !allowed.includes(dow); i++) {
    ;({ y, m, d } = nextDay(y, m, d))
    h = startH
    min = 0
    dow = dayOfWeek(y, m, d)
  }
  return madridWallToDate(y, m, d, h, min)
}

/** Adds N calendar days and fits the result in the window. If it lands on a day off, it waits for the next one. */
export function addDaysInWindow(from: Date, days: number, startH: number, endH: number, sendDays: readonly number[] | boolean = WEEKDAYS): Date {
  return clampToWindow(new Date(from.getTime() + Math.max(0, days) * 24 * 3600_000), startH, endH, sendDays)
}

/** Sending window of the Madrid day `date` falls on, as [start, end). endH = 24 ends at midnight. */
export function dayWindow(date: Date, startH: number, endH: number): { start: Date; end: Date } {
  const p = madridParts(date)
  const start = madridWallToDate(p.y, p.m, p.d, startH, 0)
  if (endH >= 24) {
    const n = nextDay(p.y, p.m, p.d)
    return { start, end: madridWallToDate(n.y, n.m, n.d, 0, 0) }
  }
  return { start, end: madridWallToDate(p.y, p.m, p.d, endH, 0) }
}

/** "MM/DD/YYYY HH:MM:SS" in Madrid time (Zoho's format for scheduled emails). */
export function zohoScheduleString(date: Date): string {
  const p = rawParts(date)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(p.m)}/${pad(p.d)}/${p.y} ${pad(p.h)}:${pad(p.min)}:${pad(p.s)}`
}

/** Start of today in Madrid, as a UTC instant. */
export function startOfDayMadrid(now = new Date()): Date {
  const p = madridParts(now)
  return madridWallToDate(p.y, p.m, p.d, 0, 0)
}

/** Start of tomorrow in Madrid (exclusive end of today). */
export function endOfDayMadrid(now = new Date()): Date {
  const p = madridParts(now)
  const n = nextDay(p.y, p.m, p.d)
  return madridWallToDate(n.y, n.m, n.d, 0, 0)
}

/** Madrid day key ("2026-09-21"), to group by day. */
export function dayKey(date: Date): string {
  const p = madridParts(date)
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`
}
