#!/usr/bin/env python3
"""
Smart refresh script for OSU Gymnastics data.
Idempotent: safe to run multiple times without corrupting data.
Outputs a JSON summary to stdout.
"""

import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, date
from pypdf import PdfReader
import io

SCHEDULE_URL = "https://osubeavers.com/sports/womens-gymnastics/schedule"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "data")
PDF_CACHE_DIR = os.path.join(DATA_DIR, "pdf_cache")
OUTPUT_FILE = os.path.join(DATA_DIR, "meets.json")

MEETS_CONFIG = [
    {
        "id": "best-of-west-jan-3", "date": "2026-01-03",
        "location": "Alaska Airlines Arena, Seattle, WA", "isHome": False,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/1/4/Best_of_the_West_Final_Scores.pdf?timestamp=20260104035128",
        "isQuad": True, "quadName": "Best of the West Quad", "idPrefix": "best-of-west",
    },
    {
        "id": "byu-jan-9", "date": "2026-01-09", "opponent": "BYU",
        "location": "Smith Fieldhouse, Provo, UT", "isHome": False,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/1/10/BYU_vs_Oregon_State_Scoresheet.pdf?timestamp=20260110061207",
    },
    {
        "id": "sac-state-jan-16", "date": "2026-01-16", "opponent": "Sacramento State",
        "location": "Gill Coliseum, Corvallis, OR", "isHome": True,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/1/17/SacStateFINAL.pdf?timestamp=20260117053515",
    },
    {
        "id": "utah-state-jan-25", "date": "2026-01-25", "opponent": "Utah State",
        "location": "Gill Coliseum, Corvallis, OR", "isHome": True,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/1/25/Oregon_State_vs_Utah_State_-_AlHNJ9aEOB___1_25_2026___03_31_21_pm_PST.pdf?timestamp=20260125113426",
    },
    {
        "id": "alabama-jan-30", "date": "2026-01-30", "opponent": "Alabama",
        "location": "Coleman Coliseum, Tuscaloosa, AL", "isHome": False,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/1/31/AlabamaFINAL.pdf?timestamp=20260131043916",
        "hardcoded": {
            "osuScore": 195.825, "opponentScore": 197.450, "result": "L",
            "events": {
                "vault": {"osu": 49.175, "opponent": 49.200},
                "bars": {"osu": 48.850, "opponent": 49.500},
                "beam": {"osu": 49.075, "opponent": 49.375},
                "floor": {"osu": 48.725, "opponent": 49.375},
            },
            "athletes": [
                {"name": "Olivia Buckner", "team": "Oregon State", "scores": {"vault": 9.875, "beam": 9.875}},
                {"name": "Francesca Caso", "team": "Oregon State", "scores": {"bars": 9.525}},
                {"name": "Kaylee Cheek", "team": "Oregon State", "scores": {"bars": 9.600, "beam": 9.700}},
                {"name": "Kyanna Crabb", "team": "Oregon State", "scores": {"vault": 9.800}},
                {"name": "Taylor DeVries", "team": "Oregon State", "scores": {"bars": 9.825}},
                {"name": "Sophia Esposito", "team": "Oregon State", "scores": {"vault": 9.850, "bars": 9.900, "beam": 9.825, "floor": 9.825, "aa": 39.400}},
                {"name": "Mia Heather", "team": "Oregon State", "scores": {"beam": 9.775}},
                {"name": "Sophia Kaloudis", "team": "Oregon State", "scores": {"floor": 9.650}},
                {"name": "Lauren Letzsch", "team": "Oregon State", "scores": {"beam": 9.900}},
                {"name": "Reina Marchal", "team": "Oregon State", "scores": {"vault": 9.750, "floor": 9.725}},
                {"name": "Savannah Miller", "team": "Oregon State", "scores": {"vault": 9.775, "bars": 9.750, "floor": 9.775}},
                {"name": "Camryn Richardson", "team": "Oregon State", "scores": {"vault": 9.875, "bars": 9.850, "floor": 9.750}},
                {"name": "Katie Rude", "team": "Oregon State", "scores": {"vault": 9.750}},
                {"name": "Ellie Weaver", "team": "Oregon State", "scores": {"beam": 9.700}},
            ],
        },
    },
    {
        "id": "boise-state-feb-6", "date": "2026-02-06",
        "location": "ExtraMile Arena, Boise, ID", "isHome": False,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/2/7/BoiseStateNoJudges.pdf?timestamp=20260207062723",
        "isQuad": True, "quadName": "Boise State Quad", "idPrefix": "boise-state-quad",
        "attendance": "2,677",
    },
    {
        "id": "southern-utah-feb-14", "date": "2026-02-14", "opponent": "Southern Utah",
        "location": "Gill Coliseum, Corvallis, OR", "isHome": True,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/2/15/Oregon_State_vs_Southern_Utah___Official_Score_Sheet___Oregon_State.pdf?timestamp=20260215123952",
    },
    {
        "id": "twu-quad-feb-22", "date": "2026-02-22",
        "location": "Kitty Magee Arena, Denton, TX", "isHome": False,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/2/22/TWU_Results.pdf?timestamp=20260222115459",
        "isQuad": True, "quadName": "TWU Quad", "idPrefix": "twu-quad",
    },
    {
        "id": "stanford-feb-27", "date": "2026-02-27", "opponent": "Stanford",
        "location": "Gill Coliseum, Corvallis, OR", "isHome": True,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/2/28/Stanford_no_judges.pdf?timestamp=20260228060256",
    },
    {
        "id": "utah-state-mar-6", "date": "2026-03-06", "opponent": "Utah State",
        "location": "Dee Glen Smith Spectrum, Logan, UT", "isHome": False,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/3/7/Utah_State_vs._Oregon_State_-_Blank_Scoresheet.pdf?timestamp=20260307041803",
        "hardcoded": {
            "osuScore": 196.150, "opponentScore": 196.950, "result": "L",
            "events": {
                "vault": {"osu": 48.975, "opponent": 49.225},
                "bars": {"osu": 49.050, "opponent": 49.175},
                "beam": {"osu": 49.075, "opponent": 49.375},
                "floor": {"osu": 49.050, "opponent": 49.175},
            },
            "athletes": [
                {"name": "Olivia Buckner", "team": "Oregon State", "scores": {"vault": 9.825, "beam": 9.775}},
                {"name": "Francesca Caso", "team": "Oregon State", "scores": {"bars": 9.700}},
                {"name": "Kaylee Cheek", "team": "Oregon State", "scores": {"bars": 9.825, "beam": 9.825}},
                {"name": "Kyanna Crabb", "team": "Oregon State", "scores": {"vault": 9.750}},
                {"name": "Taylor DeVries", "team": "Oregon State", "scores": {"bars": 9.850, "floor": 9.800}},
                {"name": "Sophia Esposito", "team": "Oregon State", "scores": {"vault": 9.850, "bars": 9.900, "beam": 9.800, "floor": 9.850, "aa": 39.400}},
                {"name": "Mia Heather", "team": "Oregon State", "scores": {"beam": 9.800}},
                {"name": "Lauren Letzsch", "team": "Oregon State", "scores": {"beam": 9.875}},
                {"name": "Reina Marchal", "team": "Oregon State", "scores": {"vault": 9.750, "floor": 9.800}},
                {"name": "Savannah Miller", "team": "Oregon State", "scores": {"vault": 9.775, "bars": 9.775, "floor": 9.825}},
                {"name": "Camryn Richardson", "team": "Oregon State", "scores": {"vault": 9.800}},
                {"name": "Paulina Vargas", "team": "Oregon State", "scores": {"floor": 9.775}},
                {"name": "Ellie Weaver", "team": "Oregon State", "scores": {"beam": 9.800}},
            ],
        },
    },
]


