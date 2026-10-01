// Day planner, pure (no database, no network). It decides which emails go out today and at what time.
//
// 1. Who goes out today. Follow-ups first, then new contacts, each group by age, until three caps
//    fill up at once: the campaign's, the mailbox's (sender) and the total for the day. Whatever
//    doesn't fit goes to `noSlot` with the reason, and tomorrow the first in line gets in.
// 2. At what time. Each mailbox sends one email at a time. Campaigns that share a mailbox take
//    turns (A, B, A, B…) and between two emails from the same mailbox there's a random gap inside
//    the spacing of the campaign whose email goes out. Every email respects its campaign's hours
//    and days, and never goes out before its turn (`notBefore`).
import { isSendDay, dayWindow } from "./time"

export type PlanCandidate = {
  /** Enrollment id (one contact inside one campaign). */
  id: string
  campaignId: string
  senderId: string
  /** Already got an email, so it's a follow-up and goes ahead of new contacts. */
  followUp: boolean
  /** Can't go out before this time (its `nextSendAt`). */
  notBefore: Date
  /** Stable tie-break (date it was added). */
  order: number
}

export type PlanCampaign = {
  id: string
  dailyCap: number
  usedToday: number
  dripMinMinutes: number
  dripMaxMinutes: number
  windowStart: number
  windowEnd: number
  sendDays: readonly number[]
}

export type PlanSender = {
  id: string
  dailyLimit: number
  usedToday: number
  /** Time of this mailbox's last email today (scheduled or sent). The next one goes after it. */
  lastToday: Date | null
}

export type NoSlotReason = "campaign-cap" | "sender-cap" | "total-cap" | "out-of-hours" | "not-a-send-day"

export type DayPlan = {
  assigned: Array<{ id: string; slot: Date }>
  noSlot: Array<{ id: string; reason: NoSlotReason }>
}

const MIN = 60_000

