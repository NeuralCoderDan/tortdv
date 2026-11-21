// Сервер-посредник ИИ-помощника: принимает сообщения с сайта, проверяет их
// и передаёт бесплатной модели на OpenRouter. Ключ к модели живёт только здесь.
//
// Защита:
//  - запросы только с сайта (Origin) и только POST;
//  - первое сообщение — системный промпт кондитерской (по началу текста), иначе отказ;
//  - сообщение посетителя ≤ MAX_MESSAGE символов, модели — не больше HISTORY последних сообщений;
//  - лимит запросов с одного IP в минуту и в сутки;
//  - модель и длина ответа задаются здесь, а не сайтом.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PROMPT_START = "Ты — дружелюбный консультант кондитерской";
const MAX_BODY = 40000;        // байт в запросе
const MAX_SYSTEM = 12000;      // символов в системном промпте (с каталогом)
const MAX_NOTE = 1200;         // символов в справке сайта
const MAX_ASSISTANT = 2500;    // символов в прошлом ответе помощника

// Лимит по IP. Хранится в памяти экземпляра Worker'а — для демо этого достаточно
const hits = new Map();

function allowedOrigin(origin, env) {
  if (!origin) return false;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).includes(origin);
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function reply(status, error, origin) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(origin ? cors(origin) : {}) }
  });
}

function tooMany(ip, env) {
  const now = Date.now();
  const entry = hits.get(ip) || { minute: now, perMinute: 0, day: now, perDay: 0 };
  if (now - entry.minute > 60000) { entry.minute = now; entry.perMinute = 0; }
  if (now - entry.day > 86400000) { entry.day = now; entry.perDay = 0; }
  entry.perMinute += 1;
  entry.perDay += 1;
  hits.set(ip, entry);
  if (hits.size > 5000) hits.clear(); // не даём памяти расти бесконечно
  return entry.perMinute > Number(env.RATE_PER_MINUTE) || entry.perDay > Number(env.RATE_PER_DAY);
}

// Проверяем и чистим сообщения с сайта. Возвращаем готовый список для модели или текст ошибки
function prepare(messages, env) {
  if (!Array.isArray(messages) || !messages.length) return "Нет сообщений";
  const [system, ...rest] = messages;
  if (system?.role !== "system" || typeof system.content !== "string" ||
      !system.content.startsWith(PROMPT_START) || system.content.length > MAX_SYSTEM) {
    return "Неверный системный промпт";
  }

  // Справки сайта (расчёт веса, условия заказа, «отвечай по-русски») — отдельные system-сообщения.
  // Не все модели принимают system в середине разговора, поэтому добавляем их к последнему сообщению посетителя
  const notes = [];
  const dialog = [];
  for (const message of rest) {
    if (typeof message?.content !== "string") return "Неверное сообщение";
    if (message.role === "system") {
      if (message.content.length > MAX_NOTE || notes.length >= 3) return "Слишком длинная справка";
      notes.push(message.content);
    } else if (message.role === "user") {
      if (message.content.length > Number(env.MAX_MESSAGE)) return "Сообщение длиннее лимита";
      dialog.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      dialog.push({ role: "assistant", content: message.content.slice(0, MAX_ASSISTANT) });
    } else {
      return "Неизвестная роль";
    }
  }

  // Только последние HISTORY сообщений, и начинаться они должны с посетителя
  let recent = dialog.slice(-Number(env.HISTORY));
  while (recent.length && recent[0].role !== "user") recent = recent.slice(1);
  if (!recent.length || recent[recent.length - 1].role !== "user") return "Последним должно быть сообщение посетителя";

  if (notes.length) {
    const last = recent[recent.length - 1];
    recent[recent.length - 1] = { role: "user", content: `${last.content}\n\n(${notes.join(" ")})` };
  }
  return [{ role: "system", content: system.content }, ...recent];
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const ok = allowedOrigin(origin, env);

    if (request.method === "OPTIONS") {
      return ok ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    }
    if (!ok) return reply(403, "Запросы только с сайта", null);
    if (request.method !== "POST") return reply(405, "Только POST", origin);
    if (!env.OPENROUTER_API_KEY) return reply(503, "Ключ модели не настроен", origin);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (tooMany(ip, env)) return reply(429, "Слишком много сообщений, попробуйте позже", origin);

    const text = await request.text();
    if (text.length > MAX_BODY) return reply(413, "Слишком большой запрос", origin);
    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      return reply(400, "Неверный JSON", origin);
    }

    const messages = prepare(body.messages, env);
    if (typeof messages === "string") return reply(400, messages, origin);

    const temperature = Math.min(1, Math.max(0, Number(body.temperature) || 0.4));
    // Бесплатные модели часто бывают заняты (429): пробуем основную, потом запасную
    let upstream = null;
    for (const model of [env.MODEL, env.FALLBACK_MODEL, env.FALLBACK2_MODEL].filter(Boolean)) {
      const attempt = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://neuralcoderdan.github.io/tortdv/",
          "X-Title": "Cake shop demo"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: Number(env.MAX_TOKENS),
          // модели с рассуждениями не должны тратить лимит на раздумья: нужен только ответ
          reasoning: { effort: "low", exclude: true },
          stream: true
        })
      });
      if (attempt.ok && attempt.body) { upstream = attempt; break; }
      // Подробности ошибки посетителю не показываем — только в журнал Cloudflare
      console.log("OpenRouter", model, attempt.status, (await attempt.text()).slice(0, 200));
    }

    if (!upstream) {
      return reply(502, "Модель недоступна", origin);
    }

    // Ответ модели потоком — как есть (формат OpenAI: строки «data: {...}»)
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        ...cors(origin)
      }
    });
  }
};
