# ТортДВ — прототип сайта

## Как запустить помощника для демо

ИИ-помощник «Помощник ТортДВ» (круглая кнопка в правом нижнем углу) в демо-режиме
работает через модель на вашем компьютере — [Ollama](https://ollama.com).
Поэтому он отвечает **только на том компьютере, где запущена Ollama**: на телефоне
или у клиента чат покажет «Помощник сейчас отдыхает 😴» и кнопку WhatsApp.

Настройки (адрес, модель, temperature, лимиты) — в `config.js`.
Каталог помощник берёт через `getCatalog()` в `assistant.js` (сейчас — из `data.js`).

1. Скачайте модель (≈4,7 ГБ, один раз):

   ```bash
   ollama pull qwen2.5:7b
   ```

2. Разрешите Ollama принимать запросы с сайта и перезапустите её (macOS):

   ```bash
   launchctl setenv OLLAMA_ORIGINS "https://neuralcoderdan.github.io,http://localhost:*"
   ```

   Затем перезапустите Ollama — одной из команд, смотря как она установлена.
   Через Homebrew (`brew services list` показывает `ollama started`):

   ```bash
   brew services restart ollama
   ```

   Приложением Ollama (значок ламы в строке меню):

   ```bash
   osascript -e 'quit app "Ollama"' && open -a Ollama
   ```

   Настройка `launchctl setenv` сбрасывается после перезагрузки Mac — тогда повторите
   эти команды. Проверить, что Ollama работает: `curl http://localhost:11434/api/tags`.
   С адреса `http://localhost:…` Ollama пускает запросы и без этой настройки.

3. Откройте сайт в **Chrome** (Safari может блокировать запросы к localhost).
   При первом сообщении Chrome может спросить разрешение на доступ к устройствам
   в локальной сети — нажмите «Разрешить».