def get_pdf_timestamp(url):
    """Extract timestamp from S3 URL query param."""
    m = re.search(r'[?&]timestamp=(\d+)', url)
    return m.group(1) if m else None


def get_today_dates():
    """Return today's date in both UTC and PT (UTC-8)."""
    now_utc = datetime.now(timezone.utc)
    today_utc = now_utc.date().isoformat()
    # PT is UTC-8 (ignoring DST for simplicity)
    from datetime import timedelta
    now_pt = now_utc - timedelta(hours=8)
    today_pt = now_pt.date().isoformat()
    return today_utc, today_pt


def is_meet_today(meet_date):
    today_utc, today_pt = get_today_dates()
    return meet_date == today_utc or meet_date == today_pt


def is_meet_in_past(meet_date):
    today_utc, _ = get_today_dates()
    return meet_date < today_utc


def load_existing_meets():
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return []


def get_cache_path(meet_id, timestamp):
    """Return path for cached PDF file."""
    os.makedirs(PDF_CACHE_DIR, exist_ok=True)
    ts = timestamp or "notimestamp"
    return os.path.join(PDF_CACHE_DIR, f"{meet_id}_{ts}.pdf")


def download_pdf(url, dest_path):
    """Download PDF from URL to dest_path. Returns True on success."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        with open(dest_path, "wb") as f:
            f.write(data)
        return True
    except Exception as e:
        eprint(f"    Download failed: {e}")
        return False


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def should_refetch_pdf(meet_config, existing_meets_by_id):
    """Determine if we need to re-download this meet's PDF."""
    meet_id = meet_config["id"]
    meet_date = meet_config["date"]
    url = meet_config.get("url", "")
    timestamp = get_pdf_timestamp(url)
    cache_path = get_cache_path(meet_id, timestamp)

    # If meet is today → always re-fetch
    if is_meet_today(meet_date):
        return True, cache_path, "today's meet"

    # If cached file exists → skip
    if os.path.exists(cache_path):
        return False, cache_path, "cached"

    # If meet is in past and we have data → skip unless flagged in_progress
    existing = existing_meets_by_id.get(meet_id)
    if existing and existing.get("status") == "in_progress":
        return True, cache_path, "in_progress"

    # New meet not yet fetched
    return True, cache_path, "new"


