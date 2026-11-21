// Настройки ИИ-помощника.
// Для демо модель работает у вас на компьютере через Ollama (см. README).
// Когда появится сервер-посредник, здесь меняется только адрес (и, при необходимости, модель).

const ASSISTANT_CONFIG = {
  endpoint: "https://tortdv-assistant.saidovdaniel2.workers.dev", // сервер-посредник (Cloudflare Worker), ответ потоком
  // Для проверки на своём Mac можно вернуть Ollama: "http://localhost:11434/v1/chat/completions"
  model: "google/gemma-4-31b-it:free", // справочно: модель выбирает сервер-посредник (см. worker/wrangler.toml)
  temperature: 0.4,

  maxMessageLength: 500, // символов в одном сообщении
  maxUserMessages: 20,   // сообщений от посетителя за сессию (вкладку), потом — WhatsApp
  historyForModel: 10,   // сколько последних сообщений диалога отправлять модели
  firstTokenTimeoutMs: 90000 // нет ни слова за это время — считаем, что помощник недоступен
};
