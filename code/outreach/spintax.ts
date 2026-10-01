// Spintax for email templates. {Hi|Hello} picks one option at random, nesting included.
// {{contact.name}} variables are protected so they get filled in afterwards.

const SENT = String.fromCharCode(0xe000)

export function resolveSpintax(text: string, rng: () => number = Math.random): string {
  const vars: string[] = []
  let s = text.replace(/\{\{[^{}]*\}\}/g, (token) => {
    vars.push(token)
    return `${SENT}${vars.length - 1}${SENT}`
  })
  const spin = /\{([^{}]*\|[^{}]*)\}/
  let guard = 0
  let m = s.match(spin)
  while (m && m.index !== undefined && guard++ < 2000) {
    const options = m[1].split("|")
    const pick = options[Math.floor(rng() * options.length)]
    s = s.slice(0, m.index) + pick + s.slice(m.index + m[0].length)
    m = s.match(spin)
  }
  return s.replace(new RegExp(`${SENT}(\\d+)${SENT}`, "g"), (_full, i: string) => vars[Number(i)] ?? "")
}
