#!/usr/bin/env bash
# =============================================================================
#  tests/run-qa.sh — Phase 1 QA One-Command Entrypoint
#
#  Usage:
#    ./tests/run-qa.sh              # Run all automated tests
#    ./tests/run-qa.sh unit         # Run only unit tests
#    ./tests/run-qa.sh integration  # Run only integration tests (needs server)
#    ./tests/run-qa.sh all          # Explicit: unit + existing + integration
#
#  Environment:
#    SERVER_URL=http://localhost:3456  (override for remote server)
#    SKIP_INTEGRATION=1                (skip integration tests without a running server)
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS_DIR="$ROOT/tests"
SERVER_URL="${SERVER_URL:-http://localhost:3456}"
MODE="${1:-all}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

header() {
  echo ""
  echo -e "${BLUE}${BOLD}══════════════════════════════════════════════${NC}"
  echo -e "${BLUE}${BOLD}  $1${NC}"
  echo -e "${BLUE}${BOLD}══════════════════════════════════════════════${NC}"
}

section() {
  echo ""
  echo -e "${YELLOW}── $1 ──${NC}"
}

run_node_test() {
  local file="$1"
  local label="$2"
  echo ""
  echo -e "  ${BOLD}Running: ${label}${NC}"
  if node --test "$file" 2>&1; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}✓ Passed${NC}"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}✗ Failed${NC}"
  fi
}

run_integration() {
  local file="$1"
  local label="$2"
  echo ""
  echo -e "  ${BOLD}Running: ${label}${NC}"
  if SERVER_URL="$SERVER_URL" node "$file" 2>&1; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}✓ Passed${NC}"
  else
    local exit_code=$?
    # Exit 0 means all tests passed (even with skips)
    # Non-zero means failures
    if [ $exit_code -ne 0 ]; then
      FAIL=$((FAIL + 1))
      echo -e "  ${RED}✗ Failed (exit $exit_code)${NC}"
    fi
  fi
}

# =============================================================================
header "mdpage Phase 1 QA Suite"
echo ""
echo "  Mode:       $MODE"
echo "  Server URL: $SERVER_URL"
echo "  Node:       $(node --version)"
echo "  Date:       $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# =============================================================================
if [[ "$MODE" == "all" || "$MODE" == "unit" ]]; then
  header "Unit Tests"

  section "Slug Rules [SL-01..SL-13]"
  run_node_test "$TESTS_DIR/unit/slug-rules.test.js" "slug-rules.test.js"

  section "Lifecycle State Machine [LC-01..LC-14]"
  run_node_test "$TESTS_DIR/unit/lifecycle.test.js" "lifecycle.test.js"

  section "View Deduplication [VD-01..VD-10]"
  run_node_test "$TESTS_DIR/unit/view-dedup.test.js" "view-dedup.test.js"
fi

# =============================================================================
if [[ "$MODE" == "all" || "$MODE" == "existing" ]]; then
  header "Existing Tests (regression guard)"

  section "validate-publish.js (markdown functions)"
  echo ""
  echo -e "  ${BOLD}Running: scripts/validate-publish.js${NC}"
  if node "$ROOT/scripts/validate-publish.js" 2>&1; then
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}✓ Passed${NC}"
  else
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}✗ Failed${NC}"
  fi
fi

# =============================================================================
if [[ "$MODE" == "all" || "$MODE" == "integration" ]]; then
  header "Integration Tests (Phase 1 API)"

  if [[ "${SKIP_INTEGRATION:-0}" == "1" ]]; then
    echo ""
    echo -e "  ${YELLOW}⊘ Integration tests skipped (SKIP_INTEGRATION=1)${NC}"
    SKIP=$((SKIP + 1))
  else
    section "API Phase 1 [API-01..API-12]"
    run_integration "$TESTS_DIR/integration/api-phase1.test.js" "api-phase1.test.js"
  fi
fi

# =============================================================================
header "Summary"
echo ""
echo -e "  ${GREEN}Passed:  $PASS${NC}"
echo -e "  ${RED}Failed:  $FAIL${NC}"
echo -e "  ${YELLOW}Skipped: $SKIP${NC}"
echo ""

if [ $FAIL -gt 0 ]; then
  echo -e "  ${RED}${BOLD}QA FAILED — see errors above.${NC}"
  echo ""
  echo "  Next steps:"
  echo "  1. Fix failing tests"
  echo "  2. If Phase 1 features not yet implemented, run with SKIP_INTEGRATION=1"
  echo "     SKIP_INTEGRATION=1 ./tests/run-qa.sh"
  exit 1
else
  echo -e "  ${GREEN}${BOLD}All checks passed ✓${NC}"
  echo ""
  echo "  See tests/manual/qa-checklist.md for browser verification steps."
  exit 0
fi
