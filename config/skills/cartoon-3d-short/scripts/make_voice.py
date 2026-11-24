#!/usr/bin/env python3
"""Narration for a short: script text -> voice.wav (48 kHz) + words.json [{"w","s","e"}] with word times.

    python3 make_voice.py SCRIPT.txt OUT_DIR [--voice en-US-AndrewNeural] [--rate +0%]

Uses edge-tts (free Microsoft neural voices, needs internet). Word times come from the TTS itself,
so no speech-to-text pass is needed; still listen once and hand-fix any word that is off.
"""
import argparse, asyncio, json, os, subprocess, sys
import edge_tts

async def run(text, out, voice, rate):
    com = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    words, mp3 = [], os.path.join(out, "voice.mp3")
    with open(mp3, "wb") as f:
        async for ch in com.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                s = ch["offset"] / 1e7
                words.append({"w": ch["text"], "s": round(s, 3), "e": round(s + ch["duration"] / 1e7, 3)})
    return mp3, words

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("script"); ap.add_argument("out")
    ap.add_argument("--voice", default="en-US-AndrewNeural"); ap.add_argument("--rate", default="+0%")
    a = ap.parse_args()
    text = open(a.script, encoding="utf-8").read().strip()
    if not text: sys.exit("empty script")
    os.makedirs(a.out, exist_ok=True)
    mp3, words = asyncio.run(run(text, a.out, a.voice, a.rate))
    if not words: sys.exit("TTS returned no word timings")
    wav = os.path.join(a.out, "voice.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp3, "-ar", "48000", "-ac", "1", wav], check=True)
    json.dump(words, open(os.path.join(a.out, "words.json"), "w"), indent=1)
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]))
    print(f"{wav}: {dur:.2f} s, {len(words)} words, {len(words) / dur:.2f} words/s (target ~3.7)")

if __name__ == "__main__":
    main()
