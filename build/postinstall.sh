#!/usr/bin/env bash
set -e

AGENT_DIR="/Applications/Tracenium Agent.app/Contents/MacOS"
AGENT_BIN="$AGENT_DIR/Tracenium Agent"
PLIST="/Library/LaunchDaemons/com.tracenium.agent.plist"

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

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" 
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.tracenium.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$AGENT_BIN</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>$RUN_H</integer>
    <key>Minute</key>
    <integer>$RUN_M</integer>
  </dict>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF

chmod 644 "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✅ LaunchDaemon creado. Tracenium Agent se ejecutará diariamente a las $RUN_H:$RUN_M"
