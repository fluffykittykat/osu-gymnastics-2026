#!/usr/bin/env python3
"""
Parse Virtius gymnastics score sheets (PDFs) into structured JSON.
"""

import json
import os
import re
import urllib.request
from pypdf import PdfReader

MEETS = [
    {
        "id": "best-of-west-jan-3", "date": "2026-01-03",
        "opponent": "Best of the West (Washington, Cal, UCLA)",
        "location": "Alaska Airlines Arena, Seattle, WA", "isHome": False,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/1/4/Best_of_the_West_Final_Scores.pdf?timestamp=20260104035128",
        "isQuad": True,
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
            "athletes": [],
            "imageBasedPdf": True,
        },
    },
    {
        "id": "boise-state-feb-6", "date": "2026-02-06",
        "opponent": "Boise State Quad (SJSU, UC Davis)",
        "location": "ExtraMile Arena, Boise, ID", "isHome": False,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/2/7/BoiseStateNoJudges.pdf?timestamp=20260207062723",
        "isQuad": True,
    },
    {
        "id": "southern-utah-feb-14", "date": "2026-02-14", "opponent": "Southern Utah",
        "location": "Gill Coliseum, Corvallis, OR", "isHome": True,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/2/15/Oregon_State_vs_Southern_Utah___Official_Score_Sheet___Oregon_State.pdf?timestamp=20260215123952",
    },
    {
        "id": "twu-quad-feb-22", "date": "2026-02-22",
        "opponent": "TWU Quad (Kent State, Arizona State)",
        "location": "Kitty Magee Arena, Denton, TX", "isHome": False,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/2/22/TWU_Results.pdf?timestamp=20260222115459",
        "isQuad": True,
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
            "athletes": [],
            "imageBasedPdf": True,
        },
    },
]

DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "pdfs")
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "meets.json")


def download_pdfs():
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    for meet in MEETS:
        path = os.path.join(DOWNLOAD_DIR, f"{meet['id']}.pdf")
        if not os.path.exists(path):
            print(f"Downloading {meet['id']}...")
            urllib.request.urlretrieve(meet["url"], path)
        else:
            print(f"Already have {meet['id']}")


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
    """Split 'FirstLastFirstLast' into ['First Last', 'First Last']."""
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
    """
    Parse OSU athlete scores from NCAA score sheet pages.
    Handles both spaced (one name per line) and compact (concatenated names) formats.
    """
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
            
            # Detect event headers: "V\nT" or "VT" on a line
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
            
            # Score lines: individual "1 9.95 9.85 9.95 9.90 9.875" OR
            # compact "#Name SV1 J1...1 9.959.75... 9.7502 10.00..."
            if not collecting_names:
                if stripped.startswith("#Name") or stripped.startswith("# Name"):
                    # Compact format: all scores on one line
                    # Final scores are preceded by space: " 9.750"
                    final_scores = re.findall(r"\s(\d+\.\d{3})(?=\d[^.]|\s|$)", stripped)
                    current_scores.extend(float(s) for s in final_scores)
                else:
                    score_match = re.match(r"^(\d+)\s+", stripped)
                    if score_match and "Name" not in stripped and "Judge" not in stripped:
                        nums = re.findall(r"[\d]+\.[\d]+", stripped)
                        if nums:
                            current_scores.append(float(nums[-1]))
            
            # Event total triggers name collection
            if re.match(r"(VT|UB|BB|FX)\s+Score:", stripped):
                collecting_names = True
                names_text = ""
                i += 1
                continue
            
            # Collecting names until we hit # or Judge or empty or next event
            if collecting_names:
                if stripped.startswith("#") or "Judge" in stripped or stripped == "\xa0" or stripped == "":
                    _flush_event(athletes, current_event, current_scores, names_text)
                    collecting_names = False
                    names_text = ""
                elif re.search(r"[A-Za-z]", stripped) and "Score" not in stripped and "©" not in stripped and "Running" not in stripped:
                    names_text += stripped
            
            i += 1
        
        # Flush last event
        _flush_event(athletes, current_event, current_scores, names_text)
        
        # Parse AA from Final Score section
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
                    # Name like "S. Esposito"
                    last = fline.split(". ", 1)[1] if ". " in fline else fline.split()[-1]
                    for name in athletes:
                        if last.lower() in name.lower():
                            if len(aa_scores) >= 5:
                                athletes[name]["scores"]["aa"] = aa_scores[4]
                            break
                    break
    
    return list(athletes.values())