def parse_team_results(text):
    results = {}
    for line in text.split("\n"):
        m = re.match(
            r"(\d+)\s*(.+?)\s*([\d]{2}\.[\d]{3})\s*([\d]{2}\.[\d]{3})\s*([\d]{2}\.[\d]{3})\s*([\d]{2}\.[\d]{3})\s*([\d]{3}\.[\d]{3})",
            line,
        )
        if m:
            results[m.group(2).strip()] = {
                "rank": int(m.group(1)),
                "vault": float(m.group(3)), "bars": float(m.group(4)),
                "beam": float(m.group(5)), "floor": float(m.group(6)),
                "total": float(m.group(7)),
            }
    return results


def split_concatenated_names(text):
    parts = re.split(r'(?<=[a-z])(?=[A-Z])', text)
    names = []
    buf = ''
    for part in parts:
        combined = buf + part
        words = combined.strip().split()
        if len(words) >= 2:
            names.append(combined.strip())
            buf = ''
        else:
            buf = combined
    if buf.strip():
        if names:
            names[-1] += buf.strip()
        else:
            names.append(buf.strip())
    return names


def parse_osu_athletes(pages_text):
    athletes = {}
    for text in pages_text:
        if "Team: Oregon State" not in text and "Team:Oregon State" not in text:
            continue

        lines = text.split("\n")
        current_event = None
        current_scores = []
        collecting_names = False
        names_text = ""

        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()
            next_stripped = lines[i + 1].strip() if i + 1 < len(lines) else ""

            def _start_event(event_name, advance):
                nonlocal current_event, current_scores, collecting_names, names_text
                _flush_event(athletes, current_event, current_scores, names_text)
                current_event = event_name
                current_scores = []
                collecting_names = False
                names_text = ""
                return advance

            if (stripped == "V" and next_stripped == "T") or stripped == "VT":
                skip = _start_event("vault", 2 if stripped == "V" else 1)
                i += skip; continue
            elif (stripped == "U" and next_stripped == "B") or stripped == "UB":
                skip = _start_event("bars", 2 if stripped == "U" else 1)
                i += skip; continue
            elif stripped == "B" and next_stripped == "B":
                skip = _start_event("beam", 2)
                i += skip; continue
            elif stripped == "BB" and current_event != "beam":
                skip = _start_event("beam", 1)
                i += skip; continue
            elif (stripped == "F" and next_stripped == "X") or stripped == "FX":
                skip = _start_event("floor", 2 if stripped == "F" else 1)
                i += skip; continue

            if current_event is None:
                i += 1
                continue

            if not collecting_names:
                if stripped.startswith("#Name") or stripped.startswith("# Name"):
                    final_scores = re.findall(r"\s(\d+\.\d{3})(?=\d[^.]|\s|$)", stripped)
                    current_scores.extend(float(s) for s in final_scores)
                else:
                    score_match = re.match(r"^(\d+)\s+", stripped)
                    if score_match and "Name" not in stripped and "Judge" not in stripped:
                        nums = re.findall(r"[\d]+\.[\d]+", stripped)
                        if nums:
                            current_scores.append(float(nums[-1]))

            if re.match(r"(VT|UB|BB|FX)\s+Score:", stripped):
                collecting_names = True
                names_text = ""
                i += 1
                continue

            if collecting_names:
                if stripped.startswith("#") or "Judge" in stripped or stripped == "\xa0" or stripped == "":
                    _flush_event(athletes, current_event, current_scores, names_text)
                    collecting_names = False
                    names_text = ""
                elif re.search(r"[A-Za-z]", stripped) and "Score" not in stripped and "©" not in stripped and "Running" not in stripped:
                    names_text += stripped

            i += 1

        _flush_event(athletes, current_event, current_scores, names_text)

        final_idx = text.find("Final Score:")
        if final_idx >= 0:
            after = text[final_idx:].split("\n")
            aa_scores = []
            found_aa = False
            for fline in after[1:]:
                fline = fline.strip()
                if re.match(r"^[\d]+\.[\d]+$", fline):
                    aa_scores.append(float(fline))
                elif fline == "AA":
                    found_aa = True
                elif found_aa and re.search(r"[A-Za-z]", fline) and "Coach" not in fline and "©" not in fline:
                    last = fline.split(". ", 1)[1] if ". " in fline else fline.split()[-1]
                    for name in athletes:
                        if last.lower() in name.lower():
                            if len(aa_scores) >= 5:
                                athletes[name]["scores"]["aa"] = aa_scores[4]
                            break
                    break

    return list(athletes.values())


