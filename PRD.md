# mdpage — PRD

**One markdown file → one beautiful page.**

No blog, no nav, no CMS. Upload a `.md` file, get a shareable page. The article *is* the site.

---

## What We're Building

A lightweight web app with two views:

1. **Upload view** — drop an .md file (or paste markdown), hit publish, get a URL
2. **Article view** — the published page itself, rendered with a single opinionated design

That's it. No accounts, no dashboards, no settings panels. Personal tool first — just get markdown on screen and make it look great.

---

## Upload View

**Route:** `/`

**Flow:**
1. User lands on a clean, minimal page
2. Drag-and-drop an `.md` file or paste raw markdown into a text area
3. Optionally set a custom slug (auto-generated from title if left blank)
4. Hit "Publish"
5. Get back the article URL — copy it, done

**Details:**
- Extract the first `# heading` as the page title (used in `<title>` tag and OG meta)
- Auto-generate slug from title (lowercase, hyphens, no special chars) if not provided
- Show a preview of the rendered article before publishing (toggle or side-by-side)
- If a slug already exists, warn and offer to overwrite
- No auth for now — it's a personal tool running locally or on our VPS

---

## Article View

**Route:** `/:slug`

**Design philosophy:** The design is the product's opinion, not the user's. Every article that comes through looks the same — same font, same spacing, same layout, same feel. The user uploads markdown and the tool handles all presentation. No theming, no customization, no choices. That consistency *is* the feature.

Think of the best long-form article you've read online, minus everything around it. One column, generous whitespace, beautiful typography. The kind of page where you just start reading.

**Layout:**
- Max content width ~680px, centered
- One curated font pairing (we pick it, it ships with every page — leaning toward a clean serif for body + sans-serif for headings, or all sans-serif done well)
- Monospace for code blocks with subtle background
- Title rendered large and bold at the top
- No header, no footer, no nav — just the content
- Subtle metadata line under the title: publish date, reading time estimate
- Consistent vertical rhythm and spacing between all elements — this is what makes it feel "designed" vs. "rendered"

**Markdown support:**
- Standard GFM (GitHub Flavored Markdown): headings, bold, italic, links, images, lists, blockquotes, code blocks (with syntax highlighting), tables, horizontal rules, task lists
- Images: render inline, max-width 100% of content area, centered
- Footnotes if the parser supports them easily

**Meta & sharing:**
- Proper `<title>` from the first heading
- Open Graph tags (og:title, og:description from first paragraph, og:type=article)
- Clean, readable URL: `domain.com/my-article-slug`
- Responsive — looks good on mobile without extra work

---

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express (or Fastify — keep it simple)
- **Frontend:** Vanilla HTML/CSS + minimal JS. No React needed for two pages. If we want components later, we add them later.
- **Markdown parsing:** `markdown-it` (fast, extensible, GFM support) + `highlight.js` for syntax highlighting
- **Storage:** Local filesystem for now
  - Published articles stored as `.md` files in a `data/` directory
  - A `meta.json` sidecar per article (slug, title, created date, etc.) — or a single `index.json` mapping slugs → metadata
- **Styling:** Single CSS file, hand-crafted. The design *is* the product — no framework needed.

---

## File Structure (Proposed)

```
mdpage/
├── PRD.md
├── package.json
├── server.js            # Express app, routes
├── data/                # Published articles (gitignored)
│   └── index.json       # slug → metadata mapping
├── public/
│   ├── style.css        # The one stylesheet
│   ├── upload.js        # Upload page interactivity
│   └── highlight.css    # Syntax highlighting theme
├── views/
│   ├── upload.html       # Upload/paste page
│   └── article.html      # Article template
└── lib/
    └── markdown.js       # Markdown parsing config
```

---

## What's Explicitly Out of Scope (For Now)

- User accounts / auth
- Database (SQLite, Postgres, etc.)
- Custom themes or design options
- Edit/delete UI (can manage files directly for now)
- Custom domains
- Analytics
- Comments
- RSS feed
- Image upload (images in markdown must be URLs for now)

These are all reasonable future features. We're not building them yet.

---

## Open Questions

1. **Dark mode** — worth doing from day one? It's not hard with CSS variables, and reading-focused tools kind of expect it.
2. **Port / deployment** — run on the VPS alongside OpenClaw? Just pick a port and go?
3. **Article listing** — even a minimal `/all` page that lists published articles? Or truly just upload + view?

---

## Success Criteria

You can take any `.md` file, upload it, and send someone a link to a page that looks good enough they don't think about the design — they just read.
