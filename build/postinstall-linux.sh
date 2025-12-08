#!/usr/bin/env bash
set -e

AGENT_BIN="/usr/local/bin/tracenium-agent"  # o ruta real del binario

NOW_H=$(date +"%H")
NOW_M=$(date +"%M")

RUN_M=$((NOW_M + 5))
RUN_H=$NOW_H

if [ "$RUN_M" -ge 60 ]; then
  RUN_M=$((RUN_M - 60))
  RUN_H=$((RUN_H + 1))
  if [ "$RUN_H" -ge 24 ]; then
    RUN_H=$((RUN_H - 24))
  fi
fi

TMP_CRON="/tmp/cron_tracenium_$$"
crontab -l 2>/dev/null | grep -v "tracenium-agent" > "$TMP_CRON" || true
echo "$RUN_M $RUN_H * * * $AGENT_BIN >> /var/log/tracenium-agent.log 2>&1" >> "$TMP_CRON"
crontab "$TMP_CRON"
rm -f "$TMP_CRON"

echo "✅ Cron configurado. Tracenium Agent se ejecutará diariamente a las $RUN_H:$RUN_M"
