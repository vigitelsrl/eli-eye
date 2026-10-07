#!/usr/bin/env bash
# Adds Eli-Eye to the application launcher.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p ~/.local/share/applications ~/.local/share/icons/hicolor/512x512/apps
cp "$DIR/assets/icon.png" ~/.local/share/icons/hicolor/512x512/apps/eli-eye.png
cat > ~/.local/share/applications/eli-eye.desktop <<DESKTOP
[Desktop Entry]
Name=Eli-Eye
Comment=Take photos and videos with fun effects
Exec=$DIR/eli-eye.sh
Icon=eli-eye
Terminal=false
Type=Application
Categories=AudioVideo;Video;Photography;
StartupWMClass=eli-eye
DESKTOP
echo "Installed. Launch \"Eli-Eye\" from your app launcher."
