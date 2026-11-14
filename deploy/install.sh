#!/bin/bash
# Установка и обновление ВайРассрочки на чистом сервере Ubuntu. Запускать от root.
#   bash install.sh
# Необязательно перед запуском (переменные окружения):
#   DOMAIN=мой-домен.ru   — если не задан, для теста берётся адрес вида 1-2-3-4.sslip.io (https работает сам)
#   BRANCH=имя-ветки      — какую ветку ставить (по умолчанию main)
#   GIT_TOKEN=...         — только если репозиторий закрытый (токен только для чтения)
# Все пароли и ключи создаются на самом сервере и нигде больше не показываются.
set -euo pipefail

REPO="r4h9k9cd6s-droid/vayrassrochka"
BRANCH="${BRANCH:-main}"
DIR=/opt/vayrassrochka

echo "== 1/5 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "== 2/5 Код приложения"
if [ -n "${GIT_TOKEN:-}" ]; then URL="https://x-access-token:${GIT_TOKEN}@github.com/${REPO}.git"; else URL="https://github.com/${REPO}.git"; fi
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" remote set-url origin "$URL"
  git -C "$DIR" fetch origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$URL" "$DIR"
fi
git -C "$DIR" remote set-url origin "https://github.com/${REPO}.git"   # токен не остаётся на диске
cd "$DIR"

echo "== 3/5 Настройки (.env)"
if [ ! -f .env ]; then
  IP=$(curl -fsS https://api.ipify.org)
  HOST="${DOMAIN:-${IP//./-}.sslip.io}"
  KEYS=$(docker run --rm node:22-slim npx --yes web-push generate-vapid-keys --json)
  PUB=$(echo "$KEYS" | sed -n 's/.*"publicKey": *"\([^"]*\)".*/\1/p')
  PRIV=$(echo "$KEYS" | sed -n 's/.*"privateKey": *"\([^"]*\)".*/\1/p')
  umask 077
  cat > .env <<ENV
DB_PASSWORD=$(openssl rand -hex 24)
DOMAIN=${HOST}
PUBLIC_URL=https://${HOST}
COOKIE_SECURE=1
VAPID_PUBLIC_KEY=${PUB}
VAPID_PRIVATE_KEY=${PRIV}
VAPID_SUBJECT=mailto:admin@${HOST}
BACKUP_KEEP_DAYS=14
ENV
  echo "Создан файл .env (пароли и ключи сгенерированы на этом сервере)."
else
  echo ".env уже есть — не трогаю."
fi

echo "== 4/5 Сборка и запуск (несколько минут)"
docker compose up -d --build

echo "== 5/5 Готово"
HOST=$(sed -n 's/^DOMAIN=//p' .env)
echo "Сайт: https://${HOST}  (сертификат может выдаваться до минуты)"
echo "Проверка: docker compose ps"
echo "Создать владельца: docker compose exec api npx tsx apps/api/src/cli/create-admin.ts ВАШ_ЛОГИН"
