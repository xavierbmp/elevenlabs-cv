import { describe, expect, it } from "vitest"
import { dailyCapacity, planDay, type PlanCampaign, type PlanCandidate, type PlanSender } from "./planner"
import { madridParts, madridWallToDate } from "./time"

// Monday 21 September 2026 (Madrid time).
const monday = (h: number, m = 0) => madridWallToDate(2026, 9, 21, h, m)
const MIN = 60_000

const campaign = (id: string, o: Partial<PlanCampaign> = {}): PlanCampaign => ({ id, dailyCap: 20, usedToday: 0, dripMinMinutes: 8, dripMaxMinutes: 15, windowStart: 9, windowEnd: 18, sendDays: [1, 2, 3, 4, 5], ...o })
const sender = (id: string, o: Partial<PlanSender> = {}): PlanSender => ({ id, dailyLimit: 40, usedToday: 0, lastToday: null, ...o })
const candidates = (campaignId: string, n: number, o: Partial<PlanCandidate> = {}): PlanCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${campaignId}-${o.followUp ? "f" : "n"}${i}`, campaignId, senderId: "r1", followUp: false, notBefore: monday(7), order: i, ...o }))

/** Repeatable randomness (linear congruential), so the tests don't depend on Math.random. */
function random(s0 = 7) {
  let s = s0
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

describe("day planner", () => {
  it("spreads emails with the campaign's spacing and inside its hours", () => {
    const plan = planDay({ now: monday(7), candidates: candidates("A", 6), campaigns: [campaign("A")], senders: [sender("r1")], totalLimit: 50, usedTotalToday: 0, rng: random() })
    expect(plan.assigned).toHaveLength(6)
    const times = plan.assigned.map((a) => a.slot.getTime())
    expect(times[0]).toBeGreaterThanOrEqual(monday(9).getTime())
    expect(times.at(-1)!).toBeLessThan(monday(18).getTime())
    for (let i = 1; i < times.length; i++) {
      const gap = (times[i] - times[i - 1]) / MIN
      expect(gap).toBeGreaterThanOrEqual(8 - 0.02)
      expect(gap).toBeLessThanOrEqual(15 + 0.02)
    }
  })

  it("campaigns sharing a mailbox take turns (A, B, A, B…)", () => {
    const plan = planDay({ now: monday(7), candidates: [...candidates("A", 3), ...candidates("B", 3)], campaigns: [campaign("A"), campaign("B")], senders: [sender("r1")], totalLimit: 50, usedTotalToday: 0, rng: random() })
    expect(plan.assigned.map((a) => a.id.charAt(0))).toEqual(["A", "B", "A", "B", "A", "B"])
  })

  it("respects each campaign's cap", () => {
    const plan = planDay({ now: monday(7), candidates: candidates("A", 5), campaigns: [campaign("A", { dailyCap: 3, usedToday: 1 })], senders: [sender("r1")], totalLimit: 50, usedTotalToday: 0, rng: random() })
    expect(plan.assigned).toHaveLength(2)
    expect(plan.noSlot.filter((s) => s.reason === "campaign-cap")).toHaveLength(3)
  })

  it("the total limit wins over several campaigns of 20 a day", () => {
    const plan = planDay({
      now: monday(7),
      candidates: [...candidates("A", 20), ...candidates("B", 20), ...candidates("C", 20)],
      campaigns: [campaign("A"), campaign("B"), campaign("C")],
      senders: [sender("r1", { dailyLimit: 100 })],
      totalLimit: 50,
      usedTotalToday: 0,
      rng: random(),
    })
    // 50 fit in total. The window (9 to 18 with 8-15 min gaps) holds about 46, the rest go another day.
    expect(plan.assigned.length + plan.noSlot.filter((s) => s.reason === "out-of-hours").length).toBe(50)
    expect(plan.noSlot.filter((s) => s.reason === "total-cap")).toHaveLength(10)
    const perCampaign = (c: string) => plan.assigned.filter((a) => a.id.startsWith(c)).length
    // They take turns, so none of them takes everything.
    expect(Math.max(perCampaign("A"), perCampaign("B"), perCampaign("C")) - Math.min(perCampaign("A"), perCampaign("B"), perCampaign("C"))).toBeLessThanOrEqual(1)
  })

  it("respects the mailbox limit", () => {
    const plan = planDay({ now: monday(7), candidates: candidates("A", 5), campaigns: [campaign("A")], senders: [sender("r1", { dailyLimit: 10, usedToday: 8 })], totalLimit: 50, usedTotalToday: 0, rng: random() })
    expect(plan.assigned).toHaveLength(2)
    expect(plan.noSlot.every((s) => s.reason === "sender-cap")).toBe(true)
  })

  it("when the quota is tight, follow-ups go before new contacts", () => {
    const plan = planDay({
      now: monday(7),
      candidates: [...candidates("A", 2), ...candidates("A", 2, { followUp: true, notBefore: monday(8) })],
      campaigns: [campaign("A")],
      senders: [sender("r1")],
      totalLimit: 2,
      usedTotalToday: 0,
      rng: random(),
    })
    expect(plan.assigned.map((a) => a.id).sort()).toEqual(["A-f0", "A-f1"])
    expect(plan.noSlot.map((s) => s.reason)).toEqual(["total-cap", "total-cap"])
  })

  it("schedules nothing on a day off", () => {
    const saturday = madridWallToDate(2026, 9, 19, 8, 0)
    const plan = planDay({ now: saturday, candidates: candidates("A", 3), campaigns: [campaign("A")], senders: [sender("r1")], totalLimit: 50, usedTotalToday: 0, rng: random() })
    expect(plan.assigned).toHaveLength(0)
    expect(plan.noSlot.every((s) => s.reason === "not-a-send-day")).toBe(true)
  })

  it("whatever doesn't fit before closing time moves to another day", () => {
    const plan = planDay({ now: monday(17, 20), candidates: candidates("A", 10), campaigns: [campaign("A")], senders: [sender("r1")], totalLimit: 50, usedTotalToday: 0, rng: random() })
    expect(plan.assigned.length).toBeGreaterThan(0)
    expect(plan.assigned.length).toBeLessThanOrEqual(5)
    expect(plan.assigned.every((a) => a.slot < monday(18))).toBe(true)
    expect(plan.noSlot.every((s) => s.reason === "out-of-hours")).toBe(true)
  })

  it("nobody goes out before their turn", () => {
    const plan = planDay({ now: monday(7), candidates: candidates("A", 1, { followUp: true, notBefore: monday(15, 30) }), campaigns: [campaign("A")], senders: [sender("r1")], totalLimit: 50, usedTotalToday: 0, rng: random() })
    expect(plan.assigned[0].slot.getTime()).toBeGreaterThanOrEqual(monday(15, 30).getTime())
  })

  it("new emails go after what the mailbox already has scheduled today", () => {
    const plan = planDay({ now: monday(10), candidates: candidates("A", 2), campaigns: [campaign("A")], senders: [sender("r1", { lastToday: monday(12) })], totalLimit: 50, usedTotalToday: 0, rng: random() })
    expect(plan.assigned[0].slot.getTime()).toBeGreaterThanOrEqual(monday(12, 8).getTime())
  })

  it("planning mid-morning starts in a few minutes, not earlier", () => {
    const now = monday(11, 0)
    const plan = planDay({ now, candidates: candidates("A", 1), campaigns: [campaign("A")], senders: [sender("r1")], totalLimit: 50, usedTotalToday: 0, rng: random() })
    const p = madridParts(plan.assigned[0].slot)
    expect(plan.assigned[0].slot.getTime()).toBeGreaterThanOrEqual(now.getTime() + 2 * MIN)
    expect(p.h).toBe(11)
  })

  it("different mailboxes run in parallel", () => {
    const plan = planDay({
      now: monday(7),
      candidates: [...candidates("A", 2), ...candidates("B", 2, { senderId: "r2" })],
      campaigns: [campaign("A"), campaign("B")],
      senders: [sender("r1"), sender("r2")],
      totalLimit: 50,
      usedTotalToday: 0,
      rng: random(),
    })
    const firstOf = (c: string) => plan.assigned.find((a) => a.id.startsWith(c))!.slot.getTime()
    // Both mailboxes start when the window opens, and neither waits for the other.
    expect(Math.abs(firstOf("A") - firstOf("B"))).toBeLessThan(8 * MIN)
  })

  it("rough daily capacity", () => {
    expect(dailyCapacity({ windowStart: 9, windowEnd: 18, dripMinMinutes: 8, dripMaxMinutes: 15 })).toBe(46)
  })
})
