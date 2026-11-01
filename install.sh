#!/usr/bin/env bash
# PCB Checker & CAM — păstrat pentru compatibilitate; deleagă către instalatorul complet.
exec bash "$(dirname "$0")/selfhost/install.sh" "$@"