def _flush_event(athletes, event, scores, names_text):
    if not event or not scores or not names_text:
        return
    names = split_concatenated_names(names_text)
    for j, name in enumerate(names):
        if j < len(scores):
            if name not in athletes:
                athletes[name] = {"name": name, "team": "Oregon State", "scores": {}}
            athletes[name]["scores"][event] = scores[j]


def detect_completed_events(pages_text):
    """Count how many events have been completed based on score sheets."""
    events_found = set()
    for text in pages_text:
        if "Team: Oregon State" not in text and "Team:Oregon State" not in text:
            continue
        if re.search(r"VT\s+Score:", text):
            events_found.add("vault")
        if re.search(r"UB\s+Score:", text):
            events_found.add("bars")
        if re.search(r"BB\s+Score:", text):
            events_found.add("beam")
        if re.search(r"FX\s+Score:", text):
            events_found.add("floor")
    return events_found


def determine_meet_status(meet_config, team_scores, pdf_completed_events, has_pdf):
    """Determine if a meet is upcoming, in_progress, or final."""
    meet_date = meet_config["date"]

    # Future meet
    if not is_meet_in_past(meet_date) and not is_meet_today(meet_date):
        return "upcoming"

    # Today's meet
    if is_meet_today(meet_date):
        if not has_pdf or len(pdf_completed_events) == 0:
            return "in_progress"
        if len(pdf_completed_events) < 4:
            return "in_progress"
        # All 4 events complete → final
        return "final"

    # Past meet
    if not team_scores:
        return "in_progress"  # Has PDF but couldn't parse — might be partial

    if len(pdf_completed_events) > 0 and len(pdf_completed_events) < 4:
        return "in_progress"

    return "final"


