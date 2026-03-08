#!/usr/bin/env python3
"""
Fetch meet recap articles from osubeavers.com and embed them into meets.json.
"""

import json
import os
import re
import urllib.request

RECAP_URLS = {
    "best-of-west": "https://osubeavers.com/news/2026/1/3/womens-gymnastics-espositos-strong-meet-helps-beavers-at-best-of-the-west-quad",
    "byu-jan-9": "https://osubeavers.com/news/2026/1/9/womens-gymnastics-strong-foor-rotation-not-enough-in-loss-at-byu",
    "sac-state-jan-16": "https://osubeavers.com/news/2026/1/16/womens-gymnastics-espositos-39-500-helps-beavers-to-home-victory",
    "utah-state-jan-25": "https://osubeavers.com/news/2026/1/25/womens-gymnastics-beaver-bars-set-the-tone-in-victory-over-23rd-ranked-utah-state",
    "alabama-jan-30": "https://osubeavers.com/news/2026/1/30/womens-gymnastics-beaver-gymnastics-falls-to-no-3-alabama",
    "boise-state-quad": "https://osubeavers.com/news/2026/2/6/womens-gymnastics-comeback-falls-short-at-boise-state-quad-meet",
    "southern-utah-feb-14": "https://osubeavers.com/news/2026/2/14/womens-gymnastics-season-highs-on-beam-and-floor-not-enough-in-loss-to-suu",
    "twu-quad": "https://osubeavers.com/news/2026/2/22/womens-gymnastics-beavers-finish-second-at-twu-quad-meet",
    "stanford-feb-27": "https://osubeavers.com/news/2026/2/27/womens-gymnastics-espositos-career-night-leads-season-high-score",
    "utah-state-mar-6": "https://osubeavers.com/news/2026/3/6/womens-gymnastics-beaver-gymnastics-falls-to-utah-state",
}

# Map meet IDs to their recap key (quad meets share a recap)
MEET_ID_TO_RECAP = {
    "best-of-west-washington-jan-3": "best-of-west",
    "best-of-west-california-jan-3": "best-of-west",
    "best-of-west-ucla-jan-3": "best-of-west",
    "byu-jan-9": "byu-jan-9",
    "sac-state-jan-16": "sac-state-jan-16",
    "utah-state-jan-25": "utah-state-jan-25",
    "alabama-jan-30": "alabama-jan-30",
    "boise-state-quad-boise-feb-6": "boise-state-quad",
    "boise-state-quad-sjsu-feb-6": "boise-state-quad",
    "boise-state-quad-ucdavis-feb-6": "boise-state-quad",
    "boise-state-quad-san-jose-state-feb-6": "boise-state-quad",
    "southern-utah-feb-14": "southern-utah-feb-14",
    "twu-quad-kent-feb-22": "twu-quad",
    "twu-quad-asu-feb-22": "twu-quad",
    "twu-quad-twu-feb-22": "twu-quad",
    "twu-quad-kent-state-feb-22": "twu-quad",
    "twu-quad-arizona-state-feb-22": "twu-quad",
    "twu-quad-texas-woman-s-feb-22": "twu-quad",
    "stanford-feb-27": "stanford-feb-27",
    "utah-state-mar-6": "utah-state-mar-6",
}

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
MEETS_FILE = os.path.join(DATA_DIR, "meets.json")


def fetch_recap(url):
    """Fetch a recap article and extract the body text."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  Failed to fetch {url}: {e}")
        return None

    # Strip scripts and styles
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL)

    # Convert to plain text
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n", "\n\n", text)

    # Try to extract between CORVALLIS/city dateline and Related News
    cities = ["CORVALLIS", "PROVO", "SEATTLE", "TUSCALOOSA", "BOISE", "DENTON", "LOGAN"]
    idx = -1
    for city in cities:
        idx = text.find(city)
        if idx >= 0:
            break

    if idx < 0:
        # Fallback: look for the article body area
        idx = text.find("Ore.")
        if idx < 0:
            idx = text.find("Utah")

    end = len(text)
    for marker in ["Related News", "Related Stories", "RELATED NEWS"]:
        pos = text.find(marker, max(idx, 0))
        if pos > 0:
            end = min(end, pos)
            break

    if idx >= 0:
        excerpt = text[idx:end].strip()
        # Clean up: remove excessive whitespace, normalize paragraphs
        lines = [l.strip() for l in excerpt.split("\n") if l.strip()]
        return "\n\n".join(lines)

    return None


def main():
    print("=== Fetching Meet Recaps ===\n")

    # Fetch all unique recaps
    recaps = {}
    for key, url in RECAP_URLS.items():
        print(f"Fetching {key}...")
        text = fetch_recap(url)
        if text:
            recaps[key] = {"text": text, "url": url}
            print(f"  OK ({len(text)} chars)")
        else:
            print(f"  FAILED")

    # Load meets.json and add recaps
    with open(MEETS_FILE, "r") as f:
        meets = json.load(f)

    updated = 0
    for meet in meets:
        recap_key = MEET_ID_TO_RECAP.get(meet["id"])
        if recap_key and recap_key in recaps:
            meet["recap"] = recaps[recap_key]["text"]
            meet["recapUrl"] = recaps[recap_key]["url"]
            updated += 1

    with open(MEETS_FILE, "w") as f:
        json.dump(meets, f, indent=2)

    print(f"\nUpdated {updated}/{len(meets)} meets with recaps")
    print(f"Wrote to {MEETS_FILE}")


if __name__ == "__main__":
    main()
