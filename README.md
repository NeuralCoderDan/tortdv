# Прототип сайта кондитерской

## Как запустить помощника для демо

ИИ-помощник (кнопка в правом нижнем углу) в демо-режиме
работает через модель на вашем компьютере — [Ollama](https://ollama.com).
Поэтому он отвечает **только на том компьютере, где запущена Ollama**: на телефоне
или у клиента чат покажет «Сейчас я не могу ответить на ваш вопрос» и кнопку WhatsApp.

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

   Настройка `launchctl setenv` сбрасывается после перезагрузки Mac. Чтобы не повторять
   команды, можно сделать автозапуск (см. ниже). Проверить, что Ollama работает:
   `curl http://localhost:11434/api/tags`. С адреса `http://localhost:…` Ollama пускает
   запросы и без этой настройки.

   **Автозапуск (Ollama через Homebrew).** Файл
   `~/Library/LaunchAgents/local.tortdv.ollama-origins.plist` при каждом входе в систему
   выполняет `launchctl setenv OLLAMA_ORIGINS …` и перезапускает службу `sh.brew.ollama`.
   Содержимое файла:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key>
     <string>local.tortdv.ollama-origins</string>
     <key>ProgramArguments</key>
     <array>
       <string>/bin/sh</string>
       <string>-c</string>
       <string>/bin/launchctl setenv OLLAMA_ORIGINS "https://neuralcoderdan.github.io,http://localhost:*"; sleep 5; /bin/launchctl kickstart -k gui/$(/usr/bin/id -u)/sh.brew.ollama || true</string>
     </array>
     <key>RunAtLoad</key>
     <true/>
   </dict>
   </plist>
   ```

   Включить сразу, без перезагрузки:

   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.tortdv.ollama-origins.plist
   ```

   Убрать автозапуск:

   ```bash
   launchctl bootout gui/$(id -u)/local.tortdv.ollama-origins
   ```

   ```bash
   rm ~/Library/LaunchAgents/local.tortdv.ollama-origins.plist
   ```

3. Откройте сайт в **Chrome** (Safari может блокировать запросы к localhost).
   При первом сообщении Chrome может спросить разрешение на доступ к устройствам
   в локальной сети — нажмите «Разрешить».
