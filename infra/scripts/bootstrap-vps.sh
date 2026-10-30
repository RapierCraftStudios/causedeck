#!/usr/bin/env bash
# Idempotent bootstrap for a fresh Ubuntu/Debian India VPS (#97). Run as root. Every change is
# guarded by a check, so a second run changes nothing and prints "ok" lines only.
#
#   SSH_ALLOWLIST="203.0.113.4 198.51.100.0/24" DEPLOY_PUBKEY="ssh-ed25519 AAAA..." \
#     bash infra/scripts/bootstrap-vps.sh
#
# SSH_ALLOWLIST: space-separated IPs/CIDRs allowed to reach port 22 (empty: port 22 is opened to
# everyone but rate limited, `ufw limit`). Only 22, 80 and 443 are ever opened.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PUBKEY="${DEPLOY_PUBKEY:-}"
SSH_ALLOWLIST="${SSH_ALLOWLIST:-}"
APP_DIR="${APP_DIR:-/opt/causedeck}"
ENV_DIR="${ENV_DIR:-/etc/causedeck}"

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
changed=0
note() { echo "$*"; }
did() { changed=1; note "changed: $*"; }
have() { note "ok: $*"; }

install_pkgs() {
  local missing=()
  for pkg in "$@"; do dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg"); done
  if [ "${#missing[@]}" -gt 0 ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends "${missing[@]}"
    did "installed ${missing[*]}"
  else
    have "packages $*"
  fi
}

install_pkgs ca-certificates curl gnupg ufw fail2ban unattended-upgrades chrony

# --- Time sync (chrony) --------------------------------------------------------------------------
if systemctl is-active --quiet chrony 2>/dev/null || systemctl is-active --quiet chronyd 2>/dev/null; then
  have "chrony running"
else
  systemctl enable --now chrony 2>/dev/null || systemctl enable --now chronyd
  did "chrony enabled"
fi

# --- Unattended security upgrades ----------------------------------------------------------------
UU=/etc/apt/apt.conf.d/20auto-upgrades
UU_WANT=$'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n'
if [ "$(cat "$UU" 2>/dev/null || true)" = "${UU_WANT%$'\n'}" ] || [ "$(cat "$UU" 2>/dev/null || true)" = "$UU_WANT" ]; then
  have "unattended-upgrades configured"
else
  printf '%s' "$UU_WANT" >"$UU"
  did "unattended-upgrades configured"
fi

# --- fail2ban (sshd jail) --------------------------------------------------------------------------
JAIL=/etc/fail2ban/jail.d/causedeck-sshd.local
JAIL_WANT=$'[sshd]\nenabled = true\nmaxretry = 5\nfindtime = 10m\nbantime = 1h\n'
if [ "$(cat "$JAIL" 2>/dev/null || true)" = "${JAIL_WANT%$'\n'}" ] || [ "$(cat "$JAIL" 2>/dev/null || true)" = "$JAIL_WANT" ]; then
  have "fail2ban jail"
else
  printf '%s' "$JAIL_WANT" >"$JAIL"
  systemctl restart fail2ban
  did "fail2ban jail written"
fi
systemctl is-enabled --quiet fail2ban || { systemctl enable --now fail2ban; did "fail2ban enabled"; }

# --- Docker engine + compose plugin ---------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  have "docker and compose plugin"
else
  curl -fsSL https://get.docker.com | sh
  did "docker installed"
fi
systemctl is-enabled --quiet docker || { systemctl enable --now docker; did "docker enabled"; }

# --- Deploy user ----------------------------------------------------------------------------------
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  have "user $DEPLOY_USER"
else
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
  did "user $DEPLOY_USER created"
fi
id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker || { usermod -aG docker "$DEPLOY_USER"; did "$DEPLOY_USER added to docker"; }
if [ -n "$DEPLOY_PUBKEY" ]; then
  SSH_DIR="/home/$DEPLOY_USER/.ssh"
  install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SSH_DIR"
  touch "$SSH_DIR/authorized_keys"
  if grep -qxF "$DEPLOY_PUBKEY" "$SSH_DIR/authorized_keys"; then
    have "deploy key"
  else
    echo "$DEPLOY_PUBKEY" >>"$SSH_DIR/authorized_keys"
    did "deploy key added"
  fi
  chown "$DEPLOY_USER:$DEPLOY_USER" "$SSH_DIR/authorized_keys"
  chmod 0600 "$SSH_DIR/authorized_keys"
fi

# --- SSH: key only ---------------------------------------------------------------------------------
SSHD=/etc/ssh/sshd_config.d/99-causedeck.conf
SSHD_WANT=$'PasswordAuthentication no\nPermitRootLogin prohibit-password\nKbdInteractiveAuthentication no\n'
if [ "$(cat "$SSHD" 2>/dev/null || true)" = "${SSHD_WANT%$'\n'}" ] || [ "$(cat "$SSHD" 2>/dev/null || true)" = "$SSHD_WANT" ]; then
  have "sshd key-only"
else
  [ -n "$DEPLOY_PUBKEY" ] || { echo "refusing to disable password SSH without DEPLOY_PUBKEY" >&2; exit 1; }
  printf '%s' "$SSHD_WANT" >"$SSHD"
  sshd -t && systemctl reload ssh 2>/dev/null || systemctl reload sshd
  did "sshd key-only"
fi

# --- Directories ----------------------------------------------------------------------------------
for dir in "$APP_DIR" "$ENV_DIR"; do
  [ -d "$dir" ] && have "dir $dir" || { install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$dir"; did "dir $dir"; }
done

# --- Firewall: only 22 (limited, allowlisted), 80, 443 -----------------------------------------------
ufw_has() { ufw status | grep -qE "$1"; }
if ! ufw status | grep -q "Status: active"; then
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  did "ufw defaults set"
fi
if [ -n "$SSH_ALLOWLIST" ]; then
  for src in $SSH_ALLOWLIST; do
    ufw_has "22/tcp +ALLOW.*${src//./\\.}" && have "ufw ssh from $src" || { ufw allow from "$src" to any port 22 proto tcp >/dev/null; did "ufw ssh from $src"; }
  done
else
  ufw_has "22/tcp +LIMIT" && have "ufw limit 22" || { ufw limit 22/tcp >/dev/null; did "ufw limit 22"; }
fi
for rule in 80/tcp 443/tcp 443/udp; do
  ufw_has "^${rule} +ALLOW" && have "ufw $rule" || { ufw allow "$rule" >/dev/null; did "ufw $rule"; }
done
ufw status | grep -q "Status: active" || { ufw --force enable >/dev/null; did "ufw enabled"; }

if [ "$changed" -eq 0 ]; then note "bootstrap: no changes"; else note "bootstrap: applied changes"; fi
