# Code

A few pieces from the tools on the [main page](../README.md), translated to English (the originals have Spanish names). The logic is the same code that runs in my projects.

| Folder | What's inside |
|---|---|
| `apify/` | Instagram and LinkedIn through Apify, with fallback across API keys. Node 18+, no dependencies |
| `discovery/` | Reads a company's website and pulls LinkedIn links, emails, Instagram, legal name and tax id. No API |
| `outreach/` | The day planner of the email engine (caps, sending windows, random drip, follow-ups first), A/B variants and spintax, with unit tests |

## Run it

```bash
npm install
npm test
```

The Apify scripts read `APIFY_TOKEN_1`, `APIFY_TOKEN_2`… from a `.env` file or the environment.

```bash
node apify/instagram.mjs profiles nike adidas
node apify/linkedin.mjs balance
node discovery/website-clues.mjs astraticnetwork.com
```
