#!/usr/bin/env python3
"""Inject PowerPoint animations into the deck:
   - Fade transition on every slide.
   - Click-triggered staggered fade-in (cascade) of diagram shapes on flow slides.
Validates by being re-openable; visual playback is verified in PowerPoint/Keynote.
"""
import re, sys, zipfile, shutil, os

SRC = "/tmp/deck/llm-deck.pptx"
DST = "/tmp/deck/llm-deck.pptx"  # overwrite in place
WORK = "/tmp/deck/_unz"
CASCADE_SLIDES = {2, 4, 8, 11, 15, 17}  # flow slides — elements appear one by one

TRANSITION = '<p:transition spd="med"><p:fade/></p:transition>'

def fade_par(cid, spid, delay):
    """One entrance-fade element targeting spid, starting `delay` ms into the group."""
    return (
        f'<p:par><p:cTn id="{cid}" presetID="10" presetClass="entr" presetSubtype="0" '
        f'fill="hold" grpId="0" nodeType="afterEffect"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst>'
        f'<p:childTnLst>'
        f'<p:animEffect transition="in" filter="fade"><p:cBhvr>'
        f'<p:cTn id="{cid+1}" dur="400"/><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>'
        f'</p:cBhvr></p:animEffect>'
        f'<p:set><p:cBhvr><p:cTn id="{cid+2}" dur="1" fill="hold">'
        f'<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
        f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>'
        f'<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>'
        f'<p:to><p:strVal val="visible"/></p:to></p:set>'
        f'</p:childTnLst></p:cTn></p:par>'
    )

def timing(spids):
    cid = 10
    pars = []
    for i, spid in enumerate(spids):
        pars.append(fade_par(cid, spid, i * 250))  # 250ms stagger
        cid += 3
    inner = "".join(pars)
    return (
        '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">'
        '<p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq">'
        '<p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>'
        '<p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst>'
        f'<p:childTnLst>{inner}</p:childTnLst>'
        '</p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn>'
        '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
        '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
        '</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
    )

# unpack
if os.path.exists(WORK): shutil.rmtree(WORK)
os.makedirs(WORK)
with zipfile.ZipFile(SRC) as z: z.extractall(WORK)

slide_dir = os.path.join(WORK, "ppt", "slides")
n_anim = 0
for i in range(1, 21):
    p = os.path.join(slide_dir, f"slide{i}.xml")
    with open(p, encoding="utf-8") as f: xml = f.read()
    inject = TRANSITION
    if i in CASCADE_SLIDES:
        # shape ids in document order; skip id=1 (group), and the first two real
        # shapes (kicker + title from header()).
        ids = re.findall(r'<p:cNvPr id="(\d+)"', xml)
        spids = ids[3:]  # drop group + kicker + title
        if spids:
            inject += timing(spids)
            n_anim += 1
    xml = xml.replace("</p:sld>", inject + "</p:sld>")
    with open(p, "w", encoding="utf-8") as f: f.write(xml)

# repack
tmp = DST + ".tmp"
with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(WORK):
        for fn in files:
            full = os.path.join(root, fn)
            arc = os.path.relpath(full, WORK)
            z.write(full, arc)
shutil.move(tmp, DST)
shutil.rmtree(WORK)
print(f"injected: fade transition on 20 slides; cascade entrance on {n_anim} flow slides")
