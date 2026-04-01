# Update Report Direct-Send Button on Report Pages

**Date:** 2026-04-01
**Status:** Approved

## Problem

On report pages, updating a report requires too many steps: type in chatbot → wait for chat response → click Regenerate Report. Users often just want to give a directive ("add beam comparison section") without needing an intermediate chat response.

## Solution

Add an "Update Report" button below the chatbot input area on report pages. It sends the user's text directly to the report regeneration pipeline, skipping the chat API entirely.

### User Flow

1. User types a prompt in the chatbot input
2. Clicks "Update Report"
3. Prompt is appended to the analysis chat history via `POST /api/analyses/:id/append`
4. Report regenerates and page auto-refreshes

### Files Changed

1. **`server.js`** — `writeReportPage()` inline script: add "Update Report" button, wire to take input → append → regenerate → poll
2. **`public/css/chatbot.css`** — `.chatbot-update-report-btn` styling

### No Backend Changes

`POST /api/analyses/:id/append` already handles appending chat and regenerating.

### Edge Cases

- Empty input: do nothing
- Already regenerating: disable button
- Normal Send button still works for chat as before
