#!/bin/bash
# Показ ИИ-помощника: одна команда запускает прокси к Qwen и публичный адрес.
# Окно терминала не закрывайте, пока идёт показ.
cd "$(dirname "$0")"
if ! curl -s -m 3 -o /dev/null http://127.0.0.1:8080/api/tags; then
  nohup node ollama-proxy.mjs > /tmp/ollama-proxy.log 2>&1 &
  sleep 2
fi
echo "Прокси к Qwen работает. Сейчас откроется публичный адрес…"
ssh -R 80:localhost:8080 nokey@localhost.run
