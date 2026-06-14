#!/usr/bin/env bash
# det-hang.sh — a detector fixture that never answers (S2.2 / Flatline B2 DoS test).
# It does not read stdin and never prints: the sanitize wall-clock timeout MUST fire and
# kill it. A hung detector must fail closed (block), not become a bypass.
sleep 30
