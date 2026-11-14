// Логика прототипа: каталог, фильтры, выбор веса, полёт в корзину, оформление и оплата.

/* ===================== Вспомогательное ===================== */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const findCake = (id) => CAKES.find((cake) => cake.id === id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 7600 → «7 600 ₽» (обычный пробел, чтобы одинаково выглядело везде)
const money = (value) => Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ") + " ₽";
const kilos = (value) => String(value).replace(".", ",") + " кг";

// 1 торт, 2 торта, 5 тортов
function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Дата ГГГГ-ММ-ДД через N дней от сегодня
function dateFromToday(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const prettyDate = (iso) => iso.split("-").reverse().join(".");

/* ===================== Фото торта (или заглушка) ===================== */

const PH_ICON =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 26h32v14H8z"/><path d="M11 26v-7h26v7"/>' +
  '<path d="M8 32c4 3 8 3 12 0s8-3 12 0 6 2 8 0"/><path d="M24 19v-6"/><path d="M24 10c1.5 0 1.5-2 0-3.5-1.5 1.5-1.5 3.5 0 3.5Z"/></svg>';

// Любое фото: src — точный путь из data.js. Нет пути — заглушка без запроса к серверу.
// Если файл всё же не загрузился — тоже показываем заглушку.
function photoHTML(src, alt, tint, lazy = true) {
  if (!src) {
    return `
    <div class="media no-photo" style="--tint:${tint}">
      <div class="media__ph">${PH_ICON}<small>Фото скоро будет</small></div>
    </div>`;
  }
  return `
    <div class="media" style="--tint:${tint}">
      <img src="${src}" alt="${alt}" ${lazy ? 'loading="lazy"' : ""}
           onerror="this.parentNode.classList.add('no-photo')">
      <div class="media__ph">${PH_ICON}<small>${src}</small></div>
    </div>`;
}

// Главное фото торта
function mediaHTML(cake, lazy = true) {
  return photoHTML(cake.photo, `Торт «${cake.name}»`, cake.tint, lazy);
}

// Все фото торта для галереи: главное + ракурсы из angles (по порядку galleryLabels)
function galleryOf(cake) {
  return CONFIG.galleryLabels.map((label, i) => ({
    label,
    base: i === 0 ? cake.photo : (cake.angles || [])[i - 1] || null
  }));
}

/* ===================== Цена с «прокруткой» цифр ===================== */

// Каждая цифра — столбик 0–9, который сдвигается на нужную цифру
function setOdometer(el, value) {
  const text = money(value);
  el.setAttribute("aria-label", text);

  // Если длина числа изменилась — пересобираем разметку
  if (el.dataset.text?.length !== text.length) {
    el.innerHTML =
      '<span class="odo" aria-hidden="true">' +
      [...text].map((ch) => {
        if (/\d/.test(ch)) {
          const digits = Array.from({ length: 10 }, (_, d) => `<span>${d}</span>`).join("");
          return `<span class="odo__digit"><span class="odo__strip">${digits}</span></span>`;
        }
        return ch === " " ? '<span class="odo__sep"></span>' : `<span>${ch}</span>`;
      }).join("") +
      "</span>";
    void el.offsetWidth; // фиксируем стартовое положение, чтобы анимация сработала
  }

  const strips = $$(".odo__strip", el);
  [...text].filter((ch) => /\d/.test(ch)).forEach((digit, i) => {
    strips[i].style.transform = `translateY(${-digit}em)`;
  });
  el.dataset.text = text;
}

/* ===================== Каталог и фильтры ===================== */

// Выбранный вес на каждой карточке
const chosenWeight = Object.fromEntries(CAKES.map((cake) => [cake.id, CONFIG.defaultWeight]));

// Выбранные поводы. Пустой набор — показываем все торты
const activeTags = new Set();
let activeSort = "default";

// Вес в заголовке фильтра. Его выбор ставит этот вес на все карточки
let filterWeight = CONFIG.defaultWeight;
// Цена торта: фиксированная (бенто) или цена за кг × вес
const cakePrice = (cake, weight) => (cake.fixed ? cake.fixed.price : cake.pricePerKg * weight);
// Вес для текста: «750–800 г» или «2 кг»
const weightText = (cake, weight) => (cake.fixed ? cake.fixed.weight : kilos(weight));
// Цена для фильтра — ровно та, что сейчас на карточке (при выбранном на ней весе)
const basePrice = (cake) => cakePrice(cake, chosenWeight[cake.id]);
const PRICE_STEP = 50;
let PRICE_MIN = 0;
let PRICE_MAX = 0;
const price = { from: 0, to: 0 };

// Границы ползунка — от самого дешёвого до самого дорогого торта при весах на карточках
function computePriceBounds() {
  PRICE_MIN = Math.floor(Math.min(...CAKES.map(basePrice)) / PRICE_STEP) * PRICE_STEP;
  PRICE_MAX = Math.ceil(Math.max(...CAKES.map(basePrice)) / PRICE_STEP) * PRICE_STEP;
}
computePriceBounds();
price.from = PRICE_MIN;
price.to = PRICE_MAX;

// Сколько гостей накормит торт: примерно 150–200 г на человека
function guestsText(kg) {
  const low = Math.max(2, Math.round((kg * 1000) / 200));
  const high = Math.max(low + 1, Math.round((kg * 1000) / 150));
  return `≈ ${low}–${high} ${plural(high, "гость", "гостя", "гостей")}`;
}

function renderFilters() {
  // Плашки по поводу наверху: быстрый доступ, можно выбрать несколько
  $("#filters").innerHTML = FILTERS.map(
    (filter) =>
      `<button class="chip" type="button" data-filter="${filter.id}" aria-pressed="${isTagOn(filter.id)}">${filter.label}</button>`
  ).join("");

  // Те же поводы в панели фильтров
  $("#filter-tags").innerHTML = FILTERS.filter((filter) => filter.id !== "all")
    .map((filter) => `
      <button class="tag-pick" type="button" data-filter="${filter.id}" aria-pressed="${isTagOn(filter.id)}">
        <span class="tag-pick__box" aria-hidden="true"></span>${filter.label}
      </button>`).join("");

  $("#filter-sort").innerHTML = SORTS
    .map((sort) => `<option value="${sort.id}">${sort.label}</option>`)
    .join("");
}

function renderCatalog() {
  const rules = `заказ за ${CONFIG.minDays} дней · предоплата ${CONFIG.prepay * 100}%`;

  // Торт за кг — плашки веса; торт с фиксированной ценой — просто его вес
  const weightsHTML = (cake) =>
    cake.fixed
      ? `<div class="weights weights--fixed"><span class="weight weight--fixed">${cake.fixed.weight}</span></div>`
      : `<div class="weights" role="radiogroup" aria-label="Вес торта «${cake.name}»">
          ${CONFIG.weights.map((kg) => `
            <button class="weight" type="button" role="radio" data-kg="${kg}"
                    aria-checked="${kg === chosenWeight[cake.id]}">
              ${kilos(kg)}
            </button>`).join("")}
        </div>`;

  $("#catalog").innerHTML = CAKES.map((cake) => `
    <article class="card" data-id="${cake.id}">
      <button class="card__zoom" type="button" data-zoom aria-label="Смотреть все фото торта «${cake.name}»">
        ${mediaHTML(cake)}
        <span class="zoom-hint" aria-hidden="true">
          <svg viewBox="0 0 12 12"><path d="M7 1h4v4M5 11H1V7M11 1 7 5M1 11l4-4"/></svg>${CONFIG.galleryLabels.length} фото
        </span>
      </button>
      <div class="card__body">
        <h3 class="card__name" title="${cake.name}"><span>${cake.name}</span></h3>
        <p class="card__desc">${cake.desc}</p>
        <p class="terms">${cake.fixed ? cake.fixed.weight : "от " + kilos(CONFIG.weights[0])} · ${rules}</p>
        ${weightsHTML(cake)}
        <div class="card__foot">
          <span class="card__price"></span>
          <button class="btn btn--primary" type="button" data-add>В корзину</button>
        </div>
      </div>
    </article>`).join("");

  CAKES.forEach((cake) => updateCardPrice(cake.id));
}

function updateCardPrice(id) {
  const card = $(`.card[data-id="${id}"]`);
  setOdometer($(".card__price", card), cakePrice(findCake(id), chosenWeight[id]));
  $$(".weight", card).forEach((button) => {
    button.setAttribute("aria-checked", String(Number(button.dataset.kg) === chosenWeight[id]));
  });
}

// «Все торты» нажата, когда не выбран ни один повод
const isTagOn = (id) => (id === "all" ? activeTags.size === 0 : activeTags.has(id));

// Подходит ли торт под повод и цену.
// Поводов можно выбрать несколько: подходит торт, у которого есть хотя бы один из них
function matches(cake) {
  const tagOk = activeTags.size === 0 || cake.tags.some((tag) => activeTags.has(tag));
  const priceOk = basePrice(cake) >= price.from && basePrice(cake) <= price.to;
  return tagOk && priceOk;
}

// Порядок карточек: как в data.js или по цене за выбранный вес
function sortedCakeIds() {
  const ids = CAKES.map((cake) => cake.id);
  if (activeSort === "default") return ids;
  return ids.sort((a, b) => {
    const diff = basePrice(findCake(a)) - basePrice(findCake(b));
    return activeSort === "cheap" ? diff : -diff;
  });
}

const countMatches = () => CAKES.filter(matches).length;
const cakesWord = (n) => `${n} ${plural(n, "торт", "торта", "тортов")}`;

// Применяем фильтры: лишние карточки плавно исчезают, остальные плавно сдвигаются
let filterRun = 0;

async function applyFilters() {
  const run = ++filterRun; // если человек быстро двигает ползунок — старый проход прерываем
  const cards = $$(".card");
  const show = cards.filter((card) => matches(findCake(card.dataset.id)));
  const leaving = cards.filter((card) => !show.includes(card) && !card.hidden);
  const coming = show.filter((card) => card.hidden);

  updateFoundText(show.length);

  const animate = !reducedMotion.matches;
  if (animate && leaving.length) {
    leaving.forEach((card) => card.classList.add("is-out"));
    await wait(300);
    if (run !== filterRun) return;
  }

  // FLIP: запоминаем, где карточки были, меняем раскладку и плавно доводим до новых мест
  const before = new Map(show.filter((card) => !card.hidden).map((card) => [card, card.getBoundingClientRect()]));
  cards.forEach((card) => (card.hidden = !show.includes(card)));
  leaving.forEach((card) => card.classList.remove("is-out"));

  // Переставляем карточки в нужном порядке — FLIP доведёт их до новых мест плавно
  const catalog = $("#catalog");
  sortedCakeIds().forEach((id) => catalog.appendChild($(`.card[data-id="${id}"]`)));

  if (animate) {
    before.forEach((rect, card) => {
      const now = card.getBoundingClientRect();
      const dx = rect.left - now.left;
      const dy = rect.top - now.top;
      if (dx || dy) {
        card.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
          { duration: 500, easing: "cubic-bezier(.22,.8,.26,1)" }
        );
      }
    });
    coming.forEach((card) => card.classList.add("is-out"));
    void document.body.offsetWidth;
    coming.forEach((card) => card.classList.remove("is-out"));
  }

  $("#catalog-empty").hidden = show.length > 0;
}

// Сколько условий выбрано: поводы + суженная цена + сортировка
function activeFilterCount() {
  const priceNarrowed = price.from !== PRICE_MIN || price.to !== PRICE_MAX;
  return activeTags.size + (priceNarrowed ? 1 : 0) + (activeSort === "default" ? 0 : 1);
}

function updateFoundText(count = countMatches()) {
  $("#found").textContent = count ? `Найдено: ${cakesWord(count)}` : "Ничего не найдено";
  $("#filter-apply").textContent = count ? `Показать ${cakesWord(count)}` : "Нет тортов";

  // На кнопке «Фильтры» — число выбранных условий
  const used = activeFilterCount();
  const dot = $("#filter-dot");
  dot.textContent = used || "";
  dot.hidden = !used;
  $("#filter-clear").hidden = !used;
}

// Нажали повод: «Все торты» сбрасывает выбор, остальные добавляются и убираются
function toggleTag(filterId) {
  if (filterId === "all") activeTags.clear();
  else if (activeTags.has(filterId)) activeTags.delete(filterId);
  else activeTags.add(filterId);
  syncTagUI();
  applyFilters();
}

function syncTagUI() {
  $$("[data-filter]").forEach((button) =>
    button.setAttribute("aria-pressed", String(isTagOn(button.dataset.filter)))
  );
}

/* ===================== Цена «от — до» ===================== */

const fmt = (value) => Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ");
const parsePrice = (text) => Number(String(text).replace(/\D/g, ""));

// Поля, ползунок и закрашенная полоса показывают одно и то же
function syncPriceUI() {
  ["#range-from", "#range-to"].forEach((id) => {
    $(id).min = PRICE_MIN;
    $(id).max = PRICE_MAX;
  });
  $("#filter-weight").value = String(filterWeight);
  $("#price-from").value = fmt(price.from);
  $("#price-to").value = fmt(price.to);
  $("#range-from").value = price.from;
  $("#range-to").value = price.to;
  const span = PRICE_MAX - PRICE_MIN || 1;
  const fill = $("#range-fill");
  fill.style.left = `${((price.from - PRICE_MIN) / span) * 100}%`;
  fill.style.right = `${((PRICE_MAX - price.to) / span) * 100}%`;
}

function setPrice(from, to) {
  price.from = Math.min(Math.max(from, PRICE_MIN), PRICE_MAX);
  price.to = Math.min(Math.max(to, PRICE_MIN), PRICE_MAX);
  syncPriceUI();
  applyFilters();
}

// Сменили вес на одной карточке: границы ползунка пересчитываем.
// Если диапазон не трогали — он остаётся «весь», иначе фильтр сработает по новой цене
function onCardWeightChange() {
  const wasFull = price.from === PRICE_MIN && price.to === PRICE_MAX;
  computePriceBounds();
  if (wasFull) setPrice(PRICE_MIN, PRICE_MAX);
  else setPrice(price.from, price.to);
}

// Сменили вес в фильтре: пересчитываем границы цены, диапазон снова «весь»,
// а на карточках выбираем тот же вес — чтобы цены совпадали с фильтром
function setFilterWeight(kg, syncCards = true) {
  filterWeight = kg;
  $("#filter-guests").textContent = guestsText(kg);
  if (syncCards) {
    CAKES.forEach((cake) => {
      chosenWeight[cake.id] = kg;
      updateCardPrice(cake.id);
    });
  }
  computePriceBounds();
  setPrice(PRICE_MIN, PRICE_MAX);
}

function resetFilters() {
  activeTags.clear();
  activeSort = "default";
  $("#filter-sort").value = "default";
  syncTagUI();
  setFilterWeight(CONFIG.defaultWeight);
}

function setupPriceFilter() {
  // Выпадающий список веса в заголовке: 1,5 / 2 / 2,5 / 3 кг
  const weightSelect = $("#filter-weight");
  weightSelect.innerHTML = CONFIG.weights
    .map((kg) => `<option value="${kg}">${kilos(kg)}</option>`)
    .join("");
  weightSelect.addEventListener("change", () => setFilterWeight(Number(weightSelect.value)));

  // Подсказка под выбором веса: на сколько гостей хватит торта (дальше обновляет setFilterWeight)
  $("#filter-guests").textContent = guestsText(filterWeight);

  // Поводы внутри панели фильтров
  $("#filter-tags").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (button) toggleTag(button.dataset.filter);
  });

  // Сортировка
  const sortSelect = $("#filter-sort");
  sortSelect.addEventListener("change", () => {
    activeSort = sortSelect.value;
    applyFilters();
  });

  ["#range-from", "#range-to"].forEach((id) => {
    $(id).step = PRICE_STEP;
  });

  // Ползунок с клавиатуры (стрелки): ручки не заходят друг за друга
  $("#range-from").addEventListener("input", (event) => {
    setPrice(Math.min(Number(event.target.value), price.to), price.to);
  });
  $("#range-to").addEventListener("input", (event) => {
    setPrice(price.from, Math.max(Number(event.target.value), price.from));
  });

  // Перетаскивание мышью и пальцем: берём ту ручку, что ближе к месту нажатия.
  // Так ручки не «залипают», даже если сошлись в одной точке.
  const range = $("#range");
  let dragging = null;

  const valueAt = (clientX) => {
    const rect = range.getBoundingClientRect();
    const share = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return Math.round((PRICE_MIN + share * (PRICE_MAX - PRICE_MIN)) / PRICE_STEP) * PRICE_STEP;
  };

  const markDragging = (which) => {
    $$(".range input").forEach((input) => input.classList.remove("is-dragging"));
    if (which) $(which === "from" ? "#range-from" : "#range-to").classList.add("is-dragging");
  };

  const moveThumb = (value) => {
    if (dragging === "from") setPrice(Math.min(value, price.to), price.to);
    else setPrice(price.from, Math.max(value, price.from));
  };

  range.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const value = valueAt(event.clientX);
    const toFrom = Math.abs(value - price.from);
    const toTo = Math.abs(value - price.to);
    if (toFrom !== toTo) {
      dragging = toFrom < toTo ? "from" : "to";
    } else if (value !== price.from) {
      // Ручки в одной точке: нажали левее — двигаем «от», правее — «до»
      dragging = value < price.from ? "from" : "to";
    } else {
      // Нажали прямо на сошедшиеся ручки: тянем ту, у которой есть куда двигаться
      dragging = price.from === PRICE_MAX ? "from" : "to";
    }
    event.preventDefault();
    try {
      range.setPointerCapture(event.pointerId); // ведём ручку, даже если палец ушёл с полосы
    } catch (e) {
      /* без захвата тоже работает, пока палец над полосой */
    }
    range.classList.add("is-dragging");
    markDragging(dragging);
    $(dragging === "from" ? "#range-from" : "#range-to").focus({ preventScroll: true });
    moveThumb(value);
  });

  range.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const value = valueAt(event.clientX);
    // Ручки сошлись, а тянем в «чужую» сторону — движение переходит ко второй ручке
    if (price.from === price.to) {
      const next = value < price.from ? "from" : value > price.to ? "to" : dragging;
      if (next !== dragging) {
        dragging = next;
        markDragging(dragging);
      }
    }
    moveThumb(value);
  });

  const stopDrag = () => {
    dragging = null;
    range.classList.remove("is-dragging");
    markDragging(null);
  };
  range.addEventListener("pointerup", stopDrag);
  range.addEventListener("pointercancel", stopDrag);

  // Поля: пока печатают — только цифры с пробелами, применяем по Enter или уходу из поля
  ["#price-from", "#price-to"].forEach((id) => {
    const input = $(id);
    input.addEventListener("input", () => {
      const digits = parsePrice(input.value);
      input.value = digits ? fmt(digits) : "";
    });
    const commit = () => {
      let from = id === "#price-from" ? parsePrice(input.value) || PRICE_MIN : price.from;
      let to = id === "#price-to" ? parsePrice(input.value) || PRICE_MAX : price.to;
      // «от» больше «до» — подтягиваем вторую границу к введённой цене
      if (from > to) [from, to] = id === "#price-from" ? [from, from] : [to, to];
      setPrice(from, to);
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });

  // Торты с фиксированным весом (бенто) от выбранного веса не зависят — говорим об этом прямо
  const fixedCakes = CAKES.filter((cake) => cake.fixed);
  if (fixedCakes.length) {
    $("#price-note").textContent = fixedCakes.length === 1
      ? ` · ${fixedCakes[0].name} — ${fixedCakes[0].fixed.weight}, его цена от веса не зависит`
      : " · у бенто вес фиксированный, их цена от выбранного веса не зависит";
  }

  syncPriceUI();
  updateFoundText();
}

