#!/usr/bin/env bash
# Blind eval of one steering rule (HON-1345): does an agent still need it?
#
#   scripts/steering-eval.sh <rule-id | path/to/rule.json> [--n N] [--model ID]
#
# For each model that reads the steering files, runs N `claude -p` sessions
# with the rule text removed (control). When a control run fails the rule's
# check, runs N more with the rule kept (treatment). Prints one markdown table
# and writes it to <out>/report.md. Method, rule format and how to read the
# table: docs/STEERING_EVAL.md.
#
# --model runs only that model, to re-run a row that ended in `error`.
#
# Env: STEERING_EVAL_N (3), STEERING_EVAL_TIMEOUT (seconds per run, 3600),
# STEERING_EVAL_REF (HEAD), STEERING_EVAL_OUT (/tmp/steering-eval),
# STEERING_EVAL_KEEP (keep the run trees), and the CLAUDE_* overrides of
# models.sh for the models and efforts.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/models.sh"
source "$SCRIPT_DIR/steering-eval-lib.sh"

# The whole run is one function, and `exit` shares the line that calls it, so
# bash has parsed everything it runs before it starts. A script read line by
# line runs shifted text when the file is edited mid-run, and a group run lasts
# hours.
main() {
  usage() {
    echo "Usage: $0 <rule-id | rule.json> [--n N] [--model ID]" >&2
    exit 2
  }

  [ "$#" -ge 1 ] || usage
  RULE_ARG="$1"
  shift
  N="${STEERING_EVAL_N:-3}"
  ONLY_MODEL=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --n) N="${2:-}"; shift 2 || usage ;;
      --model) ONLY_MODEL="${2:-}"; shift 2 || usage ;;
      *) usage ;;
    esac
  done
  [[ "$N" =~ ^[1-9][0-9]*$ ]] || usage

  case "$RULE_ARG" in
    *.json) RULE="$RULE_ARG" ;;
    *) RULE="$SCRIPT_DIR/steering-eval/$RULE_ARG.json" ;;
  esac
  [ -f "$RULE" ] || { echo "No rule definition: $RULE" >&2; exit 2; }
  RULE_ID=$(jq -r .id "$RULE")

  OUT="${STEERING_EVAL_OUT:-/tmp/steering-eval}/$RULE_ID-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$OUT"

  # Every reader of the steering files: unattended workers, Small-tier workers
  # and interactive sessions. A rule is dead only when it is dead on all three.
  MODELS=("$AUTO_MODEL|$AUTO_EFFORT" "$AUTO_MODEL_SMALL|$AUTO_EFFORT_SMALL"
    "$INTERACTIVE_MODEL|$INTERACTIVE_EFFORT")

  ROWS=()
  for entry in "${MODELS[@]}"; do
    model="${entry%%|*}"
    effort="${entry#*|}"
    if [ -n "$ONLY_MODEL" ] && [ "$model" != "$ONLY_MODEL" ]; then continue; fi
    label="$model${effort:+ ($effort)}"
    dir="$OUT/${model}${effort:+-$effort}"
    echo "[steering-eval] $RULE_ID on $label: $N control runs" >&2
    read -r pc fc ec < <(se_run_arm "$RULE" control "$model" "$effort" "$dir" "$N")
    pt="" ft="" et="" treatment="not run"
    if [ "$fc" -gt 0 ]; then
      echo "[steering-eval] $RULE_ID on $label: a control run failed, $N treatment runs" >&2
      read -r pt ft et < <(se_run_arm "$RULE" treatment "$model" "$effort" "$dir" "$N")
      treatment=$(se_count "$pt" "$et" "$N")
    fi
    ROWS+=("| $RULE_ID | $label | $(se_count "$pc" "$ec" "$N") | $treatment | $(se_verdict "$pc" "$fc" "$ec" "$pt" "$ft" "$et") |")
  done
  if [ "${#ROWS[@]}" -eq 0 ]; then
    echo "No model matches --model $ONLY_MODEL" >&2
    exit 2
  fi

  {
    echo "| Rule | Model | Control pass | Treatment pass | Verdict |"
    echo "| -- | -- | -- | -- | -- |"
    printf '%s\n' "${ROWS[@]}"
    echo
    se_odds_sentence "$N"
  } | tee "$OUT/report.md"
  echo "[steering-eval] Runs, diffs and stream-json: $OUT" >&2
}

main "$@"; exit
