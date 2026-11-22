pwd; ss -ltn | grep -E ":(5432|9000|9001|1025|8025|310[0-9])\b" || echo "ports free"
ls node_modules 2>/dev/null | wc -l; ls ~/.cache/ms-playwright; node -v; pnpm -v
grep -n "playwright" pnpm-workspace.yaml | head -3
