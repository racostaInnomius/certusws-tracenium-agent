#!/bin/bash

echo "==============================="
echo "   Tracenium Agent Uninstaller"
echo "==============================="

AGENT_DIR="/Applications/Tracenium Agent"
LAUNCHD_PLIST="/Library/LaunchDaemons/com.tracenium.agent.plist"
LOG_DIR="/Library/Logs/TraceniumAgent"

# Must run as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ ERROR: Please run with sudo"
   exit 1
fi

echo "🔍 Stopping launchd service (if exists)..."
if [[ -f "$LAUNCHD_PLIST" ]]; then
    launchctl unload "$LAUNCHD_PLIST" 2>/dev/null
    rm -f "$LAUNCHD_PLIST"
fi

echo "🗑 Removing application directory..."
rm -rf "$AGENT_DIR"

echo "🗑 Removing logs directory..."
rm -rf "$LOG_DIR"

echo "--------------------------------"
echo "✅ Uninstallation completed."
echo "--------------------------------"
