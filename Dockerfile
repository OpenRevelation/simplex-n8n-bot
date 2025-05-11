# Dockerfile для объединенного сервиса (SimpleX CLI + Node.js бот-скрипт)
ARG SIMPLEX_VERSION="v6.3.3"

# Этап 1: Скачивание SimpleX Chat CLI
FROM alpine:3.18 AS simplex_builder
ARG SIMPLEX_VERSION
ENV DEBIAN_FRONTEND=noninteractive
RUN apk add --no-cache curl ca-certificates
RUN curl -Lo simplex-chat https://github.com/simplex-chat/simplex-chat/releases/download/${SIMPLEX_VERSION}/simplex-chat-ubuntu-22_04-x86-64 && \
    chmod +x simplex-chat && \
    mv simplex-chat /usr/local/bin/simplex-chat

# Этап 2: Основной образ на базе Node.js
FROM node:18-slim 

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgmp10 zlib1g libssl3 supervisor ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=simplex_builder /usr/local/bin/simplex-chat /usr/local/bin/simplex-chat

# Создание каталога для базы данных SimpleX (Volume будет монтироваться сюда)
RUN mkdir -p /data/simplex_db

# !!! НОВЫЙ ШАГ: Попытка инициализировать профиль при сборке образа !!!
# Мы надеемся, что эта команда создаст файлы базы данных в /data/simplex_db
# с профилем "N8NBot" и потом завершится.
# Флаг -t1 (таймаут 1 секунда) добавлен на всякий случай, если -e без -p ждет чего-то еще.
RUN /usr/local/bin/simplex-chat -d /data/simplex_db -e "/prof display_name N8NBot" -t1 || true
# Добавлено "|| true", чтобы сборка не падала, если команда завершится с ошибкой, 
# но мы все равно хотим попробовать запустить основной supervisord.

# Настройка для Node.js скрипта бота
WORKDIR /app/bot_script 
COPY ./bot_script/package*.json ./
RUN npm install --omit=dev --legacy-peer-deps
COPY ./bot_script/ ./

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

ENV SIMPLEX_CLI_WS_URL="ws://localhost:5225"
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]