// Панель фильтров на телефоне
function openFilters() {
  document.body.classList.add("filters-open", "no-scroll");
  $("#filter-close").focus({ preventScroll: true });
}

function closeFilters() {
  if (!document.body.classList.contains("filters-open")) return;
  document.body.classList.remove("filters-open", "no-scroll");
  $("#filter-open").focus({ preventScroll: true });
}

/* ===================== Корзина: данные ===================== */

const STORAGE_KEY = "tortdv-order";

// Строка корзины: { id, weight, qty }
let cart = loadCart();

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    // Старые или чужие строки (торт убрали, вес не тот) отбрасываем
    return saved.filter((line) => {
      const cake = findCake(line.id);
      if (!cake || !(line.qty > 0)) return false;
      return cake.fixed ? line.weight === null : CONFIG.weights.includes(line.weight);
    });
  } catch (e) {
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  } catch (e) {
    /* без сохранения прототип всё равно работает */
  }
}

const lineSum = (line) => cakePrice(findCake(line.id), line.weight) * line.qty;
const cartTotal = () => cart.reduce((sum, line) => sum + lineSum(line), 0);
const cartCount = () => cart.reduce((count, line) => count + line.qty, 0);

function addToCart(id, weight) {
  const same = cart.find((line) => line.id === id && line.weight === weight);
  if (same) same.qty += 1;
  else cart.push({ id, weight, qty: 1 });
  saveCart();
}

