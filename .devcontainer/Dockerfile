# Prumo devcontainer
# Node 20 (Debian Bookworm provides Python 3.11) + uv + psql + Claude Code.
# Includes default-deny firewall for use with `claude --dangerously-skip-permissions`.
FROM node:20-bookworm

ENV DEVCONTAINER=true \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git make jq less unzip sudo \
      build-essential \
      iptables ipset iproute2 dnsutils \
      postgresql-client redis-tools \
      python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Firewall: passwordless sudo restricted to the firewall script only.
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod +x /usr/local/bin/init-firewall.sh \
    && echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" \
         > /etc/sudoers.d/node-firewall \
    && chmod 0440 /etc/sudoers.d/node-firewall

USER node
WORKDIR /workspace

RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && npm config set prefix /home/node/.npm-global \
    && npm install -g @anthropic-ai/claude-code

ENV PATH="/home/node/.local/bin:/home/node/.npm-global/bin:${PATH}"
