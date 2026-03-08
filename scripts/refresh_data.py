#!/usr/bin/env python3
"""
Smart refresh script for OSU Gymnastics data.
Re-scrapes schedule page, re-downloads updated PDFs, detects mid-meet state.
Outputs a JSON summary to stdout. Idempotent — safe to run multiple times.
"""

import json
import os
import sys
import re
import hashlib
import urllib.request
from datetime import datetime, timezone, timedelta

# Import the existing parser functions
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_pdfs import (
    MEETS, DOWNLOAD_DIR, OUTPUT_FILE,
    download_pdfs, parse_meet_pdf,
)

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "pdf_cache")


def get_today_pt():
    """Get today's date in Pacific Time (UTC-8 or UTC-7 during DST)."""
    # Approximate PT as UTC-8 (PST); close enough for date comparison
    pt_offset = timedelta(hours=-8)
    return (datetime.now(timezone.utc) + pt_offset).strftime("%Y-%m-%d")


def get_cache_key(url):
    """Extract timestamp from S3 URL for cache keying."""
    match = re.search(r"timestamp=(\d+)", url)
    if match:
        return match.group(1)
    # Fallback: hash the URL
    return hashlib.md5(url.encode()).hexdigest()


def should_refetch_pdf(meet_info, existing_meets_map):
    """Determine if a PDF should be re-downloaded."""
    meet_id = meet_info["id"]
    today = get_today_pt()
    meet_date = meet_info["date"]

    # Always re-fetch today's meet
    if meet_date == today:
        return True

    # Re-fetch if meet was previously in_progress
    existing = existing_meets_map.get(meet_id)
    if existing and existing.get("status") == "in_progress":
        return True

    # Check if cached version matches current URL timestamp
    cache_key = get_cache_key(meet_info["url"])
    cache_path = os.path.join(CACHE_DIR, f"{meet_id}_{cache_key}.pdf")
    if not os.path.exists(cache_path):
        # No cached version with this timestamp — need to fetch
        pdf_path = os.path.join(DOWNLOAD_DIR, f"{meet_id}.pdf")
        if not os.path.exists(pdf_path):
            return True

    return False


def detect_meet_status(meet_info, meet_data):
    """Detect whether a meet is upcoming, in_progress, or final."""
    today = get_today_pt()
    meet_date = meet_info["date"]

    if meet_date > today:
        return "upcoming"

    if meet_date == today:
        # Today's meet — check if we have full scores
        if meet_data is None:
            return "in_progress"

        # If we have data, check if all 4 events have reasonable scores
        if isinstance(meet_data, list):
            sample = meet_data[0] if meet_data else None
        else:
            sample = meet_data

        if sample:
            events = sample.get("events", {})
            all_events_scored = all(
                events.get(e, {}).get("osu", 0) > 40
                for e in ["vault", "bars", "beam", "floor"]
            )
            if all_events_scored and sample.get("osuScore", 0) > 180:
                return "final"  # Looks complete
            return "in_progress"

        return "in_progress"

    # Past date — final
    return "final"


def load_existing_meets():
    """Load existing meets.json if it exists."""
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, "r") as f:
            existing = json.load(f)
        return {m["id"]: m for m in existing}
    return {}


def refresh():
    """Main refresh logic. Returns summary dict."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    existing_meets_map = load_existing_meets()

    # Ensure directories exist
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)

    # Download any missing PDFs
    download_pdfs()

    # Track stats
    meets_updated = 0
    meets_in_progress = 0
    new_meets = 0
    pdfs_refetched = 0
    all_meets = []

    for info in MEETS:
        # Check if we should re-fetch the PDF
        if should_refetch_pdf(info, existing_meets_map):
            pdf_path = os.path.join(DOWNLOAD_DIR, f"{info['id']}.pdf")
            try:
                urllib.request.urlretrieve(info["url"], pdf_path)
                pdfs_refetched += 1
                # Cache it
                cache_key = get_cache_key(info["url"])
                cache_path = os.path.join(CACHE_DIR, f"{info['id']}_{cache_key}.pdf")
                if not os.path.exists(cache_path):
                    import shutil
                    shutil.copy2(pdf_path, cache_path)
            except Exception:
                pass  # Use existing PDF if download fails

        # Parse the meet
        try:
            data = parse_meet_pdf(info)
        except Exception:
            data = None

        if data is None:
            continue

        # Determine status
        status = detect_meet_status(info, data)

        # Handle quad meets (list) vs single meets
        records = data if isinstance(data, list) else [data]

        for record in records:
            record["status"] = status
            record["lastRefreshed"] = now

            if status == "in_progress":
                meets_in_progress += 1

            # Check if this is new or updated
            old = existing_meets_map.get(record["id"])
            if old is None:
                new_meets += 1
                meets_updated += 1
            elif (old.get("osuScore") != record.get("osuScore") or
                  old.get("opponentScore") != record.get("opponentScore") or
                  old.get("status") != record.get("status")):
                meets_updated += 1

            all_meets.append(record)

    # Write updated meets.json
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(all_meets, f, indent=2)

    summary = {
        "meetsTotal": len(all_meets),
        "meetsUpdated": meets_updated,
        "meetsInProgress": meets_in_progress,
        "newMeets": new_meets,
        "pdfsRefetched": pdfs_refetched,
        "recapsFetched": 0,
        "timestamp": now,
    }

    return summary


if __name__ == "__main__":
    summary = refresh()
    print(json.dumps(summary))
