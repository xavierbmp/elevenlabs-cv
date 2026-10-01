#!/usr/bin/env node
// Clues from a company's website to find it (and the person who decides) on LinkedIn: real name,
// LinkedIn links (company and people), legal name and tax id (for the company registry), sentences
// with roles (CEO, founder…), emails and Instagram.
// Usage: node website-clues.mjs <website|domain> [<website2> ...]
// Reads the home page and up to 8 team, contact and legal pages. Costs nothing and never touches LinkedIn.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
const PATHS = ["contacto", "contact", "about", "about-us", "nosotros", "sobre-nosotros", "quienes-somos", "equipo", "team", "chi-siamo", "contatti", "qui-sommes-nous", "over-ons", "ueber-uns", "impressum", "aviso-legal"]
const ROLES = /\b(CEO|C\.E\.O\.|Founder|Co-?founder|Cofundador[a]?|Co-?fundador[a]?|Fundador[a]?|Fondatore|Fondatrice|Fondateur|Founding Partner|Managing (?:Director|Partner)|Director[a]? General|Directeur général|Gérant[e]?|Geschäftsführer(?:in)?|Inhaber(?:in)?|Gründer(?:in)?|Oprichter|Eigenaar|Owner|Titolare|Amministratore(?: unico| delegato)?|Administrador[a]? [úu]nic[oa]|Socio fundador|Socia fundadora)\b/i
const LEGAL_FORM = String.raw`(?:S\.?\s?L\.?\s?U?\.?|S\.?\s?A\.?\s?U?\.?|S\.?\s?R\.?\s?L\.?|S\.?\s?p\.?\s?A\.?|Ltd\.?|Limited|LLC|Inc\.?|GmbH|UG|B\.?\s?V\.?|SAS|SARL|S\.?A\.?S\.?|Lda\.?|BVBA|SRL)`

async function load(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "es,en;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(12000) })
    if (!r.ok) return { status: r.status, final: r.url }
    if (!/html/.test(r.headers.get("content-type") || "html")) return { status: "not html", final: r.url }
    return { status: r.status, final: r.url, html: await r.text() }
  } catch (e) {
    return { status: e.cause?.code || e.name }
  }
}