def parse_meet_from_pdf(meet_config, pdf_path):
    """Parse a single meet's PDF and return meet data dict(s)."""
    try:
        reader = PdfReader(pdf_path)
    except Exception as e:
        eprint(f"    Error reading PDF: {e}")
        return None

    all_text = []
    team_results_pages = []
    score_sheet_pages = []

    for page in reader.pages:
        text = page.extract_text() or ""
        all_text.append(text)
        if "TEAM RESULTS" in text:
            team_results_pages.append(text)
        if "NCAA Gymnastics Score Sheet" in text:
            score_sheet_pages.append(text)

    team_scores = {}
    for pt in team_results_pages:
        team_scores.update(parse_team_results(pt))

    osu_key = next((k for k in team_scores if "oregon state" in k.lower()), None)
    if not osu_key and not meet_config.get("hardcoded"):
        eprint(f"    WARNING: Oregon State not found in PDF. Teams: {list(team_scores.keys())}")

    completed_events = detect_completed_events(score_sheet_pages)
    has_pdf = len(score_sheet_pages) > 0 or len(team_results_pages) > 0
    status = determine_meet_status(meet_config, team_scores if osu_key else {}, completed_events, has_pdf)

    is_quad = meet_config.get("isQuad", False)
    athletes = parse_osu_athletes(score_sheet_pages)

    attendance = meet_config.get("attendance", "")
    if not attendance:
        for t in all_text:
            m = re.search(r"Attendance:\s*([\d,]+)", t)
            if m:
                attendance = m.group(1)
                break

    all_teams = [
        {"team": n, "rank": d["rank"], "total": d["total"],
         "vault": d["vault"], "bars": d["bars"], "beam": d["beam"], "floor": d["floor"]}
        for n, d in sorted(team_scores.items(), key=lambda x: x[1]["rank"])
    ] if team_scores else []

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    completed_events_list = sorted(list(completed_events)) if completed_events else None

    if is_quad:
        if not osu_key:
            return None
        osu = team_scores[osu_key]
        quad_name = meet_config.get("quadName", "Quad Meet")
        id_prefix = meet_config.get("idPrefix", meet_config["id"])
        months = {"01":"jan","02":"feb","03":"mar","04":"apr","05":"may","06":"jun",
                  "07":"jul","08":"aug","09":"sep","10":"oct","11":"nov","12":"dec"}
        mo, day = meet_config["date"][5:7], str(int(meet_config["date"][8:]))
        date_slug = f"{months[mo]}-{day}"

        records = []
        for opp_name, opp_data in team_scores.items():
            if opp_name == osu_key:
                continue
            opp_slug = re.sub(r"[^a-z0-9]+", "-", opp_name.lower()).strip("-")
            record_id = f"{id_prefix}-{opp_slug}-{date_slug}"
            result = "W" if osu["total"] > opp_data["total"] else "L"
            record = {
                "id": record_id,
                "date": meet_config["date"],
                "opponent": opp_name,
                "location": meet_config["location"],
                "isHome": meet_config["isHome"],
                "result": result,
                "osuScore": osu["total"],
                "opponentScore": opp_data["total"],
                "quadMeet": True,
                "quadName": quad_name,
                "events": {
                    "vault": {"osu": osu["vault"], "opponent": opp_data["vault"]},
                    "bars": {"osu": osu["bars"], "opponent": opp_data["bars"]},
                    "beam": {"osu": osu["beam"], "opponent": opp_data["beam"]},
                    "floor": {"osu": osu["floor"], "opponent": opp_data["floor"]},
                },
                "athletes": athletes,
                "allTeams": all_teams,
                "status": status,
                "lastRefreshed": now_iso,
            }
            if attendance:
                record["attendance"] = attendance
            if completed_events_list is not None and status == "in_progress":
                record["completedEvents"] = completed_events_list
            records.append(record)
        return records
    else:
        if osu_key:
            osu = team_scores[osu_key]
            opps = {k: v for k, v in team_scores.items() if k != osu_key}
            if opps:
                on, od = list(opps.items())[0]
                opp_score = od["total"]
                opp_events = {e: od[e] for e in ["vault", "bars", "beam", "floor"]}
            else:
                opp_score = 0
                opp_events = {"vault": 0, "bars": 0, "beam": 0, "floor": 0}
            result = "W" if osu["total"] > opp_score else "L"
            osu_score = osu["total"]
            events = {
                "vault": {"osu": osu["vault"], "opponent": opp_events["vault"]},
                "bars": {"osu": osu["bars"], "opponent": opp_events["bars"]},
                "beam": {"osu": osu["beam"], "opponent": opp_events["beam"]},
                "floor": {"osu": osu["floor"], "opponent": opp_events["floor"]},
            }
        else:
            # No team scores parsed (partial meet or blank scoresheet)
            result = None
            osu_score = 0
            opp_score = 0
            events = {"vault": {"osu": 0, "opponent": 0}, "bars": {"osu": 0, "opponent": 0},
                      "beam": {"osu": 0, "opponent": 0}, "floor": {"osu": 0, "opponent": 0}}

        meet_data = {
            "id": meet_config["id"],
            "date": meet_config["date"],
            "opponent": meet_config.get("opponent", "TBD"),
            "location": meet_config["location"],
            "isHome": meet_config["isHome"],
            "result": result,
            "osuScore": osu_score,
            "opponentScore": opp_score,
            "events": events,
            "athletes": athletes,
            "status": status,
            "lastRefreshed": now_iso,
        }
        if attendance:
            meet_data["attendance"] = attendance
        if completed_events_list is not None and status == "in_progress":
            meet_data["completedEvents"] = completed_events_list
        return meet_data


