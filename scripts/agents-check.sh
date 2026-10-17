#!/usr/bin/env bash
# Проверка связи: подключены ли Claude Code и Codex к ЭТОЙ папке.
#
#   bash scripts/agents-check.sh                 показать состояние
#   bash scripts/agents-check.sh ping claude     записать, что Claude Code на связи
#   bash scripts/agents-check.sh ping codex      записать, что Codex на связи
#   bash scripts/agents-check.sh reset           очистить отметки
#
# Каждый агент сам запускает `ping <имя>` из своей рабочей папки. Скрипт записывает
# путь корня репозитория, поэтому видно и то, что агент подключён не к той папке.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd -P)"
LOG=".agents/handshake.log"
AGENTS=(claude codex)
GIT=git; [ -x /Applications/Xcode.app/Contents/Developer/usr/bin/git ] && GIT=/Applications/Xcode.app/Contents/Developer/usr/bin/git
branch="$($GIT rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
head="$($GIT rev-parse --short HEAD 2>/dev/null || echo '?')"

case "${1:-status}" in
  ping)
    name="${2:-}"
    case " ${AGENTS[*]} " in *" $name "*) ;; *) echo "Имя агента: claude или codex"; exit 2;; esac
    mkdir -p .agents
    printf '%s|%s|%s|%s|%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$name" "$ROOT" "$branch" "$head" >> "$LOG"
    echo "OK: $name записан ($ROOT, ветка $branch, $head)"
    exit 0;;
  reset)
    rm -f "$LOG"; echo "Отметки очищены"; exit 0;;
esac

echo "Папка:  $ROOT"
echo "Ветка:  $branch ($head), несохранённых файлов: $($GIT status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
echo
echo "Файлы для агентов:"
bad=0
for f in AGENTS.md CLAUDE.md TASKS.md docs/tz.md; do
  if [ -f "$f" ]; then echo "  есть  $f"; else echo "  НЕТ   $f"; bad=1; fi
done
echo
echo "Связь:"
ok=0
for a in "${AGENTS[@]}"; do
  line=""
  [ -f "$LOG" ] && line="$(grep "|$a|" "$LOG" | tail -1)"
  if [ -z "$line" ]; then
    echo "  $a: не отмечался"
  else
    IFS='|' read -r t _ path br hd <<< "$line"
    if [ "$path" = "$ROOT" ]; then echo "  $a: на связи, $t (ветка $br)"; ok=$((ok+1))
    else echo "  $a: ОТМЕТИЛСЯ В ДРУГОЙ ПАПКЕ: $path"; fi
  fi
done
echo
if [ "$ok" -eq 2 ] && [ "$bad" -eq 0 ]; then echo "ИТОГ: оба агента подключены к этой папке."; exit 0
else echo "ИТОГ: связь неполная."; exit 1; fi
