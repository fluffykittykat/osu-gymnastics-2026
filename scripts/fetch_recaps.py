#!/usr/bin/env python3
"""Fetch meet recaps from osubeavers.com and add to meets.json."""

import json
import re
import time
import urllib.request

RECAP_URLS = {
    'best-of-west-jan-3': 'https://osubeavers.com/news/2026/1/3/womens-gymnastics-espositos-strong-meet-helps-beavers-at-best-of-the-west-quad',
    'byu-jan-9': 'https://osubeavers.com/news/2026/1/9/womens-gymnastics-strong-foor-rotation-not-enough-in-loss-at-byu',
    'sac-state-jan-16': 'https://osubeavers.com/news/2026/1/16/womens-gymnastics-espositos-39-500-helps-beavers-to-home-victory',
    'utah-state-jan-25': 'https://osubeavers.com/news/2026/1/25/womens-gymnastics-beaver-bars-set-the-tone-in-victory-over-23rd-ranked-utah-state',
    'alabama-jan-30': 'https://osubeavers.com/news/2026/1/30/womens-gymnastics-beaver-gymnastics-falls-to-no-3-alabama',
    'boise-state-feb-6': 'https://osubeavers.com/news/2026/2/6/womens-gymnastics-comeback-falls-short-at-boise-state-quad-meet',
    'southern-utah-feb-14': 'https://osubeavers.com/news/2026/2/14/womens-gymnastics-season-highs-on-beam-and-floor-not-enough-in-loss-to-suu',
    'twu-quad-feb-22': 'https://osubeavers.com/news/2026/2/22/womens-gymnastics-beavers-finish-second-at-twu-quad-meet',
    'stanford-feb-27': 'https://osubeavers.com/news/2026/2/27/womens-gymnastics-espositos-career-night-leads-season-high-score',
    'utah-state-mar-6': 'https://osubeavers.com/news/2026/3/6/womens-gymnastics-beaver-gymnastics-falls-to-utah-state',
}


def strip_html(html):
    """Remove HTML tags from a string."""
    return re.sub(r'<[^>]+>', '', html)


def fetch_recap(url):
    """Fetch a recap page and extract article text before Related News."""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode('utf-8', errors='replace')

    # Strip HTML tags first
    text = strip_html(html)

    # Find "Related News" as end marker
    end_idx = text.find('Related News')
    if end_idx < 0:
        return None

    # Look backwards from Related News for a city name in ALL CAPS (article lede)
    chunk = text[max(0, end_idx - 5000):end_idx]
    # Match city lede: ALL-CAPS CITY, State abbrev. followed by em-dash
    match = re.search(
        r'([A-Z]{4,}(?:\s[A-Z]+)*,\s*\w+\.?\s*[\u2013\u2014–—-]+)', chunk
    )
    if match:
        start = chunk.index(match.group(0))
        recap = chunk[start:].strip()
    else:
        return None

    # Normalize whitespace
    lines = recap.split('\n')
    cleaned = []
    for line in lines:
        stripped = line.strip()
        if stripped:
            cleaned.append(stripped)
        else:
            cleaned.append('')
    recap = '\n'.join(cleaned)
    # Collapse runs of 3+ newlines to 2
    recap = re.sub(r'\n{3,}', '\n\n', recap)
    # Remove non-breaking spaces
    recap = recap.replace('\xa0', ' ')
    # Remove the OUR MISSION boilerplate at the end
    mission_idx = recap.find('OUR MISSION')
    if mission_idx > 0:
        recap = recap[:mission_idx].strip()
    return recap.strip()


def main():
    with open('data/meets.json', 'r') as f:
        meets = json.load(f)

    for meet in meets:
        mid = meet['id']
        url = RECAP_URLS.get(mid)
        if not url:
            print(f'  No URL for {mid}, skipping')
            continue

        print(f'Fetching recap for {mid}...')
        try:
            recap = fetch_recap(url)
            if recap:
                meet['recap'] = recap
                meet['recapUrl'] = url
                print(f'  OK ({len(recap)} chars)')
            else:
                print(f'  No recap text found between CORVALLIS and Related News')
        except Exception as e:
            print(f'  Error: {e}')

        time.sleep(1)

    with open('data/meets.json', 'w') as f:
        json.dump(meets, f, indent=2)

    print('Done! Updated data/meets.json')


if __name__ == '__main__':
    main()