const clean = (s) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, "-").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim()
const text = (html) => clean(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h\d|td|span)>/gi, " · ").replace(/<[^>]+>/g, " "))
const meta = (html, prop) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)`, "i"))?.[1] || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1]

async function clues(input) {
  const base = /^https?:\/\//.test(input) ? input : `https://${input}`
  try { new URL(base) } catch { return { input, error: "invalid URL" } }
  const r = { linkedinCompany: new Set(), linkedinPeople: new Set(), emails: new Set(), instagram: new Set(), legalName: new Set(), taxId: new Set(), roles: new Set(), pages: [] }

  // Home page: https, then with/without www, then http (expired certificates)
  const u = new URL(base)
  const otherWww = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`
  let home
  for (const attempt of [base, `https://${otherWww}${u.pathname}`, `http://${u.hostname}${u.pathname}`]) {
    home = await load(attempt)
    if (home.html) break
  }
  if (!home.html) return { input, error: `the website doesn't load (${home.status}). Open it in a browser (it may block bots) or search the company by name and by its contacts' email domain` }
  const root = new URL(home.final).origin

  const read = (html, url) => {
    r.pages.push(url.replace(root, "") || "/")
    for (const m of html.matchAll(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(company|in|school|showcase)\/([^"'\s<>?#\\]+)/gi)) {
      let slug = m[2].replace(/\/+$/, "")
      try { slug = decodeURIComponent(slug) } catch { /* keep it as is */ }
      ;(m[1].toLowerCase() === "in" ? r.linkedinPeople : r.linkedinCompany).add(`https://www.linkedin.com/${m[1].toLowerCase()}/${slug.split("/")[0]}/`)
    }
    for (const m of html.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/g)) if (!["p", "reel", "explore", "stories"].includes(m[1])) r.instagram.add(`@${m[1]}`)
    for (const m of html.matchAll(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi)) {
      const e = m[1].toLowerCase()
      if (!/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e) && !/sentry|wixpress|example|dominio\.|domain\.|yourdomain|email\.com|usuario@|user@|name@|nombre@/.test(e)) r.emails.add(e)
    }
    const t = text(html)
    for (const m of t.matchAll(new RegExp(String.raw`([A-ZÁÉÍÓÚÑÄÖÜ0-9][\wÁÉÍÓÚÑáéíóúñäöüß&'.\- ]{1,50}?,?\s${LEGAL_FORM})(?=[\s,.;:)·]|$)`, "g"))) {
      const name = m[1].trim()
      if (name.split(" ").length <= 7 && !/^(De|La|El|Por|En|Con|Y|And|The|Of|Copyright|©)\b/i.test(name)) r.legalName.add(name)
    }
    for (const m of t.matchAll(/\b(?:CIF|NIF|C\.I\.F\.|N\.I\.F\.)[:.\s]*([A-HJ-NP-SUVW]-?\d{7}[0-9A-J])\b/gi)) r.taxId.add(`ES ${m[1].replace("-", "")}`)
    for (const m of t.matchAll(/\b(?:P\.?\s?IVA|Partita IVA|C\.F\.)[:.\s]*(?:IT)?\s?(\d{11})\b/gi)) r.taxId.add(`IT ${m[1]}`)
    for (const m of t.matchAll(/\bCompany (?:No\.?|Number|Registration(?: No\.?| Number)?)[:.\s]*((?:[A-Z]{2})?\d{6,8})\b/gi)) r.taxId.add(`UK ${m[1]}`)
    for (const m of t.matchAll(/\bSIRE[NT][:.\s]*(\d{3}\s?\d{3}\s?\d{3})/gi)) r.taxId.add(`FR ${m[1].replace(/\s/g, "")}`)
    for (const m of t.matchAll(/\bKvK(?:[-\s]?(?:nummer|nr\.?))?[:.\s]*(\d{8})\b/gi)) r.taxId.add(`NL ${m[1]}`)
    for (const m of t.matchAll(/\b(?:BTW|TVA|Ondernemingsnummer|Numéro d'entreprise)[:.\s]*(?:BE)?\s?(0?\d{3}[.\s]?\d{3}[.\s]?\d{3})\b/gi)) r.taxId.add(`BE ${m[1].replace(/[.\s]/g, "")}`)
    for (const m of t.matchAll(new RegExp(ROLES.source, "gi"))) {
      const i = m.index
      const sentence = t.slice(Math.max(0, i - 70), i + m[0].length + 70).replace(/^\S*\s/, "").replace(/\s\S*$/, "")
      if (r.roles.size < 8 && ![...r.roles].some((c) => c.includes(m[0]) && c.slice(0, 30) === sentence.slice(0, 30))) r.roles.add(`…${sentence}…`)
    }
  }

  const h = home.html
  const title = clean(h.match(/<title[^>]*>([^<]*)/i)?.[1] || "") || null
  const parked = /(domain|dominio|domein|domaine).{0,40}(for sale|en venta|te koop|à vendre|is parked|aparcado)|buy this domain|compra este dominio/i.test(title + " " + text(h).slice(0, 2000))
  read(h, home.final)

  // Team, contact and legal pages: first the ones linked from the home page, then the usual paths
  const linked = [...h.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => { try { return new URL(m[1], root).href } catch { return null } })
    .filter((x) => x && x.startsWith(root) && !/\.(css|js|png|jpe?g|svg|webp|pdf|xml)(\?|$)|wp-content|wp-json/i.test(x) && /contact|about|nosotros|equipo|team|quienes|chi-siamo|contatti|qui-sommes|over-ons|ueber|impressum|aviso-legal|legal|privacy|privacidad/i.test(x))
  const candidates = [...new Set([...linked, ...PATHS.map((x) => `${root}/${x}`)])].slice(0, 8)
  for (const url of candidates) {
    const p = await load(url)
    if (p.html && p.final?.startsWith(root) && p.final !== home.final) read(p.html, p.final)
  }

  const list = (s, n = 10) => [...s].slice(0, n)
  return {
    input,
    website: home.final,
    otherDomain: new URL(home.final).hostname.replace(/^www\./, "") !== u.hostname.replace(/^www\./, "") ? `redirects to ${new URL(home.final).hostname}` : undefined,
    warning: parked ? "looks like a parked domain or one for sale, the company may have closed or moved" : undefined,
    title, siteName: clean(meta(h, "og:site_name") || "") || undefined, description: clean(meta(h, "description") || meta(h, "og:description") || "").slice(0, 200) || undefined,
    linkedinCompany: list(r.linkedinCompany), linkedinPeople: list(r.linkedinPeople),
    roles: list(r.roles), legalName: list(r.legalName, 4), taxId: list(r.taxId, 3),
    emails: list(r.emails, 8), instagram: list(r.instagram, 3), pagesRead: [...new Set(r.pages)],
  }
}

const args = process.argv.slice(2)
if (!args.length) { console.error("Usage: node website-clues.mjs <website|domain> [...]"); process.exit(1) }
for (const a of args) {
  const res = await clues(a)
  console.log(JSON.stringify(res, (k, v) => (Array.isArray(v) && !v.length) || v === null ? undefined : v, 1))
}
