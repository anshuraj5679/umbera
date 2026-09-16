#!/usr/bin/env bash
set -e
COMPACT_DIR="/home/anshu_raj/.compact/versions/0.30.0/x86_64-unknown-linux-musl"
export PATH="$COMPACT_DIR:$PATH"
echo "Using compactc: $COMPACT_DIR/compactc"
echo "Using zkir: $(which zkir)"
$COMPACT_DIR/compactc /mnt/d/midnight/contracts/midnight/src/umbra.compact /mnt/d/midnight/contracts/midnight/dist
echo "COMPACT COMPILATION COMPLETE"
