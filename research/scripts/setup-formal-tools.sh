#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

JAR="${TLA_TOOLS_JAR:-$ROOT/tools/tla2tools.jar}"
EXPECTED_SHA1="bee4a54f3ee3d4afc347c3240ec2d9e93b075104"
URL="https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"

mkdir -p "$(dirname "$JAR")"

if [[ -f "$JAR" ]]; then
  echo "Using existing TLC jar: $JAR"
else
  echo "Downloading official TLA+ TLC 1.7.4..."
  tmp="${JAR}.partial"
  rm -f "$tmp"
  if ! curl -fL --retry 3 --connect-timeout 10 --max-time 120 -o "$tmp" "$URL"; then
    rm -f "$tmp"
    cat >&2 <<MSG
Unable to download tla2tools.jar.
Network access to GitHub is unavailable. Either:
  1. rerun this script with network access, or
  2. place the official v1.7.4 tla2tools.jar at: $JAR, or
  3. set TLA_TOOLS_JAR=/path/to/tla2tools.jar
MSG
    exit 2
  fi
  mv "$tmp" "$JAR"
fi

actual="$(sha1sum "$JAR" | awk '{print $1}')"
if [[ "$actual" != "$EXPECTED_SHA1" ]]; then
  echo "ERROR: tla2tools.jar SHA-1 mismatch." >&2
  echo "Expected: $EXPECTED_SHA1" >&2
  echo "Actual:   $actual" >&2
  exit 3
fi

echo "TLC tool verified: v1.7.4 / SHA-1 $actual"
