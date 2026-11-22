grep -an "rror\|admin\|OOM\|heap" /tmp/1136-pw.log | grep -v "^\s*$" | tail -30 | cut -c1-300