def process_hardcoded_meet(meet_config, existing_meets_by_id):
    """Process a hardcoded meet — still assign status & lastRefreshed."""
    hc = meet_config["hardcoded"]
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    existing = existing_meets_by_id.get(meet_config["id"], {})

    return {
        "id": meet_config["id"],
        "date": meet_config["date"],
        "opponent": meet_config.get("opponent", "TBD"),
        "location": meet_config["location"],
        "isHome": meet_config["isHome"],
        "result": hc["result"],
        "osuScore": hc["osuScore"],
        "opponentScore": hc["opponentScore"],
        "events": hc["events"],
        "athletes": hc["athletes"],
        "status": "final",
        "lastRefreshed": existing.get("lastRefreshed", now_iso),
    }


def main():
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    summary = {
        "meetsTotal": 0,
        "meetsUpdated": 0,
        "meetsInProgress": 0,
        "newMeets": 0,
        "pdfsRefetched": 0,
        "recapsFetched": 0,
        "timestamp": now_iso,
    }

    os.makedirs(PDF_CACHE_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)

    # Load existing data for comparison
    existing_meets = load_existing_meets()
    existing_meets_by_id = {m["id"]: m for m in existing_meets}

    all_meets = []

    for meet_config in MEETS_CONFIG:
        meet_id = meet_config["id"]
        meet_date = meet_config["date"]
        eprint(f"Processing {meet_id}...")

        # Hardcoded meets (bad PDFs)
        if "hardcoded" in meet_config:
            record = process_hardcoded_meet(meet_config, existing_meets_by_id)
            all_meets.append(record)
            summary["meetsTotal"] += 1
            if meet_id not in existing_meets_by_id:
                summary["newMeets"] += 1
            continue

        # Upcoming meets (no PDF yet)
        if not is_meet_in_past(meet_date) and not is_meet_today(meet_date):
            # Keep existing data if available, otherwise create placeholder
            existing = existing_meets_by_id.get(meet_id)
            if existing:
                # Update status to upcoming, preserve rest
                existing["status"] = "upcoming"
                existing["lastRefreshed"] = now_iso
                # Handle quad meets
                if meet_config.get("isQuad"):
                    # Find all quad records
                    quad_records = [m for m in existing_meets if m.get("quadName") == meet_config.get("quadName")]
                    for qr in quad_records:
                        qr["status"] = "upcoming"
                        qr["lastRefreshed"] = now_iso
                        all_meets.append(qr)
                        summary["meetsTotal"] += 1
                else:
                    all_meets.append(existing)
                    summary["meetsTotal"] += 1
            else:
                summary["newMeets"] += 1
                # Placeholder upcoming meet
                if not meet_config.get("isQuad"):
                    placeholder = {
                        "id": meet_id,
                        "date": meet_date,
                        "opponent": meet_config.get("opponent", "TBD"),
                        "location": meet_config["location"],
                        "isHome": meet_config["isHome"],
                        "result": None,
                        "osuScore": 0,
                        "opponentScore": 0,
                        "events": {"vault": {"osu": 0, "opponent": 0}, "bars": {"osu": 0, "opponent": 0},
                                   "beam": {"osu": 0, "opponent": 0}, "floor": {"osu": 0, "opponent": 0}},
                        "athletes": [],
                        "status": "upcoming",
                        "lastRefreshed": now_iso,
                    }
                    all_meets.append(placeholder)
                    summary["meetsTotal"] += 1
            continue

        # Past or today's meet — check if we need to re-fetch PDF
        need_fetch, cache_path, reason = should_refetch_pdf(meet_config, existing_meets_by_id)
        eprint(f"  PDF: {reason} → {'download' if need_fetch else 'use cache'}")

        if need_fetch:
            success = download_pdf(meet_config["url"], cache_path)
            if success:
                summary["pdfsRefetched"] += 1
            elif not os.path.exists(cache_path):
                # Try legacy PDF dir
                legacy_path = os.path.join(DATA_DIR, "pdfs", f"{meet_id}.pdf")
                if os.path.exists(legacy_path):
                    import shutil
                    shutil.copy2(legacy_path, cache_path)
                    eprint(f"  Copied from legacy cache")
                else:
                    eprint(f"  WARNING: No PDF available for {meet_id}")
                    # Keep existing data if available
                    if meet_id in existing_meets_by_id:
                        existing = existing_meets_by_id[meet_id]
                        all_meets.append(existing)
                        summary["meetsTotal"] += 1
                    continue

        # Parse the PDF
        result = parse_meet_from_pdf(meet_config, cache_path)

        if result is None:
            eprint(f"  FAILED to parse, using existing data if available")
            if meet_id in existing_meets_by_id:
                all_meets.append(existing_meets_by_id[meet_id])
                summary["meetsTotal"] += 1
            continue

        if isinstance(result, list):
            # Quad meet
            for record in result:
                rid = record["id"]
                old = existing_meets_by_id.get(rid)
                if old:
                    if old.get("osuScore") != record.get("osuScore") or old.get("status") != record.get("status"):
                        summary["meetsUpdated"] += 1
                else:
                    summary["newMeets"] += 1
                if record.get("status") == "in_progress":
                    summary["meetsInProgress"] += 1
                all_meets.append(record)
                summary["meetsTotal"] += 1
        else:
            old = existing_meets_by_id.get(meet_id)
            if old:
                if old.get("osuScore") != result.get("osuScore") or old.get("status") != result.get("status"):
                    summary["meetsUpdated"] += 1
            else:
                summary["newMeets"] += 1
            if result.get("status") == "in_progress":
                summary["meetsInProgress"] += 1
            all_meets.append(result)
            summary["meetsTotal"] += 1

    # Write output
    with open(OUTPUT_FILE, "w") as f:
        json.dump(all_meets, f, indent=2)

    eprint(f"\nWrote {len(all_meets)} meets to {OUTPUT_FILE}")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
