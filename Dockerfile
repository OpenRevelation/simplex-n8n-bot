# Dockerfile для объединенного сервиса (SimpleX CLI + Node.js бот-скрипт)

# Убедись, что это актуальная стабильная версия, и файл по ссылке ниже существует!
ARG SIMPLEX_VERSION="v6.3.3" 

# Этап 1: Скачивание SimpleX Chat CLI
FROM alpine:3.18 AS simplex_builder 
ARG SIMPLEX_VERSION
ENV DEBIAN_FRONTEND=noninteractive

# Установка зависимостей, необходимых для загрузки
RUN apk add --no-cache curl ca-certificates

# Загрузка бинарного файла SimpleX Chat CLI
# Убедись, что имя файла (simplex-chat-ubuntu-22_04-x86-64) 
# и версия (${SIMPLEX_VERSION}) в URL корректны и файл доступен!
RUN curl -Lo simplex-chat https://github.com/simplex-chat/simplex-chat/releases/download/${SIMPLEX_VERSION}/simplex-chat-ubuntu-22_04-x86-64 && \
    chmod +x simplex-chat && \
    mv simplex-chat /usr/local/bin/simplex-chat

# Этап 2: Основной образ на базе Node.js
FROM node:18-slim 

ENV DEBIAN_FRONTEND=noninteractive

# Установка зависимостей для SimpleX CLI (из Ubuntu/Debian) и supervisor
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgmp10 zlib1g libssl3 supervisor ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Копирование скачанного SimpleX CLI из предыдущего этапа
COPY --from=simplex_builder /usr/local/bin/simplex-chat /usr/local/bin/simplex-chat

# Настройка для Node.js скрипта бота
WORKDIR /app/bot_script 
COPY ./bot_script/package*.json ./
RUN npm install --omit=dev --legacy-peer-deps
COPY ./bot_script/ ./

# Создание каталога для базы данных SimpleX (инструкцию VOLUME убрали для Railway)
RUN mkdir -p /data/simplex_db 

# Копирование файла конфигурации supervisord
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Переменные окружения для скрипта бота (остальные будут из Railway)
ENV SIMPLEX_CLI_WS_URL="ws://localhost:5225"

# Команда для запуска supervisord
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