/* ===================== Индикаторы корзины ===================== */

const isDesktop = () => window.matchMedia("(min-width: 1000px)").matches;

function updateCartUI() {
  const count = cartCount();
  const label = `${count} ${plural(count, "торт", "торта", "тортов")} · ${money(cartTotal())}`;

  // Иконка в шапке
  const badge = $("#cart-badge");
  badge.textContent = count;
  badge.classList.toggle("is-shown", count > 0);
  $("#cart-icon").setAttribute("aria-label", count ? `Корзина: ${label}` : "Корзина пуста");

  // Липкая полоса на телефоне
  $("#cart-bar-text").textContent = label;
  showCartBar(count > 0);
}

function showCartBar(visible) {
  const bar = $("#cart-bar");
  bar.hidden = !visible;
  document.body.style.setProperty("--bar-h", visible ? "84px" : "0px");
}

// Корзина подпрыгивает, счётчик «пыхает»
function bump(elements) {
  elements.forEach(([element, name]) => {
    element.classList.remove(name);
    void element.offsetWidth; // перезапуск анимации
    element.classList.add(name);
  });
}

/* ===================== Полёт фото в корзину ===================== */

// Куда летим: иконка в шапке (компьютер) или иконка в полосе (телефон)
function cartTarget() {
  if (isDesktop()) return $("#cart-icon");
  const bar = $("#cart-bar");
  if (bar.hidden) updateCartUI(); // первый торт: полоса выезжает сразу с актуальной суммой
  // Полоса может как раз выезжать — меряем её конечное положение
  bar.style.animation = "none";
  const rect = $("#cart-bar-icon").getBoundingClientRect();
  bar.style.animation = "";
  return { element: $("#cart-bar-icon"), rect };
}