def _flush_event(athletes, event, scores, names_text):
    """Assign scores to athletes for a given event."""
    if not event or not scores or not names_text:
        return
    names = split_concatenated_names(names_text)
    for j, name in enumerate(names):
        if j < len(scores):
            if name not in athletes:
                athletes[name] = {"name": name, "team": "Oregon State", "scores": {}}
            athletes[name]["scores"][event] = scores[j]


def fix_corrupted_athlete_names(athletes):
    """
    Post-processing to fix athlete names corrupted by PDF line breaks.
    
    When "Taylor DeVries" splits across a line break:
    - "Taylor De" is extracted as one athlete name
    - "Vries" gets prepended to the next athlete (e.g., "VriesSophia Esposito")
    
    This function:
    1. Strip "Vries" prefix from corrupted names
    2. If "Taylor De" exists, merge it with "DeVries" to create "Taylor DeVries"
       (we look for "Vries" with scores that belong to Taylor De)
    3. Merge duplicate athlete entries by combining event scores
    """
    if not athletes:
        return athletes
    
    # Step 1: Strip "Vries" prefix from corrupted names
    corrupted = [a for a in athletes if a["name"].startswith("Vries")]
    for athlete in corrupted:
        fixed_name = athlete["name"][5:].strip()  # Remove "Vries" prefix (5 chars)
        athlete["name"] = fixed_name
    
    # Step 2: Fix "Taylor De" → merge into "Taylor DeVries"
    # Look for both "Taylor De" and standalone "Vries" or
    # any "Taylor De" (incomplete) that needs the last name
    taylor_de = next((a for a in athletes if a["name"] == "Taylor De"), None)
    vries_only = next((a for a in athletes if a["name"] == "Vries"), None)
    
    if taylor_de:
        if vries_only:
            # We have both "Taylor De" and "Vries" as separate entries
            taylor_de["name"] = "Taylor DeVries"
            taylor_de["scores"].update(vries_only["scores"])
            athletes.remove(vries_only)
        else:
            # Just rename "Taylor De" to "Taylor DeVries"
            taylor_de["name"] = "Taylor DeVries"
    
    # Step 3: Merge duplicate athlete entries
    # Group athletes by (normalized) name and combine their scores
    normalized_map = {}
    for athlete in athletes:
        norm_key = athlete["name"].lower().strip()
        if norm_key not in normalized_map:
            normalized_map[norm_key] = athlete
        else:
            # Merge scores into existing entry
            normalized_map[norm_key]["scores"].update(athlete["scores"])
    
    # Return deduplicated list
    return list(normalized_map.values())


def is_image_based_pdf(all_text):
    """
    Detect if PDF is image-based (scanned) by checking if text extraction yielded
    almost nothing or only empty/whitespace content.
    """
    total_chars = sum(len(t.strip()) for t in all_text)
    # If we extracted fewer than 500 characters total, likely a scanned image
    return total_chars < 500


