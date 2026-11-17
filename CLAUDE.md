# watchlist — Project Instructions

Трекер фильмов, сериалов и шоу на GitHub Pages: список «посмотреть», отметка просмотренного, оценка 1–10, статистика. Данные — `data/movies.json` в этом репозитории; сайт пишет их через GitHub API токеном пользователя. Редактировать могут только владелец и один коллаборатор (права на запись в репо).

> **Codex:** read `CODEX.md` first; it overrides this file where they differ.

## 1. Git & GitHub

GitHub user **serchg0george**, repo **serchg0george/watchlist**, branch **master**. GitHub Pages собирается workflow `deploy.yml`: код из `master`, `data/movies.json` из текущей ветки `data/*`.

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

- `index.html`, `style.css` — сайт на HTML/CSS; `src/` — строгий TypeScript без фреймворков и бандлера: `config.ts` (константы), `domain/` (чистая логика без DOM: типы, normalize, ops — изменения данных как сериализуемые `Op`, `applyOp`, validate, stats), `data/` (`GitHubRepository` за `WatchlistRepository`, `SaveQueue`), `state/` (`store.ts` — состояние и `render()`, `saving.ts`), `actions.ts` (действия пользователя), `ui/` (`dom.ts`, `toast.ts`, `stats.ts`, `list/` — список и карточка, `dialogs/` — настройки и категории), `tmdb.ts`, `main.ts` (только связка: `renderAll` и init). `tsc` (`npm run build`, конфиги `tsconfig.json` и `tsconfig.sw.json`) собирает `src/main.ts` в нативные ES-модули `js/main.js` (`index.html` грузит его как `<script type="module">`) и `src/sw.ts` в `sw.js` в корне; `js/` и `sw.js` в `.gitignore` и собираются в `deploy.yml`. Единственная зависимость — `typescript` в devDependencies. Перед коммитом — `npm run check && npm test`.
- `manifest.json`, `src/sw.ts`, `icons/` — установка на телефон и офлайн-кэш (network-first); все модули `js/` перечислены в `SHELL` (`tests/sw-shell.test.ts` проверяет). При добавлении модуля — дописать его в `SHELL` и поднять `CACHE` в `src/sw.ts`.
- `data/movies.json` — данные (схема в `README.md`); `npm run validate-data` их проверяет, Weekly rollover не пушит невалидные данные, Deploy Pages публикует сайт, но краснеет.
- `scripts/` — `delegate.sh`, `qwen.sh`, `coauthor.sh`. `.githooks/` — трейлеры соавторов.

## 4. Local Qwen Lifecycle — MANDATORY

Локальная модель — Qwen3.8-27B в LM Studio (`qwen-local`). Управление: `scripts/qwen.sh up | down | status`. `up` — перед делегированной работой (`scripts/delegate.sh` поднимает сам); `down` — сразу после успешного push. Никогда не оставлять загруженной между сессиями.

## 5. Delegated Work — MANDATORY

Claude решает, локальная модель печатает. Основная работа — код сайта, README, правки данных, переносы текста — идёт через `scripts/delegate.sh <task-file>` (по умолчанию локальная Qwen; `--acli` — Antigravity Flash Low, если локальная модель недоступна). Скрипт работает в одноразовом клоне без remote и возвращает патч; Claude пишет задачу, проверяет патч, применяет `git apply`, исправляет, коммитит и пушит.

- Claude делает анализ, решения, текст задачи, ревью и финальные правки после ревью.
- Неверный патч → одна повторная попытка с исправленной задачей, затем Claude правит сам.
- Правка короче текста задачи (опечатка, одна строка) делается напрямую.
- Исключение — только по явной просьбе пользователя о скорости или переносимости (сессия с телефона и т.п.); тогда агент правит напрямую.
