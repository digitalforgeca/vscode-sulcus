#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# publish_marketplace.sh — Local VS Code Marketplace Publisher
# ═══════════════════════════════════════════════════════════════════════════════
# Automates compiling, packaging, and publishing the Sulcus VS Code extension
# directly to the Visual Studio Code Marketplace and Open VSX Registry.
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$SCRIPT_DIR"

# Colors for output
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RED="\033[0;31m"
NC="\033[0m"

log_info()    { echo -e "${CYAN}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1"; }

cd "$EXT_DIR"

# ─── 1. Handle Arguments & Options ─────────────────────────────────────────────
DRY_RUN=false
BUMP_ARG=""

for arg in "$@"; do
  case "$arg" in
    --dry-run|--package-only)
      DRY_RUN=true
      ;;
    -h|--help)
      echo -e "${BOLD}Usage:${NC} ./publish_marketplace.sh [patch|minor|major|<version>] [--package-only] [--dry-run]"
      echo ""
      echo "Examples:"
      echo "  ./publish_marketplace.sh                 # Build and publish current version"
      echo "  ./publish_marketplace.sh patch           # Bump patch version and publish"
      echo "  ./publish_marketplace.sh minor           # Bump minor version and publish"
      echo "  ./publish_marketplace.sh 1.2.1           # Set version 1.2.1 and publish"
      echo "  ./publish_marketplace.sh --package-only  # Only compile and package VSIX"
      exit 0
      ;;
    *)
      if [[ -z "$BUMP_ARG" ]]; then
        BUMP_ARG="$arg"
      else
        log_error "Unexpected argument: $arg"
        exit 1
      fi
      ;;
  esac
done

if [[ -n "$BUMP_ARG" ]]; then
  case "$BUMP_ARG" in
    patch|minor|major)
      log_info "Bumping version ($BUMP_ARG)..."
      npm version "$BUMP_ARG" --no-git-tag-version
      ;;
    v*|[0-9]*)
      CLEAN_VER="${BUMP_ARG#v}"
      log_info "Setting explicit version to $CLEAN_VER..."
      npm version "$CLEAN_VER" --no-git-tag-version
      ;;
    *)
      log_error "Unknown version bump argument '$BUMP_ARG'. Use 'patch', 'minor', 'major', or a semver string (e.g. 1.2.1)."
      exit 1
      ;;
  esac
fi

