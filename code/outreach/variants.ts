// A/B variants and stable randomness (pure, no server). Used by the sending engine and by the
// per-contact preview, and covered by unit tests.

/** Picks an item at random by weight. If every weight is zero, the first one. */
export function pickByWeight<T extends { weight: number }>(items: T[], rng: () => number = Math.random): T {
  const total = items.reduce((a, v) => a + Math.max(0, v.weight), 0)
  if (total <= 0) return items[0]
  let r = rng() * total
  for (const it of items) {
    r -= Math.max(0, it.weight)
    if (r <= 0) return it
  }
  return items[items.length - 1]
}

/** Stable numeric seed from strings (32-bit FNV-1a). */
export function seed(...parts: string[]): number {
  let h = 0x811c9dc5
  for (const ch of parts.join(":")) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Simple deterministic generator. The same seed always gives the same sequence. */
export function deterministicRng(s0: number) {
  let s = s0 >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/**
 * Spintax randomness for one contact in one step. It's the same in the preview and when sending,
 * so what you see (and edit) is exactly what goes out.
 */
export function sendRng(enrollmentId: string, stepId: string) {
  return deterministicRng(seed(enrollmentId, stepId, "spintax"))
}

type UsableVariant = { weight: number; subject: string; body: string }

/**
 * The variant a contact gets in a step. It's stable (it doesn't change between preview and send):
 *  - `SINGLE`, or only one variant with content: that one.
 *  - `ALTERNATE`: one each, in the order contacts joined the campaign (`index`).
 *  - `RANDOM`: random by weight, seeded with the contact and the step.
 */
export function variantForEnrollment<T extends UsableVariant>(
  step: { id: string; variantMode: string; variants: T[] },
  enrollment: { id: string; index: number },
): T | null {
  const usable = step.variants.filter((v) => v.subject.trim() || v.body.trim())
  if (!usable.length) return null
  if (usable.length === 1 || step.variantMode === "SINGLE") return usable[0]
  if (step.variantMode === "ALTERNATE") return usable[Math.max(0, enrollment.index) % usable.length]
  return pickByWeight(usable, deterministicRng(seed(enrollment.id, step.id, "variant")))
}
