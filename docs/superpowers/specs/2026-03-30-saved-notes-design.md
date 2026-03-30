# Design Spec: Saved Notes & Analysis (#67)

**Date:** 2026-03-30
**Issue:** #67 — Saved Notes & Analysis - User notebook for chatbot insights
**Status:** Approved

## Problem

Chatbot conversations are ephemeral — stored only in browser localStorage. Users can't save valuable analyses, revisit insights, or build a knowledge base over time. Data doesn't persist across devices.

## Solution: Server-Side Saved Analyses with Dedicated Notes Page

### Architecture

```
Frontend (chatbot.js)
├── "Save This Chat" button after conversation
└── Save modal (title, summary, category)

Frontend (notes page)
├── /notes route — list all saved analyses
├── Detail view — full chat + insights
└── Add insight form

Backend (server.js)
├── POST /api/analyses — save new analysis
├── GET /api/analyses — list all
├── GET /api/analyses/:id — get one with insights
├── POST /api/analyses/:id/insights — add insight
├── PUT /api/analyses/:id — update title/category
└── DELETE /api/analyses/:id — delete

Storage
└── data/saved-analyses.json — server-side JSON file
```

### Data Schema

```json
{
  "id": "1711835400000-a1b2c3d4e",
  "title": "Savannah Mill Season Analysis",
  "summary": "Optional summary text",
  "category": "Athlete Performance",
  "chatHistory": [
    {"role": "user", "content": "How has Savannah done?"},
    {"role": "assistant", "content": "Savannah has performed..."}
  ],
  "insights": [
    {"id": "ins_123", "content": "Strongest on vault", "createdAt": "2026-03-29T22:00:00Z"},
    {"id": "ins_124", "content": "Consistency improved", "createdAt": "2026-03-29T22:05:00Z"}
  ],
  "createdAt": "2026-03-29T22:00:00Z",
  "updatedAt": "2026-03-29T22:30:00Z"
}
```

### API Endpoints

**POST /api/analyses** — Save new analysis
- Body: `{ title, summary?, category?, chatHistory }`
- Returns: Created analysis with generated id
- Creates file if missing

**GET /api/analyses** — List all saved analyses
- Returns: Array of analyses (with truncated chatHistory preview)
- Sorted by updatedAt descending

**GET /api/analyses/:id** — Get specific analysis
- Returns: Full analysis with all insights and chat history

**POST /api/analyses/:id/insights** — Add insight
- Body: `{ content }`
- Returns: Updated analysis
- Updates `updatedAt` timestamp

**PUT /api/analyses/:id** — Update analysis metadata
- Body: `{ title?, summary?, category? }`
- Returns: Updated analysis

**DELETE /api/analyses/:id** — Delete analysis
- Returns: `{ success: true }`

### Frontend — Chat Interface Enhancement

Add to chatbot.js:
- "Save This Chat" button appears after 2+ message exchanges
- Click opens a modal/form:
  - Title field (required)
  - Summary textarea (optional)
  - Category dropdown: "Athlete Performance", "Team Analysis", "Event Breakdown", "Comparison", "Custom"
- On save: POST to `/api/analyses`, show success confirmation
- Button disabled during save, re-enabled on complete

### Frontend — Notes Page

New page at `/notes` (or section in existing app):
- **List view:** Cards showing title, date, category, preview
- **Filters:** All | by category
- **Detail view:** Click card to expand
  - Full chat transcript rendered with same markdown formatting as chatbot
  - Insights section below with timestamps
  - "Add Insight" button → textarea + save
  - Edit title/category inline
  - Delete with confirmation
- **Responsive:** Works on mobile

### Storage Implementation

- File: `data/saved-analyses.json`
- Read/write via `fs.readFileSync()` / `fs.writeFileSync()`
- Create empty array `[]` if file doesn't exist
- ID generation: `Date.now() + '-' + Math.random().toString(36).substr(2, 9)`
- No file locking needed at current scale (single server, low concurrency)

## Changes Required

| Component | Change |
|-----------|--------|
| `server.js` | 6 new API endpoints for CRUD operations |
| `server.js` | File I/O helpers for saved-analyses.json |
| `public/js/chatbot.js` | Save button + modal in chat widget |
| `public/notes.html` | New page for saved analyses |
| `public/js/notes.js` | New JS for notes page functionality |
| `public/css/notes.css` | Styling for notes page |
| `public/index.html` | Nav link to /notes |
| `data/saved-analyses.json` | New data file (created on first save) |

## Acceptance Criteria

- [ ] "Save This Chat" button appears in chatbot after conversation
- [ ] Save modal captures title and optional summary/category
- [ ] Saved analyses persist in data/saved-analyses.json
- [ ] /notes page shows all saved analyses as cards
- [ ] Click on saved analysis shows full chat + insights
- [ ] Users can add new insights to saved analyses
- [ ] Insights display chronologically with timestamps
- [ ] Can edit/delete saved analyses
- [ ] Data persists across browser sessions (server-side)
- [ ] Data persists across server restarts (file-based)
- [ ] Mobile-responsive design
- [ ] Consistent OSU branding (Scarlet/Gold)