CURRENT_VER="$(node -p "require('./package.json').version")"
PUBLISHER="$(node -p "require('./package.json').publisher")"
NAME="$(node -p "require('./package.json').name")"
ITEM_ID="${PUBLISHER}.${NAME}"

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Target: ${CYAN}${ITEM_ID}${NC} ${BOLD}v${CURRENT_VER}${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# ─── 2. Clean & Compile TypeScript ────────────────────────────────────────────
log_info "Compiling extension TypeScript..."
rm -rf out
npm run compile
log_success "TypeScript compiled cleanly"

# ─── 3. Build VSIX Package ────────────────────────────────────────────────────
log_info "Packaging VSIX artifact..."
rm -f ./*.vsix
npx @vscode/vsce package --no-dependencies

VSIX_FILE="$(ls -t ./*.vsix 2>/dev/null | head -n 1)"
if [[ -z "$VSIX_FILE" || ! -f "$VSIX_FILE" ]]; then
  log_error "Failed to create VSIX package"
  exit 1
fi
log_success "Packaged: $(basename "$VSIX_FILE") ($(du -h "$VSIX_FILE" | cut -f1))"

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  log_success "Packaging complete: $(basename "$VSIX_FILE")"
  log_info "Dry run / package-only mode enabled — skipped publishing."
  exit 0
fi

# ─── 4. Resolve Marketplace Authentication ────────────────────────────────────
VSCE_PAT="${VSCE_PAT:-}"
PAT_FILE="$HOME/.config/sulcus/vsce.pat"

# Attempt 1: Check Azure CLI access token if az is installed & logged in
if [[ -z "$VSCE_PAT" ]] && command -v az >/dev/null 2>&1; then
  AZ_TOKEN="$(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv 2>/dev/null || true)"
  if [[ -n "$AZ_TOKEN" ]]; then
    VSCE_PAT="$AZ_TOKEN"
    log_success "Authenticated via Azure CLI (az account)"
  fi
fi

# Attempt 2: Check saved PAT config file
if [[ -z "$VSCE_PAT" && -f "$PAT_FILE" ]]; then
  VSCE_PAT="$(cat "$PAT_FILE" | tr -d '\r\n')"
  if [[ -n "$VSCE_PAT" ]]; then
    log_success "Loaded token from $PAT_FILE"
  fi
fi

# Attempt 3: Interactive Azure CLI login or manual PAT prompt
if [[ -z "$VSCE_PAT" ]]; then
  if command -v az >/dev/null 2>&1; then
    echo -e "${CYAN}Azure CLI detected.${NC} Would you like to log in via ${BOLD}az login${NC} to authenticate automatically? [Y/n]: "
    read -r USE_AZ
    if [[ ! "$USE_AZ" =~ ^[Nn]$ ]]; then
      log_info "Launching Azure CLI browser login..."
      az login --output none
      AZ_TOKEN="$(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv 2>/dev/null || true)"
      if [[ -n "$AZ_TOKEN" ]]; then
        VSCE_PAT="$AZ_TOKEN"
        log_success "Successfully authenticated with Azure CLI!"
      fi
    fi
  fi

  if [[ -z "$VSCE_PAT" ]]; then
    echo -e "${YELLOW}VSCE Personal Access Token (PAT) not found.${NC}"
    read -r -s -p "Enter your VS Code Marketplace PAT token: " VSCE_PAT
    echo ""
    if [[ -z "$VSCE_PAT" ]]; then
      log_error "A valid authentication token is required to publish to the Marketplace."
      exit 1
    fi
    
    read -r -p "Save this token to $PAT_FILE for future automated runs? [y/N]: " SAVE_PAT
    if [[ "$SAVE_PAT" =~ ^[Yy]$ ]]; then
      mkdir -p "$(dirname "$PAT_FILE")"
      echo "$VSCE_PAT" > "$PAT_FILE"
      chmod 600 "$PAT_FILE"
      log_success "Saved PAT to $PAT_FILE (mode 600)"
    fi
  fi
fi

CURRENT_VER="$(node -p "require('./package.json').version")"
PUBLISHER="$(node -p "require('./package.json').publisher")"
NAME="$(node -p "require('./package.json').name")"
ITEM_ID="${PUBLISHER}.${NAME}"

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Publishing: ${CYAN}${ITEM_ID}${NC} ${BOLD}v${CURRENT_VER}${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# ─── 3. Clean & Compile TypeScript ────────────────────────────────────────────
log_info "Compiling extension TypeScript..."
rm -rf out
npm run compile
log_success "TypeScript compiled cleanly"

# ─── 4. Build VSIX Package ────────────────────────────────────────────────────
log_info "Packaging VSIX artifact..."
rm -f ./*.vsix
npx @vscode/vsce package --no-dependencies

VSIX_FILE="$(ls -t ./*.vsix 2>/dev/null | head -n 1)"
if [[ -z "$VSIX_FILE" || ! -f "$VSIX_FILE" ]]; then
  log_error "Failed to create VSIX package"
  exit 1
fi
if [[ "$DRY_RUN" == true ]]; then
  echo ""
  log_success "Packaging complete: $(basename "$VSIX_FILE")"
  log_info "Dry run / package-only mode enabled — skipped publishing."
  exit 0
fi

# ─── 5. Publish to VS Code Marketplace ────────────────────────────────────────
log_info "Publishing to Visual Studio Code Marketplace..."
npx @vscode/vsce publish --packagePath "$VSIX_FILE" --pat "$VSCE_PAT"
log_success "Successfully published v${CURRENT_VER} to VS Code Marketplace!"
echo -e "   🔗 Marketplace URL: ${CYAN}https://marketplace.visualstudio.com/items?itemName=${ITEM_ID}${NC}"

# ─── 6. Optional: Publish to Open VSX Registry ────────────────────────────────
OVSX_PAT="${OVSX_PAT:-}"
OVSX_FILE="$HOME/.config/sulcus/ovsx.pat"
if [[ -z "$OVSX_PAT" && -f "$OVSX_FILE" ]]; then
  OVSX_PAT="$(cat "$OVSX_FILE" | tr -d '\r\n')"
fi

if [[ -n "$OVSX_PAT" ]]; then
  log_info "Publishing to Open VSX Registry (VSCodium, Cursor, Theia)..."
  npx ovsx publish "$VSIX_FILE" --pat "$OVSX_PAT"
  log_success "Successfully published to Open VSX!"
  echo -e "   🔗 Open VSX URL: ${CYAN}https://open-vsx.org/extension/${PUBLISHER}/${NAME}${NC}"
fi

echo ""
log_success "All done! Extension v${CURRENT_VER} is live."