function flyToCart(media, onLand) {
  const target = cartTarget();
  const targetEl = target.element || target;
  const to = target.rect || targetEl.getBoundingClientRect();

  if (reducedMotion.matches || !media.animate) {
    onLand(targetEl);
    return;
  }

  const from = media.getBoundingClientRect();
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const lift = Math.min(0, dy) - 90; // верх дуги — выше и фото, и корзины

  // Копия фото: внешний слой летит по горизонтали, внутренний — вверх и вниз
  const flyer = document.createElement("div");
  flyer.style.cssText = `position:fixed;z-index:120;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;pointer-events:none`;
  const inner = document.createElement("div");
  inner.className = "flyer";
  inner.style.cssText = "position:absolute;inset:0";
  inner.appendChild(media.cloneNode(true));
  flyer.appendChild(inner);
  document.body.appendChild(flyer);

  const duration = 900;
  const endScale = Math.max(0.06, 28 / from.width);
  flyer.animate(
    [{ transform: "translateX(0)" }, { transform: `translateX(${dx}px)` }],
    { duration, easing: "cubic-bezier(.35,.1,.6,1)", fill: "forwards" }
  );
  const flight = inner.animate(
    [
      { transform: "translateY(0) scale(1) rotate(0)", borderRadius: "18px", easing: "cubic-bezier(.2,.7,.4,1)" },
      { transform: `translateY(${lift}px) scale(.45) rotate(-8deg)`, borderRadius: "40px", offset: 0.42, easing: "cubic-bezier(.6,0,.9,.4)" },
      { transform: `translateY(${dy}px) scale(${endScale}) rotate(12deg)`, borderRadius: "50%", opacity: 0.6 }
    ],
    { duration, fill: "forwards" }
  );
  flight.onfinish = () => {
    flyer.remove();
    onLand(targetEl);
  };
}

/* ===================== Панель оформления ===================== */

function renderSheet() {
  const list = $("#lines");
  if (!cart.length) {
    list.innerHTML = '<li class="lines__empty">Корзина пуста — выберите торт в каталоге</li>';
  } else {
    list.innerHTML = cart.map((line, i) => {
      const cake = findCake(line.id);
      return `
        <li class="line" data-index="${i}">
          ${mediaHTML(cake, false)}
          <div>
            <b class="line__name">${cake.name}</b>
            <span class="line__meta">${cake.fixed
              ? `${cake.fixed.weight} · ${money(cake.fixed.price)}`
              : `${kilos(line.weight)} · ${money(cake.pricePerKg)}/кг`}</span>
            <div class="qty">
              <button type="button" data-act="minus" aria-label="Убрать один">−</button>
              <output>${line.qty}</output>
              <button type="button" data-act="plus" aria-label="Добавить ещё один">+</button>
            </div>
          </div>
          <b class="line__sum">${money(lineSum(line))}</b>
        </li>`;
    }).join("");
  }

  $("#sum-total").textContent = money(cartTotal());
  $("#sum-prepay").textContent = money(cartTotal() * CONFIG.prepay);
  updateWhatsAppLink();
}

let lastFocus = null;

function openSheet() {
  lastFocus = document.activeElement;
  renderSheet();
  hideError();
  document.body.classList.add("sheet-open", "no-scroll");
  $("#sheet-close").focus({ preventScroll: true });
}

function closeSheet() {
  document.body.classList.remove("sheet-open", "no-scroll");
  lastFocus?.focus({ preventScroll: true });
}

/* ===================== Проверка формы и текст заказа ===================== */

const isDelivery = () => $('input[name="delivery"]:checked').value === "yandex";
const phoneDigits = () => $("#f-phone").value.replace(/\D/g, "");

// Возвращает список проблем: [{ field, text }]
function orderProblems() {
  const problems = [];
  const date = $("#f-date").value;
  if (!cart.length) problems.push({ text: "Добавьте торт в корзину." });
  if (!date || date < $("#f-date").min) {
    problems.push({ field: "#f-date", text: `Выберите дату не раньше ${prettyDate($("#f-date").min)}.` });
  }
  if (!$("#f-name").value.trim()) problems.push({ field: "#f-name", text: "Укажите имя." });
  if (phoneDigits().length < 10) problems.push({ field: "#f-phone", text: "Укажите телефон." });
  return problems;
}

