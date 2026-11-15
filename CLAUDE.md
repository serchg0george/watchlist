# watchlist — Project Instructions

Трекер фильмов, сериалов и шоу на GitHub Pages: список «посмотреть», отметка просмотренного, оценка 1–5, статистика. Данные — `data/movies.json` в этом репозитории; сайт пишет их через GitHub API токеном пользователя. Редактировать могут только владелец и один коллаборатор (права на запись в репо).

## 1. Git & GitHub

GitHub user **serchg0george**, repo **serchg0george/watchlist**, branch **master**. GitHub Pages публикует `master` из корня.

- Перед работой: `gh auth switch --user serchg0george` (не `gh auth status` — зависает), затем `git fetch --all --prune && git pull --ff-only`. Pull не прошёл (diverged, конфликты, auth/network) → стоп, сообщить, спросить. Никаких `rebase`, `merge`, `reset --hard`, force без явного запроса.
- **Identity — MANDATORY.** Перед любым коммитом: `git config --local user.name` = `serchg0george`, `user.email` = `serchg0george@users.noreply.github.com`; если не так — выставить с `--local`. Никогда `git config --global` — глобальный конфиг принадлежит рабочему аккаунту Expedia.
- **Co-authors — MANDATORY.** Каждая модель, работавшая над коммитом, указывается как `Co-authored-by`. `scripts/delegate.sh` регистрирует исполнителя сам; агент сессии добавляет себя перед коммитом: `scripts/coauthor.sh add <alias>` (`scripts/coauthor.sh aliases`). Трейлеры пишет хук `.githooks/prepare-commit-msg`; после клона один раз: `git config --local core.hooksPath .githooks`.
- **Post-push cleanup — MANDATORY.** После push: если `gh auth status` показывает `szavada_expedia`, выполнить `gh auth switch --user szavada_expedia`. Нет такого аккаунта (личная машина) — пропустить.
- `data/movies.json` правится и с сайта (коммиты от имени пользователей). Перед своими изменениями всегда `git pull --ff-only`.

## 2. Language & Style

- Коммиты — **English**. Интерфейс сайта, документация, общение — **Russian**.
- Строго и по делу, без нравоучений. Не ссылаться на номера и названия правил в ответах, не пересказывать процедуры, без чек-листов выполненных шагов. Меньше слов по умолчанию.
- Всё, что пользователь должен куда-то вставить, — полный финальный текст в одном блоке кода.

## 3. Структура

- `index.html`, `style.css`, `app.js` — сайт, чистый HTML/CSS/JS, без сборки, npm и фреймворков.
- `data/movies.json` — данные (схема в `README.md`).
- `scripts/` — `delegate.sh`, `qwen.sh`, `coauthor.sh`. `.githooks/` — трейлеры соавторов.

## 4. Local Qwen Lifecycle — MANDATORY

Локальная модель — Qwen3.8-27B в LM Studio (`qwen-local`). Управление: `scripts/qwen.sh up | down | status`. `up` — перед делегированной работой (`scripts/delegate.sh` поднимает сам); `down` — сразу после успешного push. Никогда не оставлять загруженной между сессиями.

## 5. Delegated Work — MANDATORY

Claude решает, локальная модель печатает. Основная работа — код сайта, README, правки данных, переносы текста — идёт через `scripts/delegate.sh <task-file>` (по умолчанию локальная Qwen; `--acli` — Antigravity Flash Low, если локальная модель недоступна). Скрипт работает в одноразовом клоне без remote и возвращает патч; Claude пишет задачу, проверяет патч, применяет `git apply`, исправляет, коммитит и пушит.

- Claude делает анализ, решения, текст задачи, ревью и финальные правки после ревью.
- Неверный патч → одна повторная попытка с исправленной задачей, затем Claude правит сам.
- Правка короче текста задачи (опечатка, одна строка) делается напрямую.
- Исключение — только по явной просьбе пользователя о скорости или переносимости (сессия с телефона и т.п.); тогда агент правит напрямую.
