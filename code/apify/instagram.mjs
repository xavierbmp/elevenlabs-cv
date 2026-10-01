#!/usr/bin/env node
// Instagram through Apify (Instagram blocks direct requests without a session). Reads every
// APIFY_TOKEN_* / APIFY_KEY_* from .env or the environment and falls back to the next key if one fails.
// Never prints the keys. Around $0.0026 per profile or post. No dependencies (Node 18+).
//
//   node instagram.mjs profiles <username> [...more]    followers, name, email/website and bio
//   node instagram.mjs mentions <account> [--max 40]    who the account tags in its latest posts
//   Add --json <file> to save the full result.
import { readFileSync, writeFileSync } from "node:fs"

const API = "https://api.apify.com/v2"
const args = process.argv.slice(2)
const [mode, ...rest] = args
const option = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest.splice(i, 2)[1] : undefined }
const output = option("--json")
const max = Number(option("--max") ?? 40)
const usernames = rest.map((u) => u.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "")).filter(Boolean)
if (!["profiles", "mentions"].includes(mode) || !usernames.length) {
  console.error("Usage: instagram.mjs profiles <username...> | mentions <account> [--max 40] [--json file]")
  process.exit(1)
}

function tokens() {
  let env = ""
  try { env = readFileSync(".env", "utf8") } catch { /* environment only */ }
  const source = { ...Object.fromEntries([...env.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => [m[1], m[2].replace(/^["']|["']$/g, "").trim()])), ...process.env }
  const list = Object.entries(source).filter(([k, v]) => /^APIFY_(KEY|TOKEN)(_|$)/.test(k) && v).map(([name, token]) => ({ name, token }))
  if (!list.length) { console.error("No APIFY_TOKEN_* keys in .env or the environment."); process.exit(1) }
  return list
}

async function run(actor, input) {
  for (const t of tokens()) {
    try {
      const r = await fetch(`${API}/acts/${actor}/run-sync-get-dataset-items?timeout=290`, {
        method: "POST", headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" }, body: JSON.stringify(input),
      })
      const data = JSON.parse(await r.text())
      if (r.ok && Array.isArray(data) && data.length) return data
      console.error(`· ${t.name}: HTTP ${r.status}, no results, trying the next key`)
    } catch (e) {
      console.error(`· ${t.name}: ${e.message}, trying the next key`)
    }
  }
  return []
}

if (mode === "profiles") {
  // Above ~200 profiles, split the list: one call takes about a minute per 100.
  const items = await run("apify~instagram-profile-scraper", { usernames })
  const res = items.map((x) => ({
    username: x.username, name: x.fullName, followers: x.followersCount ?? null, private: x.private ?? null,
    email: x.businessEmail || x.publicEmail || null, website: x.externalUrl || null, bio: (x.biography || "").replace(/\s+/g, " "),
  }))
  for (const x of res.sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1)))
    console.log(x.followers == null && !x.name
      ? `@${x.username} | DOESN'T EXIST or can't be read (check the username)`
      : `@${x.username} | ${x.name ?? "?"} | ${x.followers ?? "?"} | ${x.email ?? ""} | ${x.bio.slice(0, 120)}`)
  const seen = new Set(res.map((x) => x.username?.toLowerCase()))
  const missing = usernames.filter((n) => !seen.has(n.toLowerCase()))
  if (missing.length) console.log(`No data (typo or closed account): ${missing.join(", ")}`)
  if (output) writeFileSync(output, JSON.stringify(res, null, 1))
} else {
  const items = await run("apify~instagram-post-scraper", { username: usernames, resultsLimit: max })
  const mentions = {}
  for (const p of items) {
    const users = new Set([...(p.mentions || []), ...(p.taggedUsers || []).map((u) => u.username || u), ...(p.coauthorProducers || []).map((u) => u.username || u)])
    for (const u of users) {
      mentions[u] = mentions[u] || { times: 0, last: "" }
      mentions[u].times++
      const d = (p.timestamp || "").slice(0, 10)
      if (d > mentions[u].last) mentions[u].last = d
    }
  }
  const dates = items.map((p) => (p.timestamp || "").slice(0, 10)).filter(Boolean).sort()
  console.log(`${items.length} posts from ${dates[0] ?? "?"} to ${dates.at(-1) ?? "?"}`)
  console.log(Object.entries(mentions).sort((a, b) => b[1].times - a[1].times).map(([u, v]) => `${u} (${v.times}, ${v.last})`).join(" · "))
  if (output) writeFileSync(output, JSON.stringify(items.map((p) => ({ date: p.timestamp, url: p.url, caption: p.caption, mentions: p.mentions, tagged: (p.taggedUsers || []).map((u) => u.username || u) })), null, 1))
}