export function planDay(input: {
  now: Date
  candidates: PlanCandidate[]
  campaigns: PlanCampaign[]
  senders: PlanSender[]
  totalLimit: number
  usedTotalToday: number
  rng?: () => number
  /** Nothing gets scheduled before now + margin, because Zoho needs a time in the future. */
  marginMs?: number
}): DayPlan {
  const rng = input.rng ?? Math.random
  const margin = input.marginMs ?? 2 * MIN
  const { now } = input
  const campaigns = new Map(input.campaigns.map((c) => [c.id, c]))
  const senders = new Map(input.senders.map((s) => [s.id, s]))
  const noSlot: DayPlan["noSlot"] = []

  // Today's window for each campaign, or null if today isn't one of its sending days.
  const window = new Map<string, { start: number; end: number } | null>()
  for (const c of input.campaigns) {
    if (!isSendDay(now, c.sendDays)) window.set(c.id, null)
    else {
      const w = dayWindow(now, c.windowStart, c.windowEnd)
      window.set(c.id, { start: w.start.getTime(), end: w.end.getTime() })
    }
  }

  // 1. Who goes out today.
  const priority = [...input.candidates].sort(
    (a, b) => Number(b.followUp) - Number(a.followUp) || a.notBefore.getTime() - b.notBefore.getTime() || a.order - b.order,
  )
  const campaignLeft = new Map(input.campaigns.map((c) => [c.id, Math.max(0, c.dailyCap - c.usedToday)]))
  const senderLeft = new Map(input.senders.map((s) => [s.id, Math.max(0, s.dailyLimit - s.usedToday)]))
  let totalLeft = Math.max(0, input.totalLimit - input.usedTotalToday)
  const chosen: PlanCandidate[] = []
  for (const cand of priority) {
    const c = campaigns.get(cand.campaignId)
    const s = senders.get(cand.senderId)
    if (!c || !s) continue
    const w = window.get(c.id)
    if (!w) {
      noSlot.push({ id: cand.id, reason: "not-a-send-day" })
      continue
    }
    // Its turn comes after today's hours are over. It belongs to another day, so it isn't missing a slot.
    if (cand.notBefore.getTime() >= w.end) continue
    if (w.end <= now.getTime() + margin) {
      noSlot.push({ id: cand.id, reason: "out-of-hours" })
      continue
    }
    if ((campaignLeft.get(c.id) ?? 0) <= 0) {
      noSlot.push({ id: cand.id, reason: "campaign-cap" })
      continue
    }
    if ((senderLeft.get(s.id) ?? 0) <= 0) {
      noSlot.push({ id: cand.id, reason: "sender-cap" })
      continue
    }
    if (totalLeft <= 0) {
      noSlot.push({ id: cand.id, reason: "total-cap" })
      continue
    }
    campaignLeft.set(c.id, (campaignLeft.get(c.id) ?? 0) - 1)
    senderLeft.set(s.id, (senderLeft.get(s.id) ?? 0) - 1)
    totalLeft--
    chosen.push(cand)
  }

  // 2. At what time, one mailbox at a time.
  const assigned: DayPlan["assigned"] = []
  const bySender = new Map<string, PlanCandidate[]>()
  for (const e of chosen) bySender.set(e.senderId, [...(bySender.get(e.senderId) ?? []), e])

  for (const [senderId, items] of bySender) {
    const s = senders.get(senderId)!
    // One queue per campaign, in priority order. The rotation starts with the first one that shows up.
    const queues = new Map<string, PlanCandidate[]>()
    for (const it of items) queues.set(it.campaignId, [...(queues.get(it.campaignId) ?? []), it])
    const rotation = [...queues.keys()]
    let ptr = 0
    let prev: number | null = s.lastToday ? s.lastToday.getTime() : null
    let t = now.getTime() + margin
    const gap = (c: PlanCampaign) => (c.dripMinMinutes + rng() * Math.max(0, c.dripMaxMinutes - c.dripMinMinutes)) * MIN
    const exhaust = (cid: string) => {
      const q = queues.get(cid)!
      for (const it of q) noSlot.push({ id: it.id, reason: "out-of-hours" })
      q.length = 0
    }
    const alive = () => rotation.filter((cid) => (queues.get(cid)?.length ?? 0) > 0)

    for (let rounds = 0; alive().length && rounds < 100_000; rounds++) {
      let placed = false
      for (let k = 0; k < rotation.length; k++) {
        const cid = rotation[(ptr + k) % rotation.length]
        const q = queues.get(cid)!
        if (!q.length) continue
        const c = campaigns.get(cid)!
        const w = window.get(cid)!
        // The first email of the day doesn't go out on the dot, but a few random minutes after opening.
        const start = prev === null ? w.start + rng() * c.dripMinMinutes * MIN : w.start
        const time = Math.max(t, start, prev === null ? 0 : prev + gap(c))
        if (time >= w.end) {
          exhaust(cid)
          continue
        }
        const i = q.findIndex((it) => it.notBefore.getTime() <= time)
        if (i < 0) continue
        const [it] = q.splice(i, 1)
        assigned.push({ id: it.id, slot: new Date(Math.round(time / 1000) * 1000) })
        prev = time
        t = time
        ptr = (ptr + k + 1) % rotation.length
        placed = true
        break
      }
      if (placed) continue
      // Nobody can go out yet, so we move forward until something is ready.
      let next = Infinity
      for (const cid of alive()) {
        const q = queues.get(cid)!
        const w = window.get(cid)!
        const ready = Math.max(Math.min(...q.map((it) => it.notBefore.getTime())), w.start)
        if (ready >= w.end) exhaust(cid)
        else next = Math.min(next, ready)
      }
      if (next === Infinity) break
      t = Math.max(t, next)
    }
  }

  assigned.sort((a, b) => a.slot.getTime() - b.slot.getTime())
  return { assigned, noSlot }
}

/** How many emails fit in a window with that average spacing (a guide when setting up a campaign). */
export function dailyCapacity(c: { windowStart: number; windowEnd: number; dripMinMinutes: number; dripMaxMinutes: number }): number {
  const minutes = Math.max(0, (c.windowEnd - c.windowStart) * 60)
  const average = Math.max(1, (c.dripMinMinutes + c.dripMaxMinutes) / 2)
  return Math.floor(minutes / average)
}
