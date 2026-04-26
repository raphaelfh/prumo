#!/usr/bin/env bash
# Default-deny outbound firewall for the Prumo devcontainer.
# Required when running `claude --dangerously-skip-permissions`.
# Allowlist: Anthropic, npm, GitHub, PyPI/uv, Supabase (REST + pooler), OpenAI, Debian APT.
set -euo pipefail
IFS=$'\n\t'

ALLOWED_DOMAINS=(
  "api.anthropic.com" "console.anthropic.com" "statsig.anthropic.com" "sentry.io"
  "registry.npmjs.org"
  "github.com" "api.github.com" "objects.githubusercontent.com"
  "raw.githubusercontent.com" "codeload.github.com"
  "pypi.org" "files.pythonhosted.org" "astral.sh"
  "api.openai.com"
  "deb.debian.org" "security.debian.org"
)

SUPABASE_HOSTS=(
  "aws-0-us-east-1.pooler.supabase.com"
  "aws-1-us-east-1.pooler.supabase.com"
  "aws-0-us-east-2.pooler.supabase.com"
  "aws-0-us-west-1.pooler.supabase.com"
  "aws-0-eu-central-1.pooler.supabase.com"
  "aws-0-eu-west-1.pooler.supabase.com"
  "aws-0-sa-east-1.pooler.supabase.com"
  "aws-0-ap-southeast-1.pooler.supabase.com"
)

# Pull host(s) from backend/.env (DATABASE_URL / SUPABASE_URL).
EXTRA_HOSTS=()
if [ -f /workspace/backend/.env ]; then
  while IFS= read -r host; do
    [ -n "$host" ] && EXTRA_HOSTS+=("$host")
  done < <(
    grep -E '^(DATABASE_URL|DIRECT_DATABASE_URL|SUPABASE_URL)=' /workspace/backend/.env 2>/dev/null \
      | sed -E 's#^[A-Z_]+=##; s#^["'\'']##; s#["'\'']$##' \
      | sed -E 's#^[a-zA-Z]+://##; s#^[^@]+@##; s#[:/].*$##' \
      | sort -u
  )
fi

iptables -F; iptables -X
iptables -t nat -F; iptables -t nat -X
iptables -t mangle -F; iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT

ipset create allowed-domains hash:net

resolve_and_add() {
  local domain="$1" ips
  ips=$(dig +short A "$domain" 2>/dev/null | grep -E '^[0-9]+\.' || true)
  [ -z "$ips" ] && ips=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true)
  if [ -z "$ips" ]; then echo "  WARN: cannot resolve $domain" >&2; return; fi
  while IFS= read -r ip; do
    [ -z "$ip" ] && continue
    ipset add allowed-domains "$ip" 2>/dev/null || true
  done <<< "$ips"
  echo "  + $domain"
}

for d in "${ALLOWED_DOMAINS[@]}"; do resolve_and_add "$d"; done
for d in "${SUPABASE_HOSTS[@]}";  do resolve_and_add "$d"; done
for d in "${EXTRA_HOSTS[@]}";     do resolve_and_add "$d"; done

iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

if curl --max-time 5 -sS https://example.com/ -o /dev/null 2>/dev/null; then
  echo "FAIL: example.com is reachable but should be blocked" >&2
  exit 1
fi
echo "==> Firewall ready"
