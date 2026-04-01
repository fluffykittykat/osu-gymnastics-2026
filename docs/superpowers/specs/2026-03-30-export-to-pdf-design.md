# Export to PDF — Design Spec

**Date:** 2026-03-30
**Status:** Approved

## Summary

Add an "Export to PDF" button to the top navigation bar that triggers the browser's native print dialog. Users can then save the current view as a PDF. No new dependencies — implemented entirely with `@media print` CSS and a small JS click handler.

## Button Placement

- Small print/export icon button added to the top nav bar in both `index.html` and `notes.html`
- Positioned alongside existing controls (before or after existing header-right actions)
- Icon: a printer or download icon (CSS/Unicode, no image asset)
- Tooltip: "Export to PDF"
- On click: calls `window.print()`

## What Gets Hidden in Print

All interactive and navigational chrome is hidden via `@media print` rules:

- Top navigation bar (`nav.top-nav`)
- Bottom navigation bar (`nav.bottom-nav`)
- Chatbot widget (`#chatbot-widget`)
- Search bars and search-related UI
- Filter pills and tab selectors
- Refresh/live-update buttons and indicators
- The export button itself
- Any floating elements, tooltips, animations

## What Gets Printed

Only the currently visible view content, with print-friendly styling:

- White background, black text
- Proper margins for paper
- Tables and cards laid out for readability (no dark theme)
- Images and charts preserved where possible
- No CSS animations or transitions
- A simple header with "OSU Gymnastics" branding at the top of the printed page

### Per-View Notes

| View | Print Content |
|------|--------------|
| Season overview | Meet cards in clean list/grid layout |
| Gymnast profile | Profile info, stats tables, score history |
| Meet details | Full meet breakdown with scores |
| Leaderboards | Currently selected tab's ranking table only |
| Insights | Currently visible analysis sections |
| Notes page | Note cards grid, or open modal content |

## Technical Approach

### Files Modified

1. **`public/index.html`** — Add export button to top nav
2. **`public/notes.html`** — Add export button to top nav
3. **`public/css/style.css`** — Add `@media print` rules for main app
4. **`public/css/notes.css`** — Add `@media print` rules for notes page
5. **`public/css/chatbot.css`** — Already hides chatbot in print (extend if needed)

### No New Files or Dependencies

- No JS libraries
- No server-side changes
- No new CSS files (print styles go in existing stylesheets)

## Out of Scope

- Server-side PDF generation
- Custom PDF formatting beyond what print CSS provides
- Automatic filename setting (browser controls this)
- Refresh button behavior changes (refresh remains in UI, just hidden in print)
