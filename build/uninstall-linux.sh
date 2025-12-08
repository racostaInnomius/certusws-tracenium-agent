#!/bin/bash

echo "==============================="
echo "   Tracenium Agent Uninstaller"
echo "==============================="

APP_DIR="/opt/TraceniumAgent"
SERVICE_FILE="/etc/systemd/system/tracenium-agent.service"
CRON_FILE="/etc/cron.d/tracenium-agent"
LOG_DIR="/var/log/tracenium-agent"

# Must run as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ ERROR: Please run with sudo"
   exit 1
fi

echo "🔍 Stopping and removing systemd service (if exists)..."
if [[ -f "$SERVICE_FILE" ]]; then
    systemctl stop tracenium-agent.service 2>/dev/null
    systemctl disable tracenium-agent.service 2>/dev/null
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
fi

echo "🔍 Removing cron entry (if exists)..."
rm -f "$CRON_FILE"

echo "🗑 Removing application directory..."
rm -rf "$APP_DIR"

echo "🗑 Removing logs directory..."
rm -rf "$LOG_DIR"

echo "--------------------------------"
echo "✅ Uninstallation completed."
echo "--------------------------------"