function showProblems(problems) {
  $$(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
  problems.forEach((p) => p.field && $(p.field).classList.add("is-invalid"));
  const error = $("#form-error");
  error.textContent = problems.map((p) => p.text).join(" ");
  error.hidden = false;
  const first = problems.find((p) => p.field);
  if (first) $(first.field).focus();
}

function hideError() {
  $("#form-error").hidden = true;
  $$(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
}

function orderText() {
  const rows = cart.map((line, i) => {
    const cake = findCake(line.id);
    const qty = line.qty > 1 ? ` × ${line.qty}` : "";
    return `${i + 1}. ${cake.name}, ${weightText(cake, line.weight)}${qty} — ${money(lineSum(line))}`;
  });
  const address = $("#f-address").value.trim();
  const receive = isDelivery()
    ? `Яндекс.Доставка${address ? ", " + address : ""} (оплачивается отдельно)`
    : `самовывоз, ${CONFIG.address}`;
  const inscription = $("#f-text").value.trim();
  const comment = $("#f-comment").value.trim();

  return [
    "Здравствуйте! Заказ в «ТортДВ»:",
    "",
    ...rows,
    "",
    `Итого: ${money(cartTotal())}`,
    `Предоплата 50%: ${money(cartTotal() * CONFIG.prepay)}`,
    `Дата: ${prettyDate($("#f-date").value)}`,
    `Получение: ${receive}`,
    inscription ? `Надпись: «${inscription}»` : "",
    comment ? `Комментарий: ${comment}` : "",
    refFile ? "Фото-пример: прикреплю следующим сообщением" : "",
    `Имя: ${$("#f-name").value.trim()}`,
    `Телефон: ${$("#f-phone").value.trim()}`
  ].filter((row, i, all) => row !== "" || all[i - 1] !== "").join("\n").trim();
}

function updateWhatsAppLink() {
  $("#wa-btn").href = orderProblems().length
    ? "#"
    : `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(orderText())}`;
}

/* ===================== Окно оплаты (демо) ===================== */

// Рисуем «QR-код»-заглушку: узор с угловыми квадратами, без реальных данных
function fakeQR() {
  const size = 25;
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const inFinder = (x, y) => (x < 8 && y < 8) || (x > size - 9 && y < 8) || (x < 8 && y > size - 9);
  let cells = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inFinder(x, y) && rnd() > 0.52) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  const finder = (x, y) =>
    `<rect x="${x}" y="${y}" width="7" height="7"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
  return `<svg viewBox="0 0 ${size} ${size}" fill="#3b2219" shape-rendering="crispEdges">${cells}${finder(0, 0)}${finder(size - 7, 0)}${finder(0, size - 7)}</svg>`;
}

function openPay() {
  $("#pay-sum").textContent = money(cartTotal() * CONFIG.prepay);
  $("#pay-modal").hidden = false;
  $("#pay-close").focus();
}

function closePay() {
  $("#pay-modal").hidden = true;
  $("#pay-btn").focus();
}

/* ===================== Страница торта ===================== */

// Какой торт открыт и какое из его фото показано крупно
const pd = { id: null, photo: 0, tab: "about", opener: null };

function openProduct(cakeId, opener) {
  const cake = findCake(cakeId);
  pd.id = cakeId;
  pd.photo = 0;
  pd.tab = "about";
  pd.opener = opener;

  $("#pd-crumb").textContent = cake.name;
  $("#pd-name").textContent = cake.name;
  $("#pd-sub").textContent = cake.desc;

  // Вес: плашки для торта на вес, одна строка для бенто
  const weights = $("#pd-weights");
  weights.innerHTML = cake.fixed
    ? `<span class="weight weight--fixed">${cake.fixed.weight}</span>`
    : CONFIG.weights.map((kg) => `
        <button class="weight" type="button" role="radio" data-kg="${kg}"
                aria-checked="${kg === chosenWeight[cake.id]}">${kilos(kg)}</button>`).join("");
  weights.setAttribute("role", cake.fixed ? "presentation" : "radiogroup");

  // Миниатюры: главное фото и 5 ракурсов
  const items = galleryOf(cake);
  $("#pd-thumbs").innerHTML = items.map((item, i) => `
    <button class="pd__thumb" type="button" data-photo="${i}" aria-label="${item.label}">
      ${photoHTML(item.base, "", cake.tint)}
    </button>`).join("");

  // Вкладки: описание всегда первое, остальные из настроек
  $("#pd-tabs").innerHTML = [{ id: "about", label: "Описание" }, ...CONFIG.tabs, { id: "reviews", label: "Отзывы" }]
    .map((tab) => `
      <button class="pd__tab" type="button" role="tab" data-tab="${tab.id}"
              aria-selected="${tab.id === pd.tab}">${tab.label}</button>`).join("");

  const facts = cake.about?.facts || [];
  $("#pd-facts").innerHTML = facts.map(() => "<div><dt></dt><dd></dd></div>").join("");
  $$("#pd-facts div").forEach((row, i) => {
    $("dt", row).textContent = facts[i][0];
    $("dd", row).textContent = facts[i][1];
  });
  $("#pd-facts").hidden = !facts.length;

  showProductPhoto(0);
  renderProductPrice();
  renderProductTab();

  $("#pd").hidden = false;
  document.body.classList.add("no-scroll");
  $("#pd-scroll").scrollTop = 0;
  $("#pd-close").focus({ preventScroll: true });
}

function closeProduct() {
  $("#pd").hidden = true;
  if (!document.body.classList.contains("sheet-open")) document.body.classList.remove("no-scroll");
  pd.opener?.focus({ preventScroll: true });
}

function showProductPhoto(index) {
  const cake = findCake(pd.id);
  const items = galleryOf(cake);
  pd.photo = index;
  $("#pd-photo").innerHTML = photoHTML(items[index].base, `${cake.name}: ${items[index].label.toLowerCase()}`, cake.tint, false);
  $$("#pd-thumbs .pd__thumb").forEach((thumb, i) => thumb.setAttribute("aria-current", String(i === index)));
}

function renderProductPrice() {
  const cake = findCake(pd.id);
  $("#pd-price").textContent = money(cakePrice(cake, chosenWeight[cake.id]));
  $("#pd-price-note").textContent = cake.fixed
    ? `за торт ${cake.fixed.weight}`
    : `за ${kilos(chosenWeight[cake.id])} · ${money(cake.pricePerKg)}/кг`;
  $$("#pd-weights .weight[data-kg]").forEach((button) => {
    button.setAttribute("aria-checked", String(Number(button.dataset.kg) === chosenWeight[cake.id]));
  });
}

function renderProductTab() {
  const cake = findCake(pd.id);
  const panel = $("#pd-panel");
  $$("#pd-tabs .pd__tab").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.tab === pd.tab)));

  // Отзывы: честные заглушки, как в блоке на главной
  if (pd.tab === "reviews") {
    panel.innerHTML = `
      <h3>Отзывы о торте</h3>
      <article class="review">
        <div class="review__head"><span class="ph ph--avatar"></span><span class="ph ph--name"></span></div>
        <span class="ph ph--line"></span><span class="ph ph--line"></span><span class="ph ph--line ph--short"></span>
        <p class="review__note">Здесь будут ваши настоящие отзывы с 2ГИС и Фламп</p>
      </article>`;
    return;
  }

  const source = pd.tab === "about"
    ? { title: cake.about?.title || cake.name, paragraphs: cake.about?.paragraphs || [cake.desc] }
    : CONFIG.tabs.find((tab) => tab.id === pd.tab);

  // Заголовок и абзацы вставляем текстом, чтобы данные не могли принести разметку
  panel.innerHTML = "<h3></h3>" + source.paragraphs.map(() => "<p></p>").join("");
  $("h3", panel).textContent = source.title;
  $$("p", panel).forEach((p, i) => (p.textContent = source.paragraphs[i]));
}

function setupProduct() {
  $("#pd-close").addEventListener("click", closeProduct);

  // Фото открывает галерею на весь экран
  $("#pd-photo").addEventListener("click", () => openGallery(pd.id, $("#pd-photo"), pd.photo));

  $("#pd-thumbs").addEventListener("click", (event) => {
    const thumb = event.target.closest("[data-photo]");
    if (thumb) showProductPhoto(Number(thumb.dataset.photo));
  });

  // Вес меняем здесь — он же подставится в карточку каталога
  $("#pd-weights").addEventListener("click", (event) => {
    const button = event.target.closest(".weight[data-kg]");
    if (!button) return;
    chosenWeight[pd.id] = Number(button.dataset.kg);
    renderProductPrice();
    updateCardPrice(pd.id);
    onCardWeightChange();
  });

  $("#pd-tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (!tab || tab.dataset.tab === pd.tab) return;
    pd.tab = tab.dataset.tab;
    renderProductTab();
  });

  // «В корзину»: торт летит в корзину, страница остаётся открытой
  $("#pd-add").addEventListener("click", (event) => {
    const cake = findCake(pd.id);
    addToCart(pd.id, cake.fixed ? null : chosenWeight[pd.id]);
    flyToCart($(".media", $("#pd-photo")), (targetEl) => {
      updateCartUI();
      bump([[targetEl, "is-bump"], [isDesktop() ? $("#cart-badge") : $("#cart-bar-text"), "is-pop"]]);
    });
    const button = event.currentTarget;
    button.textContent = "✓ Добавлен";
    button.classList.add("is-added");
    clearTimeout(button.timer);
    button.timer = setTimeout(() => {
      button.textContent = "В корзину";
      button.classList.remove("is-added");
    }, 1400);
  });

  // «Купить в 1 клик»: кладём торт и сразу открываем оформление
  $("#pd-quick").addEventListener("click", () => {
    const cake = findCake(pd.id);
    addToCart(pd.id, cake.fixed ? null : chosenWeight[pd.id]);
    updateCartUI();
    closeProduct();
    openSheet();
  });
}

/* ===================== Фото-пример ===================== */

// Выбранное фото живёт только в браузере клиента: сайт без сервера не может его отправить
let refFile = null;

function setRefFile(file) {
  const img = $("#ref-img");
  if (img.src) URL.revokeObjectURL(img.src);
  refFile = file || null;
  if (refFile) {
    img.src = URL.createObjectURL(refFile);
    $("#ref-name").textContent = refFile.name;
  } else {
    img.removeAttribute("src");
    $("#f-ref").value = "";
  }
  $("#ref-preview").hidden = !refFile;
  $("#ref-pick").hidden = Boolean(refFile);
  updateWhatsAppLink();
}

/* ===================== Заказ и отслеживание ===================== */

const ORDER_KEY = "tortdv-last-order";

// Последний оформленный заказ: хранится в браузере, чтобы «Мой заказ» работал после перезагрузки
let order = loadOrder();

function loadOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY));
    return saved && Array.isArray(saved.lines) ? saved : null;
  } catch (e) {
    return null;
  }
}

function saveOrder() {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch (e) {
    /* без сохранения отслеживание работает до перезагрузки */
  }
}

// Статусы заказа. order.done — сколько из них уже пройдено
function orderSteps(o) {
  return [
    { name: "Заказ принят", note: `К ${prettyDate(o.date)}` },
    o.done > 1
      ? { name: "Предоплата получена", note: `${money(o.prepay)} по СБП` }
      : { name: "Предоплата 50%", note: `Ждём ${money(o.prepay)} — реквизиты пришлём в WhatsApp` },
    { name: "Готовим торт", note: "Кондитер приступает ближе к вашей дате" },
    o.delivery
      ? { name: "Передан курьеру", note: "Яндекс.Доставка везёт торт к вам" }
      : { name: "Готов к выдаче", note: `Можно забирать: ${CONFIG.address}` },
    { name: "Торт у вас", note: "Приятного праздника!" }
  ];
}

// Заголовок и подпись экрана — по тому, сколько шагов пройдено
function orderHeadline(o) {
  switch (o.done) {
    case 1: return ["Заказ принят", "Мы получили заказ. Осталось внести предоплату — напишем вам в WhatsApp."];
    case 2: return ["Заказ принят", "Предоплата получена. Приступим к торту ближе к вашей дате."];
    case 3: return ["Готовим ваш торт", "Кондитер уже работает над заказом."];
    case 4: return o.delivery
      ? ["Торт в пути", "Курьер Яндекс.Доставки везёт торт к вам."]
      : ["Торт готов", `Можно забирать: ${CONFIG.address}.`];
    default: return ["Торт у вас", "Спасибо, что выбрали «ТортДВ»!"];
  }
}

// Собираем заказ из корзины и формы. paid — предоплата внесена (в демо — по кнопке)
function acceptOrder(paid) {
  const address = $("#f-address").value.trim();
  order = {
    number: "ТД-" + String(Math.floor(1000 + Math.random() * 9000)),
    lines: cart.map((line) => {
      const cake = findCake(line.id);
      return { name: cake.name, weight: weightText(cake, line.weight), qty: line.qty, sum: lineSum(line) };
    }),
    total: cartTotal(),
    prepay: cartTotal() * CONFIG.prepay,
    date: $("#f-date").value,
    delivery: isDelivery(),
    receive: isDelivery() ? `Яндекс.Доставка${address ? ", " + address : ""}` : `Самовывоз, ${CONFIG.address}`,
    inscription: $("#f-text").value.trim(),
    comment: $("#f-comment").value.trim(),
    hasRef: Boolean(refFile),
    done: paid ? 2 : 1,
    review: null
  };
  saveOrder();

  // Корзина пуста, пожелания к этому торту больше не нужны (имя и телефон оставляем)
  cart = [];
  saveCart();
  updateCartUI();
  $("#f-text").value = "";
  $("#f-comment").value = "";
  setRefFile(null);

  $("#pay-modal").hidden = true;
  closeSheet();
  openTrack(true);
}

function renderTrack() {
  const steps = orderSteps(order);
  const finished = order.done >= steps.length;
  const [title, lead] = orderHeadline(order);

  $("#track-number").textContent = `Заказ № ${order.number}`;
  $("#track-title").textContent = title;
  $("#track-lead").textContent = lead;

  // Если список уже нарисован — меняем только классы и тексты, чтобы линия «заливалась» плавно
  const list = $("#track-steps");
  if (list.children.length !== steps.length) {
    list.innerHTML = steps.map(() => `
      <li class="track__step">
        <span class="track__dot" aria-hidden="true">✓</span>
        <b class="track__name"></b>
        <span class="track__note"></span>
      </li>`).join("");
  }
  [...list.children].forEach((item, i) => {
    item.classList.toggle("is-done", i < order.done);
    item.classList.toggle("is-current", i === order.done);
    $(".track__name", item).textContent = steps[i].name;
    $(".track__note", item).textContent = steps[i].note;
  });

  const row = (label, value, wrap) =>
    value ? `<p${wrap ? ' class="is-wrap"' : ""}><span>${label}</span><b></b></p>` : "";
  const summary = $("#track-summary");
  summary.innerHTML =
    "<ul>" + order.lines.map(() => "<li><span></span><b></b></li>").join("") + "</ul>" +
    row("Итого", true) + row("Предоплата 50%", true) + row("Дата", true) +
    row("Получение", true, true) + row("Надпись", order.inscription, true) + row("Комментарий", order.comment, true);

  // Тексты клиента вставляем через textContent — так в страницу не попадёт чужая разметка
  $$("li", summary).forEach((item, i) => {
    const line = order.lines[i];
    $("span", item).textContent = `${line.name}, ${line.weight}${line.qty > 1 ? " × " + line.qty : ""}`;
    $("b", item).textContent = money(line.sum);
  });
  const values = [money(order.total), money(order.prepay), prettyDate(order.date), order.receive, order.inscription, order.comment].filter(Boolean);
  $$("p b", summary).forEach((cell, i) => (cell.textContent = values[i]));

  $("#track-ref").hidden = !order.hasRef || order.done > 2;

  // Торт получен: просим отзыв и даём задать вопрос
  $("#after").hidden = !finished;
  $("#track-next").hidden = finished;
  $(".track__demo p").textContent = finished
    ? "Демо завершено: так клиент видит весь путь заказа."
    : "На рабочем сайте статус меняет кондитерская — клиент просто видит, где его торт.";
  if (finished) renderReview();
}

function renderReview() {
  const stars = order.review?.stars || 0;
  $$("#stars button").forEach((button) => {
    const on = Number(button.dataset.star) <= stars;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-checked", String(Number(button.dataset.star) === stars));
  });
  const sent = Boolean(order.review?.sent);
  $("#review-send").hidden = sent;
  $("#review-text").disabled = sent;
  if (sent) {
    $("#review-text").value = order.review.text || "";
    showReviewNote("Спасибо за отзыв! В демо он сохранён только на этом устройстве. На рабочем сайте его получит кондитерская.");
  }
}

function showReviewNote(text) {
  const note = $("#review-thanks");
  note.textContent = text;
  note.hidden = false;
}

function openTrack(celebrate) {
  if (!order) return;
  $("#review-thanks").hidden = true;
  $("#question-error").hidden = true;
  $("#review-text").value = "";
  renderTrack();
  $("#track").hidden = false;
  document.body.classList.add("no-scroll");
  $("#order-chip").hidden = false;
  $(".track__card").scrollTop = 0;
  $("#track-close").focus({ preventScroll: true });
  if (celebrate) sprinkle();
}

function closeTrack() {
  $("#track").hidden = true;
  document.body.classList.remove("no-scroll");
  $("#order-chip").focus({ preventScroll: true });
}

// Посыпка сыплется сверху карточки
function sprinkle() {
  const box = $("#sprinkles");
  if (reducedMotion.matches || !box.animate) return;
  const colors = ["#e8638c", "#f6b63c", "#63b99a", "#9b7fd1", "#cf7a8e", "#f3d3d9"];
  const fall = Math.min(box.clientHeight || 600, 620) + 40;
  for (let i = 0; i < 44; i++) {
    const bit = document.createElement("i");
    const turn = Math.random() * 360;
    bit.style.left = Math.random() * 100 + "%";
    bit.style.background = colors[i % colors.length];
    box.appendChild(bit);
    bit.animate(
      [
        { transform: `translateY(0) rotate(${turn}deg)`, opacity: 1 },
        { transform: `translateY(${fall * (0.6 + Math.random() * 0.4)}px) rotate(${turn + 360 + Math.random() * 360}deg)`, opacity: 0 }
      ],
      { duration: 1500 + Math.random() * 1500, delay: Math.random() * 600, easing: "cubic-bezier(.3,.6,.5,1)", fill: "backwards" }
    ).onfinish = () => bit.remove();
  }
}

function setupTrack() {
  $("#order-chip").hidden = !order;
  $("#order-chip").addEventListener("click", () => openTrack(false));
  $("#track-close").addEventListener("click", closeTrack);
  $("#track").addEventListener("click", (event) => {
    if (event.target.id === "track") closeTrack();
  });

  // Демо: двигаем заказ к следующему статусу
  $("#track-next").addEventListener("click", () => {
    const total = orderSteps(order).length;
    order.done = Math.min(order.done + 1, total);
    saveOrder();
    renderTrack();
    if (order.done === total) {
      sprinkle();
      $("#after").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
    }
  });

  // Звёзды
  $("#stars").addEventListener("click", (event) => {
    const button = event.target.closest("[data-star]");
    if (!button || order.review?.sent) return;
    order.review = { ...order.review, stars: Number(button.dataset.star) };
    renderReview();
    $("#review-thanks").hidden = true;
    bump([[button, "is-pop"]]);
  });

  // Отзыв: в демо сохраняется только в браузере
  $("#review-send").addEventListener("click", () => {
    if (!order.review?.stars) {
      showReviewNote("Поставьте оценку — от 1 до 5 звёзд.");
      return;
    }
    order.review = { ...order.review, text: $("#review-text").value.trim(), sent: true };
    saveOrder();
    renderReview();
  });

  // Вопрос по торту уходит в WhatsApp готовым текстом
  const updateQuestionLink = () => {
    const text = $("#question-text").value.trim();
    $("#question-send").href = text
      ? `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(`Вопрос по заказу № ${order.number}: ${text}`)}`
      : "#";
    if (text) $("#question-error").hidden = true;
  };
  $("#question-text").addEventListener("input", updateQuestionLink);
  $("#question-send").addEventListener("click", (event) => {
    updateQuestionLink();
    if ($("#question-text").value.trim()) return;
    event.preventDefault();
    $("#question-error").hidden = false;
  });
}

/* ===================== Появление блоков при прокрутке ===================== */


/* ===================== Галерея фото ===================== */

const gallery = { cake: null, items: [], index: 0, opener: null };

function openGallery(cakeId, opener, startIndex = 0) {
  const cake = findCake(cakeId);
  gallery.cake = cake;
  gallery.items = galleryOf(cake);
  gallery.opener = opener;

  $("#lb-title").textContent = cake.name;
  $("#lb-thumbs").innerHTML = gallery.items.map((item, i) => `
    <button class="lb__thumb" type="button" data-index="${i}" aria-label="${item.label}">
      ${photoHTML(item.base, "", cake.tint)}
      ${item.label}
    </button>`).join("");

  $("#lightbox").hidden = false;
  document.body.classList.add("no-scroll");
  showSlide(startIndex);
  $("#lb-close").focus({ preventScroll: true });
}

function closeGallery() {
  $("#lightbox").hidden = true;
  // Под галереей может быть открыта панель заказа или страница торта — тогда прокрутку не возвращаем
  if (!document.body.classList.contains("sheet-open") && $("#pd").hidden) {
    document.body.classList.remove("no-scroll");
  }
  gallery.opener?.focus({ preventScroll: true });
}

// Показать фото номер index; dir — откуда «въезжает» новое (для свайпа и стрелок)
function showSlide(index, dir = 0) {
  const count = gallery.items.length;
  gallery.index = (index + count) % count; // по кругу
  const item = gallery.items[gallery.index];
  const frame = $("#lb-frame");

  frame.innerHTML = photoHTML(item.base, `${gallery.cake.name}: ${item.label.toLowerCase()}`, gallery.cake.tint, false);
  if (dir && !reducedMotion.matches && frame.animate) {
    frame.animate(
      [{ opacity: 0, transform: `translateX(${dir * 40}px)` }, { opacity: 1, transform: "none" }],
      { duration: 380, easing: "cubic-bezier(.22,.8,.26,1)" }
    );
  }

  $("#lb-label").textContent = item.label;
  $("#lb-count").textContent = `${gallery.index + 1} из ${count}`;
  $$(".lb__thumb").forEach((thumb, i) => {
    const current = i === gallery.index;
    thumb.setAttribute("aria-current", String(current));
    if (current) thumb.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  });
}

function setupGallery() {
  $("#lb-close").addEventListener("click", closeGallery);
  $("#lb-prev").addEventListener("click", () => showSlide(gallery.index - 1, -1));
  $("#lb-next").addEventListener("click", () => showSlide(gallery.index + 1, 1));

  $("#lb-thumbs").addEventListener("click", (event) => {
    const thumb = event.target.closest("[data-index]");
    if (!thumb) return;
    const index = Number(thumb.dataset.index);
    if (index !== gallery.index) showSlide(index, index > gallery.index ? 1 : -1);
  });

  // Свайп пальцем влево-вправо
  let startX = null;
  let startY = null;
  let swiped = false;

  // Нажали на тёмный фон вокруг фото — закрываем (но не после свайпа)
  $("#lb-stage").addEventListener("click", (event) => {
    if (swiped) {
      swiped = false;
      return;
    }
    if (event.target.id === "lb-stage") closeGallery();
  });
  $("#lb-stage").addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    startY = event.clientY;
    swiped = false;
  });
  $("#lb-stage").addEventListener("pointerup", (event) => {
    if (startX === null) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    startX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      swiped = true;
      showSlide(gallery.index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    }
  });

  // Стрелки на клавиатуре
  document.addEventListener("keydown", (event) => {
    if ($("#lightbox").hidden) return;
    if (event.key === "ArrowRight") showSlide(gallery.index + 1, 1);
    if (event.key === "ArrowLeft") showSlide(gallery.index - 1, -1);
  });
}

/* ===================== Запуск ===================== */

document.documentElement.classList.add("js");

document.addEventListener("DOMContentLoaded", () => {
  renderFilters();
  renderCatalog();
  $("#hero-photos").innerHTML = CAKES.slice(0, 3).map((cake) => `
    <button class="hero__photo" type="button" data-cake="${cake.id}">
      ${mediaHTML(cake, false)}
      <span>${cake.name}</span>
    </button>`).join("");
  $("#hero-photos").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cake]");
    if (button) openProduct(button.dataset.cake, button);
  });

  // Шапка: «Позвонить» и «WhatsApp» — номера из data.js
  $("#head-call").href = `tel:${CONFIG.phone.replace(/[^\d+]/g, "")}`;
  $("#head-wa").href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Здравствуйте! Хочу заказать торт.")}`;
  setupPriceFilter();
  updateCartUI();
  // Телефон в подвале — тоже из data.js
  $("#footer-tel").textContent = CONFIG.phone;
  $("#footer-tel").href = `tel:${CONFIG.phone.replace(/[^\d+]/g, "")}`;
  $("#footer-wa").href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Здравствуйте! Хочу заказать торт.")}`;
  $("#qr").innerHTML = fakeQR();

  // Календарь: не раньше чем через 7 дней
  const dateInput = $("#f-date");
  dateInput.min = dateFromToday(CONFIG.minDays);
  dateInput.value = dateInput.min;
  setupGallery();
  setupTrack();
  setupProduct();

  // Фото-пример: выбрать и убрать
  $("#f-ref").addEventListener("change", (event) => setRefFile(event.target.files[0]));
  $("#ref-remove").addEventListener("click", () => setRefFile(null));

  // Плашки по поводу над каталогом
  $("#filters").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-filter]");
    if (chip) toggleTag(chip.dataset.filter);
  });

  // «Сбросить всё» на строке над каталогом
  $("#filter-clear").addEventListener("click", resetFilters);

  // Фильтры: открыть панель (телефон), показать, сбросить
  $("#filter-open").addEventListener("click", openFilters);
  $("#filter-close").addEventListener("click", closeFilters);
  $("#filter-overlay").addEventListener("click", closeFilters);
  $("#filter-apply").addEventListener("click", () => {
    closeFilters();
    $("#cakes").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth" });
  });
  $("#filter-reset").addEventListener("click", resetFilters);
  $("#empty-reset").addEventListener("click", resetFilters);

  // Карточки: выбор веса и «В корзину»
  $("#catalog").addEventListener("click", (event) => {
    const card = event.target.closest(".card");
    if (!card) return;
    const id = card.dataset.id;

    // Нажали на фото — открываем галерею
    const zoomBtn = event.target.closest("[data-zoom]");
    if (zoomBtn) {
      openGallery(id, zoomBtn);
      return;
    }

    const weightBtn = event.target.closest(".weight");
    if (weightBtn) {
      chosenWeight[id] = Number(weightBtn.dataset.kg);
      updateCardPrice(id);
      onCardWeightChange();
      return;
    }

    const addBtn = event.target.closest("[data-add]");
    // Нажали на карточку мимо кнопок — открываем страницу торта
    if (!addBtn) {
      openProduct(id, card);
      return;
    }

    // У торта с фиксированной ценой веса нет — храним null
    addToCart(id, findCake(id).fixed ? null : chosenWeight[id]);
    flyToCart($(".media", card), (targetEl) => {
      updateCartUI();
      if (isDesktop()) bump([[targetEl, "is-bump"], [$("#cart-badge"), "is-pop"]]);
      else bump([[targetEl, "is-bump"], [$("#cart-bar-text"), "is-pop"]]);
    });

    // Кнопка на секунду показывает, что торт добавлен
    addBtn.textContent = "✓ Добавлен";
    addBtn.classList.add("is-added");
    clearTimeout(addBtn.timer);
    addBtn.timer = setTimeout(() => {
      addBtn.textContent = "В корзину";
      addBtn.classList.remove("is-added");
    }, 1400);
  });

  // Открыть и закрыть панель оформления
  $("#cart-bar").addEventListener("click", openSheet);
  $("#cart-icon").addEventListener("click", openSheet);
  $("#sheet-close").addEventListener("click", closeSheet);
  $("#overlay").addEventListener("click", closeSheet);

  // Количество в составе заказа
  $("#lines").addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const line = cart[Number(button.closest(".line").dataset.index)];
    line.qty += button.dataset.act === "plus" ? 1 : -1;
    cart = cart.filter((item) => item.qty > 0);
    saveCart();
    renderSheet();
    updateCartUI();
  });

  // Самовывоз / Яндекс.Доставка
  $("#order-form").addEventListener("change", () => {
    $("#address-field").hidden = !isDelivery();
    $("#delivery-hint").textContent = isDelivery()
      ? "Курьер Яндекс.Доставки, оплачивается отдельно по тарифу"
      : CONFIG.address;
    updateWhatsAppLink();
  });
  $("#order-form").addEventListener("input", (event) => {
    event.target.classList.remove("is-invalid");
    updateWhatsAppLink();
  });
  $("#order-form").addEventListener("submit", (event) => event.preventDefault());

  // Оплата по СБП (демо)
  $("#pay-btn").addEventListener("click", () => {
    const problems = orderProblems();
    if (problems.length) return showProblems(problems);
    hideError();
    openPay();
  });
  $("#pay-close").addEventListener("click", closePay);
  $("#pay-modal").addEventListener("click", (event) => {
    if (event.target.id === "pay-modal") closePay();
  });

  // Демо-оплата прошла: заказ принят, предоплата получена
  $("#pay-done").addEventListener("click", () => acceptOrder(true));

  // WhatsApp: если данных не хватает — подсказываем, а не открываем пустой чат.
  // Если всё в порядке — чат открывается в новой вкладке, а здесь показываем «Заказ принят»
  $("#wa-btn").addEventListener("click", (event) => {
    const problems = orderProblems();
    if (problems.length) {
      event.preventDefault();
      showProblems(problems);
      return;
    }
    setTimeout(() => acceptOrder(false), 400);
  });

  // Escape закрывает сначала галерею, окно оплаты или экран заказа, потом панели
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#lightbox").hidden) closeGallery();
    else if (!$("#track").hidden) closeTrack();
    else if (!$("#pay-modal").hidden) closePay();
    else if (!$("#pd").hidden && !document.body.classList.contains("sheet-open")) closeProduct();
    else if (document.body.classList.contains("sheet-open")) closeSheet();
    else closeFilters();
  });
});
