#!/usr/bin/env bash
# Launches Eli-Eye from its project folder.
cd "$(dirname "$(readlink -f "$0")")" && exec ./node_modules/.bin/electron . "$@"