def parse_meet_pdf(meet_info):
    if "hardcoded" in meet_info:
        hc = meet_info["hardcoded"]
        return {
            "id": meet_info["id"], "date": meet_info["date"],
            "opponent": meet_info["opponent"], "location": meet_info["location"],
            "isHome": meet_info["isHome"], "result": hc["result"],
            "osuScore": hc["osuScore"], "opponentScore": hc["opponentScore"],
            "events": hc["events"], "athletes": hc["athletes"],
            "imageBasedPdf": hc.get("imageBasedPdf", False),
        }
    
    pdf_path = os.path.join(DOWNLOAD_DIR, f"{meet_info['id']}.pdf")
    reader = PdfReader(pdf_path)
    
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
    
    # Check if this is an image-based PDF (scanned, no text extraction)
    image_based = is_image_based_pdf(all_text)
    
    team_scores = {}
    for pt in team_results_pages:
        team_scores.update(parse_team_results(pt))
    
    osu_key = next((k for k in team_scores if "oregon state" in k.lower()), None)
    if not osu_key:
        print(f"  WARNING: Oregon State not found. Teams: {list(team_scores.keys())}")
        return None
    
    osu = team_scores[osu_key]
    is_quad = meet_info.get("isQuad", False)
    
    if is_quad:
        result = "W" if osu["rank"] == 1 else "L"
        top_opp = max(((k, v) for k, v in team_scores.items() if k != osu_key), key=lambda x: x[1]["total"])
        opp_score = top_opp[1]["total"]
        opp_events = {e: top_opp[1][e] for e in ["vault", "bars", "beam", "floor"]}
        all_teams = [
            {"team": n, "rank": d["rank"], "total": d["total"],
             "vault": d["vault"], "bars": d["bars"], "beam": d["beam"], "floor": d["floor"]}
            for n, d in sorted(team_scores.items(), key=lambda x: x[1]["rank"])
        ]
    else:
        opps = {k: v for k, v in team_scores.items() if k != osu_key}
        if opps:
            on, od = list(opps.items())[0]
            opp_score = od["total"]
            opp_events = {e: od[e] for e in ["vault", "bars", "beam", "floor"]}
        else:
            opp_score, opp_events = 0, {"vault": 0, "bars": 0, "beam": 0, "floor": 0}
        result = "W" if osu["total"] > opp_score else "L"
        all_teams = None
    
    # Parse athletes; if image-based, this will be empty
    athletes = parse_osu_athletes(score_sheet_pages) if not image_based else []
    
    # Post-process to fix corrupted names and merge duplicates
    if athletes:
        athletes = fix_corrupted_athlete_names(athletes)
    
    attendance = ""
    for t in all_text:
        m = re.search(r"Attendance:\s*([\d,]+)", t)
        if m:
            attendance = m.group(1)
            break
    
    meet_data = {
        "id": meet_info["id"], "date": meet_info["date"],
        "opponent": meet_info["opponent"], "location": meet_info["location"],
        "isHome": meet_info["isHome"], "result": result,
        "osuScore": osu["total"], "opponentScore": opp_score,
        "events": {
            "vault": {"osu": osu["vault"], "opponent": opp_events["vault"]},
            "bars": {"osu": osu["bars"], "opponent": opp_events["bars"]},
            "beam": {"osu": osu["beam"], "opponent": opp_events["beam"]},
            "floor": {"osu": osu["floor"], "opponent": opp_events["floor"]},
        },
        "athletes": athletes,
    }
    if image_based:
        meet_data["imageBasedPdf"] = True
    if attendance:
        meet_data["attendance"] = attendance
    if all_teams:
        meet_data["allTeams"] = all_teams
        meet_data["isQuad"] = True
    return meet_data


def main():
    print("=== OSU Gymnastics PDF Parser ===\n")
    print("Downloading PDFs...")
    download_pdfs()
    print()
    
    meets = []
    for info in MEETS:
        print(f"Parsing {info['id']}...")
        try:
            data = parse_meet_pdf(info)
            if data:
                meets.append(data)
                for a in data["athletes"]:
                    if "aa" in a["scores"] and a["scores"]["aa"] < 30:
                        print(f"  WARNING: Bad AA for {a['name']}: {a['scores']['aa']}")
                print(f"  OSU: {data['osuScore']} | {data['result']} | Athletes: {len(data['athletes'])}")
            else:
                print("  FAILED")
        except Exception as e:
            print(f"  ERROR: {e}")
            import traceback; traceback.print_exc()
    
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(meets, f, indent=2)
    
    w = sum(1 for m in meets if m["result"] == "W")
    l = sum(1 for m in meets if m["result"] == "L")
    print(f"\nWrote {len(meets)} meets to {OUTPUT_FILE}")
    print(f"Season record: {w}-{l}")


if __name__ == "__main__":
    main()
