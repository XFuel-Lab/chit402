#!/usr/bin/env bash
# XFuel demo video mux — screen + VO (+ optional music / captions)
#
# Usage:
#   ./scripts/demo-ffmpeg.sh \
#     --screen recording.mp4 \
#     --voice voiceover.wav \
#     --out xfuel-demo-final.mp4
#
# Optional:
#   --music bed.mp3          soft underscore (ducked under VO)
#   --captions captions.srt  burn simple lower-thirds / captions
#   --music-vol 0.12         music gain (default 0.12)
#   --voice-vol 1.0
#
# Requires: ffmpeg (https://ffmpeg.org). On Windows use Git Bash/WSL or run the
# one-liner at the bottom with ffmpeg.exe.
#
# Export profile: 1080p, H.264 high, ~8–12 Mbps video, AAC 192k — good for
# YouTube + X (Twitter) uploads without looking mushy on UI text.

set -euo pipefail

SCREEN=""
VOICE=""
MUSIC=""
CAPTIONS=""
OUT="xfuel-demo-final.mp4"
MUSIC_VOL="0.12"
VOICE_VOL="1.0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --screen) SCREEN="$2"; shift 2 ;;
    --voice) VOICE="$2"; shift 2 ;;
    --music) MUSIC="$2"; shift 2 ;;
    --captions) CAPTIONS="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --music-vol) MUSIC_VOL="$2"; shift 2 ;;
    --voice-vol) VOICE_VOL="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,28p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$SCREEN" || -z "$VOICE" ]]; then
  echo "Required: --screen <file> --voice <file>" >&2
  exit 1
fi
if [[ ! -f "$SCREEN" ]]; then echo "Missing screen file: $SCREEN" >&2; exit 1; fi
if [[ ! -f "$VOICE" ]]; then echo "Missing voice file: $VOICE" >&2; exit 1; fi
if [[ -n "$MUSIC" && ! -f "$MUSIC" ]]; then echo "Missing music file: $MUSIC" >&2; exit 1; fi
if [[ -n "$CAPTIONS" && ! -f "$CAPTIONS" ]]; then echo "Missing captions: $CAPTIONS" >&2; exit 1; fi

command -v ffmpeg >/dev/null || { echo "ffmpeg not found on PATH" >&2; exit 1; }

# Video: scale/pad to 1920x1080, 30fps, crisp UI text (high profile + slow preset)
VF="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p"
if [[ -n "$CAPTIONS" ]]; then
  # Escape for ffmpeg subtitles filter (Windows paths: prefer forward slashes)
  CAP_ESC="${CAPTIONS//\\//}"
  CAP_ESC="${CAP_ESC//:/\\:}"
  VF="${VF},subtitles='${CAP_ESC}':force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF&,OutlineColour=&H80000000&,BorderStyle=3,Outline=1,Shadow=0,MarginV=48'"
fi

# Audio graph
#  - Voice normalized lightly
#  - Optional music ducked via sidechaincompress when voice is present
FILTERS=""
INPUTS=(-i "$SCREEN" -i "$VOICE")
MAP_AUDIO="[vout]"

if [[ -n "$MUSIC" ]]; then
  INPUTS+=(-i "$MUSIC")
  # [0] video [1] voice [2] music
  FILTERS="[1:a]volume=${VOICE_VOL},loudnorm=I=-16:TP=-1.5:LRA=11[vo];[2:a]volume=${MUSIC_VOL},aloop=loop=-1:size=2e+09[bg];[bg][vo]sidechaincompress=threshold=0.05:ratio=6:attack=50:release=300[mix];[mix]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]"
else
  FILTERS="[1:a]volume=${VOICE_VOL},loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]"
fi

# Combine video filter + audio filter
FILTER_COMPLEX="[0:v]${VF}[vout];${FILTERS}"

ffmpeg -y \
  "${INPUTS[@]}" \
  -filter_complex "$FILTER_COMPLEX" \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -profile:v high -preset slow -crf 18 \
  -maxrate 12M -bufsize 24M \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -movflags +faststart \
  -shortest \
  "$OUT"

echo "Wrote $OUT"
echo "Upload: YouTube (1080p) · X (under ~140s / keep file <512MB for in-app)"

# ─── One-liner (no music, no captions) ───────────────────────────────────────
# ffmpeg -y -i screen.mp4 -i voice.wav \
#   -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
#   -map "[v]" -map "[a]" \
#   -c:v libx264 -profile:v high -preset slow -crf 18 -maxrate 12M -bufsize 24M \
#   -c:a aac -b:a 192k -movflags +faststart -shortest \
#   xfuel-demo-final.mp4
#
# ─── One-liner (+ soft music) ────────────────────────────────────────────────
# ffmpeg -y -i screen.mp4 -i voice.wav -i bed.mp3 \
#   -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[vo];[2:a]volume=0.12,aloop=loop=-1:size=2e+09[bg];[bg][vo]sidechaincompress=threshold=0.05:ratio=6:attack=50:release=300[a]" \
#   -map "[v]" -map "[a]" \
#   -c:v libx264 -profile:v high -preset slow -crf 18 -maxrate 12M -bufsize 24M \
#   -c:a aac -b:a 192k -movflags +faststart -shortest \
#   xfuel-demo-final.mp4
#
# ─── Sample captions.srt (lower-thirds style) ────────────────────────────────
# 1
# 00:00:08,000 --> 00:00:20,000
# POST /v1/chat/completions · api-testnet.xfuel.app
#
# 2
# 00:00:22,000 --> 00:00:36,000
# Tier 1 — Signed receipt
#
# 3
# 00:00:38,000 --> 00:00:54,000
# Tier 2 — SP1 settlement proof
#
# 4
# 00:00:55,000 --> 00:01:08,000
# ZKVerifierSP1 · Base mainnet · Payments: Base Sepolia
#
# 5
# 00:01:10,000 --> 00:01:20,000
# Try: api-testnet.xfuel.app · Design partners: DM
