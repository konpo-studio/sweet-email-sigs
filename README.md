# Sweet & Simple Sigs

Beautiful, typographic email signatures that survive Gmail, Outlook and Apple Mail. Free, table-based, inline-styled, web-safe. Made by **Konpo Studio**.

🔗 **Live**: [konpo-signatures.vercel.app](https://konpo-signatures.vercel.app)

## What's in the box

- 12 distinct layouts — Editorial, Manifest, Stacked, Lockup, Masthead, Headline, Compact, Banner, Wildin' Out, Brutalist, Architect, Minimal AF
- Avatar + logo badge composited into a single retina-sharp JPEG (works in Gmail's signature settings)
- Single-accent design system — change the color and the whole UI re-skins
- Display + secondary font picker (lazy-loaded Google Fonts)
- Social links incl. LinkedIn, X, Instagram, GitHub, Dribbble, Pinterest, Substack
- Extra custom links with icon picker
- Sharable signature via URL (state encoded in the address bar, shortened via is.gd)
- One-click Copy signature / Copy HTML / Download .html
- Save / History (localStorage)
- Mobile-stacked output by design

## Stack

Single-file static HTML + a Vercel serverless function for URL shortening:

```
.
├── index.html          # the whole app
├── api/shorten.js      # /api/shorten?url=... → is.gd proxy
├── og.svg              # Open Graph image
├── favicon.svg         # animated SVG favicon
├── robots.txt
├── sitemap.xml
└── vercel.json         # cleanUrls + alias config
```

No build step. Open `index.html` locally or deploy to Vercel.

## Deploy

```bash
vercel deploy --prod
```

The alias `konpo-signatures.vercel.app` is wired in `vercel.json` and auto-attaches to each prod build.

## Built by Konpo

[konpo.studio](https://konpo.studio)
