#!/usr/bin/env bash
# certbot deploy hook: pick up a renewed certificate without restarting anything for long.
for s in apache2 postfix dovecot; do systemctl reload "$s" 2>/dev/null || true; done
exit 0
