#!/usr/bin/env bash
set -euo pipefail

ML_LABS_REPO="https://github.com/wsyeabsera/ml-labs.git"
INSTALL_DIR="$HOME/.ml-labs"
BIN_DIR="$HOME/.local/bin"
BINARY="$BIN_DIR/ml-labs"

# ── Colors ────────────────────────────────────────────────────────────────────
bold="\033[1m"
cyan="\033[0;36m"
green="\033[0;32m"
red="\033[0;31m"
reset="\033[0m"

info()    { echo -e "  ${cyan}→${reset}  $1"; }
ok()      { echo -e "  ${green}✓${reset}  $1"; }
error()   { echo -e "  ${red}✗${reset}  $1" >&2; }
heading() { echo -e "\n${bold}$1${reset}"; }

# ── Check bun ─────────────────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  error "Bun is required but not installed."
  echo "  Install it: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

# ── Clone or update ───────────────────────────────────────────────────────────
heading "ML-Labs installer"
echo ""

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing installation at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" fetch origin 2>&1 | sed 's/^/     /'
  git -C "$INSTALL_DIR" reset --hard origin/main 2>&1 | sed 's/^/     /'
  ok "Repository updated"
else
  info "Cloning ML-Labs to $INSTALL_DIR..."
  git clone "$ML_LABS_REPO" "$INSTALL_DIR" 2>&1 | sed 's/^/     /'
  ok "Repository cloned"
fi

# ── Install neuron deps ───────────────────────────────────────────────────────
heading "Installing dependencies"
echo ""
info "neuron/ deps..."
bun install --cwd "$INSTALL_DIR/neuron" --frozen-lockfile 2>&1 | grep -E "^(Saved|installed|error)" | sed 's/^/     /' || true
ok "neuron deps installed"

info "cli/ deps..."
bun install --cwd "$INSTALL_DIR/cli" --frozen-lockfile 2>&1 | grep -E "^(Saved|installed|error)" | sed 's/^/     /' || true
ok "cli deps installed"

info "site/ deps + build..."
bun install --cwd "$INSTALL_DIR/site" --frozen-lockfile 2>&1 | grep -E "^(Saved|installed|error)" | sed 's/^/     /' || true
bun --cwd "$INSTALL_DIR/site" run build 2>&1 | grep -E "^(dist|✓|error)" | sed 's/^/     /' || true
ok "docs built → site/dist/"

# ── Write shell wrapper ───────────────────────────────────────────────────────
heading "Installing CLI"
echo ""
mkdir -p "$BIN_DIR"
cat > "$BINARY" <<'WRAPPER'
#!/usr/bin/env bash
exec bun run "$HOME/.ml-labs/cli/index.ts" "$@"
WRAPPER
chmod +x "$BINARY"
ok "Wrapper written → $BINARY"

# ── Ensure ~/.local/bin is in PATH ────────────────────────────────────────────
SHELL_RC=""
if [ -n "${ZSH_VERSION-}" ] || [[ "$SHELL" == */zsh ]]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -n "${BASH_VERSION-}" ] || [[ "$SHELL" == */bash ]]; then
  SHELL_RC="$HOME/.bashrc"
fi

PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
if [ -n "$SHELL_RC" ] && ! grep -qF "$HOME/.local/bin" "$SHELL_RC" 2>/dev/null; then
  echo "" >> "$SHELL_RC"
  echo "# ml-labs" >> "$SHELL_RC"
  echo "$PATH_LINE" >> "$SHELL_RC"
  ok "Added ~/.local/bin to PATH in $SHELL_RC"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${bold}${green}ML-Labs installed.${reset}"
echo ""
echo "  Start a new project:"
echo -e "    ${cyan}ml-labs init my-project${reset}"
echo ""
echo "  Update later:"
echo -e "    ${cyan}ml-labs update${reset}"
echo ""
echo "  Open the docs:"
echo -e "    ${cyan}ml-labs docs${reset}"
echo ""

# If PATH wasn't already set in the current shell, tell the user
if ! command -v ml-labs &>/dev/null; then
  echo -e "  ${bold}Reload your shell to activate:${reset}"
  echo -e "    source ${SHELL_RC:-~/.zshrc}"
  echo ""
fi
