#!/usr/bin/env node
// LinkedIn through Apify: balance per key, email from a profile URL and search by company and role.
// Reads every APIFY_TOKEN_* / APIFY_KEY_* from .env or the environment and skips keys without budget.
// Never prints the keys. Output is JSON on stdout, warnings on stderr. No dependencies (Node 18+).
//
//   node linkedin.mjs balance
//   node linkedin.mjs profile <url|identifier> [...more]        (email included)
//   node linkedin.mjs search --company <LinkedIn company url> --roles "CEO,Founder" [--max 5] [--email]

import { readFileSync } from "node:fs"

const API = "https://api.apify.com/v2"
const PROFILE_ACTOR = "harvestapi~linkedin-profile-scraper"
const SEARCH_ACTOR = "harvestapi~linkedin-profile-search"
const MARGIN_USD = 0.15 // a key with less than this left to spend gets skipped

function keys() {
  let env = ""
  try { env = readFileSync(".env", "utf8") } catch { /* no .env, environment only */ }
  const source = { ...Object.fromEntries([...env.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => [m[1], m[2].replace(/^["']|["']$/g, "").trim()])), ...process.env }
  const list = Object.entries(source).filter(([k, v]) => /^APIFY_(KEY|TOKEN)(_|$)/.test(k) && v).map(([name, token]) => ({ name, token }))
  if (!list.length) { console.error("No APIFY_TOKEN_* keys in .env or the environment."); process.exit(1) }
  return list
}

const get = (token, path) => fetch(API + path, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json())

async function usage(k) {
  const l = (await get(k.token, "/users/me/limits")).data
  const used = l?.current?.monthlyUsageUsd ?? 0
  const cap = l?.limits?.maxMonthlyUsageUsd ?? 5
  return { used, cap, left: cap - used }
}

async function run(actor, input, { requireResults }) {
  for (const k of keys()) {
    let u
    try { u = await usage(k) } catch { console.error(`· ${k.name}: not responding, next`); continue }
    if (u.left < MARGIN_USD) { console.error(`· ${k.name}: no budget left ($${u.used.toFixed(2)} of $${u.cap}), next`); continue }
    const r = await fetch(`${API}/acts/${actor}/run-sync-get-dataset-items?timeout=280`, {
      method: "POST", headers: { Authorization: `Bearer ${k.token}`, "Content-Type": "application/json" }, body: JSON.stringify(input),
    })
    const text = await r.text()
    let data = null
    try { data = JSON.parse(text) } catch { /* not JSON */ }
    const items = Array.isArray(data) ? data.filter((x) => x && (x.firstName || x.linkedinUrl || x.publicIdentifier)) : []
    if (r.ok && (items.length || !requireResults)) return { key: k.name, items }
    // No results from a paid actor means that key's quota ran out (it fails silently) or a real error.
    console.error(`· ${k.name}: HTTP ${r.status}, ${items.length} profiles${r.ok ? " (quota probably used up)" : ": " + text.slice(0, 120)}, next key`)
  }
  return { key: null, items: [] }
}

// The email comes as `email` (object or string) or as `emails` (list), depending on actor and version.
function email(x) {
  const e = (Array.isArray(x.emails) && x.emails[0]) || x.email || null
  if (!e) return { email: null }
  if (typeof e === "string") return { email: e }
  return { email: e.email ?? null, status: e.status ?? null, quality: e.qualityScore ?? null, catchAll: e.catchAllDomain ?? null }
}

// The current role comes as `currentPosition` (profile scraper) or `currentPositions` (search).
const normalize = (x, key) => {
  const cp = x.currentPosition ?? x.currentPositions
  const pos = (Array.isArray(cp) ? cp[0] : cp) ?? x.experience?.[0] ?? {}
  return {
    url: x.linkedinUrl ?? null, firstName: x.firstName ?? null, lastName: x.lastName ?? null,
    role: pos.position ?? pos.title ?? null, company: pos.companyName ?? null, companyLinkedin: pos.companyLinkedinUrl ?? null,
    headline: x.headline ?? null, followers: x.followerCount ?? null,
    location: x.location?.linkedinText ?? x.location?.parsed?.text ?? null, ...email(x), key,
  }
}

const [, , command, ...args] = process.argv

if (command === "balance") {
  const rows = []
  for (const k of keys()) {
    try { const u = await usage(k); rows.push({ key: k.name, used: +u.used.toFixed(2), cap: u.cap, left: +u.left.toFixed(2) }) }
    catch { rows.push({ key: k.name, error: "not responding" }) }
  }
  console.log(JSON.stringify(rows, null, 2))
} else if (command === "profile") {
  const urls = args.filter((a) => !a.startsWith("--"))
  if (!urls.length) { console.error("Usage: profile <url|identifier> [...]"); process.exit(1) }
  const { key, items } = await run(PROFILE_ACTOR, {
    profileScraperMode: "Profile details + email search ($10 per 1k)",
    urls: urls.filter((u) => u.startsWith("http")),
    publicIdentifiers: urls.filter((u) => !u.startsWith("http")),
  }, { requireResults: true })
  console.log(JSON.stringify({ key, profiles: items.map((x) => normalize(x, key)) }, null, 2))
} else if (command === "search") {
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
  const company = opt("--company")
  if (!company) { console.error('Usage: search --company <LinkedIn company url> --roles "CEO,Founder" [--max 5] [--email]'); process.exit(1) }
  const roles = (opt("--roles") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  const { key, items } = await run(SEARCH_ACTOR, {
    profileScraperMode: args.includes("--email") ? "Full + email search" : "Short",
    currentCompanies: [company], ...(roles.length ? { currentJobTitles: roles } : {}), maxItems: Number(opt("--max") ?? 5),
  }, { requireResults: false })
  console.log(JSON.stringify({ key, profiles: items.map((x) => normalize(x, key)) }, null, 2))
} else {
  console.error('Commands: balance | profile <url...> | search --company <url> --roles "CEO,Founder" [--max 5] [--email]')
  process.exit(1)
}
