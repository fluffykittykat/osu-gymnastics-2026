# Save as New Note from Report Pages

**Date:** 2026-04-01
**Status:** Approved

## Problem

When a user is on a report page (`/notes/[id].html`) and has a chat conversation with the AI assistant, the only save option is "Regenerate Report" which appends the chat to the current note. There is no way to save the chat as a completely new, independent note.

## Solution

Add a "Save as New Note" button alongside the existing "Regenerate Report" button on report pages.

### Behavior

- **"Regenerate Report"** (existing) — appends chat to the current note via `POST /api/analyses/:id/append`, regenerates the report HTML
- **"Save as New Note"** (new) — shows the standard save form (title, summary, category picker) and creates a brand new note via `POST /api/analyses`, then redirects to `/notes.html`

### Files Changed

1. **`server.js`** — `writeReportPage()` function's inline `<script>` block:
   - Add a second button ("Save as New Note") to the `chatbotSaveArea`
   - Wire the new button to show the standard chatbot save form
   - Override the save form's submit to call `POST /api/analyses` (new note creation) instead of the append endpoint
   - On success, redirect to `/notes.html`

2. **`chatbot.css`** — Minor styling for two-button layout in `.chatbot-save-area`

### No Backend Changes

Both endpoints already exist:
- `POST /api/analyses` — creates a new note
- `POST /api/analyses/:id/append` — appends to existing note

### UI Layout

```
[ Regenerate Report ]  [ Save as New Note ]
```

Both buttons use the existing `.chatbot-save-btn` styling. The save area flexes to fit both buttons side by side.

### User Flow

1. User is on a report page, chats with the AI
2. Two buttons appear: "Regenerate Report" and "Save as New Note"
3. Clicking "Regenerate Report" works as before (direct append + regenerate)
4. Clicking "Save as New Note" shows the inline save form (title, summary, category)
5. User fills in the form and clicks Save
6. New note is created via `POST /api/analyses`
7. User is redirected to `/notes.html`

### Edge Cases

- If the user has no chat messages (only the greeting), both buttons should be hidden or disabled
- The save form's cancel button should hide the form and restore the two-button view
