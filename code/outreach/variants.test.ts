import { describe, expect, it } from "vitest"
import { sendRng, deterministicRng, seed, variantForEnrollment } from "./variants"
import { resolveSpintax } from "./spintax"

const v = (name: string, weight = 50, body = `Body ${name}`) => ({ id: name, name, weight, subject: `Subject ${name}`, body })

describe("stable randomness per contact", () => {
  it("the same seed always gives the same sequence", () => {
    const a = deterministicRng(seed("ins1", "step1"))
    const b = deterministicRng(seed("ins1", "step1"))
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(seed("ins1", "step1")).not.toBe(seed("ins2", "step1"))
  })

  it("a contact's spintax in a step is the same in the preview and when sending", () => {
    const text = "{Hi|Hello|Hey} {{contact.name}}, {quick one|a short note} about this"
    const preview = resolveSpintax(text, sendRng("ins1", "step1"))
    const sent = resolveSpintax(text, sendRng("ins1", "step1"))
    expect(sent).toBe(preview)
    expect(preview).toContain("{{contact.name}}")
  })

  it("each contact can get a different combination", () => {
    const text = "{a|b|c|d|e|f|g|h}"
    const outputs = new Set(Array.from({ length: 40 }, (_, i) => resolveSpintax(text, sendRng(`ins${i}`, "step1"))))
    expect(outputs.size).toBeGreaterThan(3)
  })
})

describe("variant for each contact", () => {
  it("with only one variant that has content, that one", () => {
    const step = { id: "p", variantMode: "RANDOM", variants: [v("A"), { ...v("B"), subject: "", body: "" }] }
    expect(variantForEnrollment(step, { id: "i", index: 5 })?.name).toBe("A")
  })

  it("with no content in any of them, null", () => {
    const step = { id: "p", variantMode: "SINGLE", variants: [{ ...v("A"), subject: "", body: " " }] }
    expect(variantForEnrollment(step, { id: "i", index: 0 })).toBeNull()
  })

  it("'one each' alternates in the order contacts joined", () => {
    const step = { id: "p", variantMode: "ALTERNATE", variants: [v("A"), v("B"), v("C")] }
    const names = [0, 1, 2, 3, 4].map((index) => variantForEnrollment(step, { id: `i${index}`, index })?.name)
    expect(names).toEqual(["A", "B", "C", "A", "B"])
  })

  it("random by weight is stable for each contact and follows the weights", () => {
    const step = { id: "p", variantMode: "RANDOM", variants: [v("A", 80), v("B", 20)] }
    const one = variantForEnrollment(step, { id: "ins-42", index: 0 })
    expect(variantForEnrollment(step, { id: "ins-42", index: 9 })).toBe(one)
    const fromA = Array.from({ length: 1000 }, (_, i) => variantForEnrollment(step, { id: `ins-${i}`, index: i })?.name).filter((n) => n === "A").length
    expect(fromA).toBeGreaterThan(720)
    expect(fromA).toBeLessThan(880)
  })
})
