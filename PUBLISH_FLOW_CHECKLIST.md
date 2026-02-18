# Publish Flow — Manual Test Checklist

Run this checklist after any changes touching the publish path
(`server.js`, `lib/markdown.js`, `src/lib/markdown.js`, `src/pages/Upload.jsx`).

---

## Setup
```
npm run build   # or npm run dev (Vite + nodemon)
node server.js  # prod; or npm run dev for dev
```
Open http://localhost:3456

---

## 1. Basic Publish
- [ ] Paste markdown with `# My Article` as first line
- [ ] Slug auto-populates as `my-article`
- [ ] Click **Publish** → button shows "Publishing…" while in-flight
- [ ] Toast: "Article published!" with "Copy URL" action
- [ ] Slug field updates to the server-canonicalized slug
- [ ] "Copy" and "Open" buttons appear in the header
- [ ] Visiting `/<slug>` shows the article with correct title, date, reading time

## 2. Article Update (same slug)
- [ ] Edit the same markdown and click Publish again
- [ ] Toast: "Article updated!" (not "published")
- [ ] `createdAt` in index.json is preserved; `updatedAt` is set
- [ ] Article content at `/<slug>` reflects the new content

## 3. Custom Slug
- [ ] Edit the slug field manually (e.g. `my-custom-slug`)
- [ ] Flag slugManual is set → changing the title no longer auto-updates slug
- [ ] Publish → `data.slug` from server response is synced to UI field
- [ ] Custom slug with invalid chars (uppercase, spaces) → server sanitizes →
      UI updates to show sanitized slug

## 4. Validation Errors
- [ ] Empty editor → Publish button disabled (grayed out)
- [ ] Content with no `# Title` → toast: "Article must have a title…"
- [ ] Server-side errors (500, disk full, etc.) → descriptive toast error

## 5. Editor Clear / New Article
- [ ] After publish, clear the textarea completely
- [ ] Slug field clears and resets to auto-generation mode
- [ ] Typing a new `# New Title` → slug auto-generates to `new-title`
- [ ] Published URL buttons remain until next successful publish

## 6. File Upload
- [ ] Drag-and-drop a `.md` file → content loads, slug auto-generates from title
- [ ] Click "or click here to upload a file" → file picker opens
- [ ] Non-`.md` file → toast error "Please select a .md, .markdown, or .txt file"

## 7. Mobile View
- [ ] At viewport < 768px, Editor/Preview tabs appear
- [ ] Tab switching works; publish button remains accessible

## 8. Article Page
- [ ] Title renders large in article header (not duplicated in body)
- [ ] Reading time and date shown under title
- [ ] Code blocks have syntax highlighting
- [ ] Charts render (if `chart` fence blocks present)
- [ ] OG meta tags set in page `<head>`
- [ ] Non-existent slug → 404 "Article Not Found" with back link

---

## Automated Validation Script
```bash
node scripts/validate-publish.js
```
(See `scripts/validate-publish.js` for what it tests)

---

## Known Remaining Risks
- `lib/markdown.js` (server) and `src/lib/markdown.js` (frontend) are separate files
  that must be kept in sync manually. See the NOTE comment in each file.
- No authentication — anyone with access to the server URL can publish articles.
- No edit/delete UI; manage files directly in `data/articles/` and `data/index.json`.
- Concurrent writes to the same article's `.md` file are not locked (OS race);
  last writer wins. Index updates are serialized via `withIndexLock`.
