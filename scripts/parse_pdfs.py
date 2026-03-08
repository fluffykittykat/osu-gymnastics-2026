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
        "location": "Alaska Airlines Arena, Seattle, WA", "isHome": False,
        "url": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/oregonstate.sidearmsports.com/documents/2026/1/4/Best_of_the_West_Final_Scores.pdf?timestamp=20260104035128",
        "isQuad": True,
        "quadName": "Best of the West Quad",
        # id prefix used to generate per-opponent IDs: {idPrefix}-{slug}-{dateSlug}
        "idPrefix": "best-of-west",
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
        "imageBasedPdf": True,
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
        "isQuad": True,
        "quadName": "Boise State Quad",
        "idPrefix": "boise-state-quad",
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
        "isQuad": True,
        "quadName": "TWU Quad",
        "idPrefix": "twu-quad",
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
        "imageBasedPdf": True,
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
    
    return fix_name_splits(list(athletes.values()))


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


def fix_name_splits(athletes):
    """
    Post-process athlete list to fix name splitting bugs caused by PDF line breaks.

    The name 'Taylor DeVries' is split by pypdf at the internal capital 'V' in 'DeVries',
    producing 'Taylor De' (stored as an athlete) and 'Vries' (prepended to the next
    athlete's name, e.g. 'VriesSophia Esposito').

    This function:
    1. Renames 'Taylor De' -> 'Taylor DeVries'
    2. Strips the 'Vries' prefix from any athlete name that starts with it
       (e.g. 'VriesSophia Esposito' -> 'Sophia Esposito')
    3. Merges any duplicate athlete entries that result from the rename,
       combining their event scores into a single record.
    """
    merged = {}
    for athlete in athletes:
        name = athlete["name"]
        scores = dict(athlete["scores"])

        # Fix the truncated 'Taylor De' entry
        if name == "Taylor De":
            name = "Taylor DeVries"

        # Strip 'Vries' prefix from corrupted names (e.g. 'VriesSophia Esposito')
        elif name.startswith("Vries") and len(name) > 5:
            name = name[5:].strip()

        if name in merged:
            # Merge scores — existing entry takes priority for conflicts
            for event, score in scores.items():
                if event not in merged[name]["scores"]:
                    merged[name]["scores"][event] = score
        else:
            merged[name] = {
                "name": name,
                "team": athlete.get("team", "Oregon State"),
                "scores": scores,
            }

    return list(merged.values())


def parse_meet_pdf(meet_info):
    if "hardcoded" in meet_info:
        hc = meet_info["hardcoded"]
        record = {
            "id": meet_info["id"], "date": meet_info["date"],
            "opponent": meet_info["opponent"], "location": meet_info["location"],
            "isHome": meet_info["isHome"], "result": hc["result"],
            "osuScore": hc["osuScore"], "opponentScore": hc["opponentScore"],
            "events": hc["events"], "athletes": hc["athletes"],
        }
        if meet_info.get("imageBasedPdf"):
            record["imageBasedPdf"] = True
        return record
    
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

    # Detect image-based PDFs: pypdf returns no usable text
    is_image_based = all(len(t.strip()) == 0 for t in all_text)
    if is_image_based:
        print(f"  WARNING: Image-based PDF detected — no text extractable. Skipping athlete parsing.")
        return None

    team_scores = {}
    for pt in team_results_pages:
        team_scores.update(parse_team_results(pt))

    osu_key = next((k for k in team_scores if "oregon state" in k.lower()), None)
    if not osu_key:
        print(f"  WARNING: Oregon State not found. Teams: {list(team_scores.keys())}")
        return None
    
    osu = team_scores[osu_key]
    is_quad = meet_info.get("isQuad", False)
    
    athletes = parse_osu_athletes(score_sheet_pages)
    
    attendance = meet_info.get("attendance", "")
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
    ]
    
    if is_quad:
        # Generate one record per opponent
        quad_name = meet_info.get("quadName", "Quad Meet")
        id_prefix = meet_info.get("idPrefix", meet_info["id"])
        date_slug = meet_info["date"].replace("-", "").replace("2026", "")  # e.g. "0103"
        month_day = meet_info["date"][5:]  # "01-03" → "jan-3" via below
        # Build a date slug like "jan-3"
        months = {"01":"jan","02":"feb","03":"mar","04":"apr","05":"may","06":"jun",
                  "07":"jul","08":"aug","09":"sep","10":"oct","11":"nov","12":"dec"}
        mo, day = meet_info["date"][5:7], str(int(meet_info["date"][8:]))
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
                "date": meet_info["date"],
                "opponent": opp_name,
                "location": meet_info["location"],
                "isHome": meet_info["isHome"],
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
            }
            if attendance:
                record["attendance"] = attendance
            records.append(record)
        return records
    else:
        opps = {k: v for k, v in team_scores.items() if k != osu_key}
        if opps:
            on, od = list(opps.items())[0]
            opp_score = od["total"]
            opp_events = {e: od[e] for e in ["vault", "bars", "beam", "floor"]}
        else:
            opp_score, opp_events = 0, {"vault": 0, "bars": 0, "beam": 0, "floor": 0}
        result = "W" if osu["total"] > opp_score else "L"
        
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
        if attendance:
            meet_data["attendance"] = attendance
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
            if data is None:
                print("  FAILED")
            elif isinstance(data, list):
                # Quad meet: multiple records returned
                for record in data:
                    meets.append(record)
                    for a in record["athletes"]:
                        if "aa" in a["scores"] and a["scores"]["aa"] < 30:
                            print(f"  WARNING: Bad AA for {a['name']}: {a['scores']['aa']}")
                    print(f"  vs {record['opponent']}: OSU {record['osuScore']} | {record['result']}")
            else:
                meets.append(data)
                for a in data["athletes"]:
                    if "aa" in a["scores"] and a["scores"]["aa"] < 30:
                        print(f"  WARNING: Bad AA for {a['name']}: {a['scores']['aa']}")
                print(f"  OSU: {data['osuScore']} | {data['result']} | Athletes: {len(data['athletes'])}")
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
