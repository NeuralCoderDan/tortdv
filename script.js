// Логика сайта: каталог, фильтры, выбор веса, калькулятор и заказ через WhatsApp.

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
        <div class="card__foot">
          <p class="card__cost"><span class="card__price"></span><span class="card__per"></span></p>
          <button class="btn btn--primary" type="button" data-order="${cake.id}">Заказать</button>
        </div>
      </div>
    </article>`).join("");

  // «Заказать»: свой обработчик на каждой кнопке. Какой торт — берём из data-order
  $$("#catalog [data-order]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation(); // нажатие на кнопку не открывает страницу торта
      openOrder(button.dataset.order, button);
    });
  });

  // 3D-наклон: карточка поворачивается за курсором, максимум на 8° в каждую сторону.
  // На телефонах и планшетах (нет мыши) и при отключённых анимациях эффект не работает
  const canTilt = window.matchMedia("(hover: hover) and (pointer: fine)");
  $$("#catalog .card").forEach((card) => {
    card.addEventListener("mousemove", (event) => {
      if (!canTilt.matches || reducedMotion.matches) return;
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;  // −0.5 слева … 0.5 справа
      const y = (event.clientY - rect.top) / rect.height - 0.5;  // −0.5 сверху … 0.5 снизу
      const rx = Math.max(-8, Math.min(8, -y * 16));
      const ry = Math.max(-8, Math.min(8, x * 16));
      card.style.transform =
        `perspective(1000px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(1.02)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = ""; // плавно возвращается на место
    });
  });

  CAKES.forEach((cake) => updateCardPrice(cake.id));
}

function updateCardPrice(id) {
  const card = $(`.card[data-id="${id}"]`);
  const cake = findCake(id);
  setOdometer($(".card__price", card), cakePrice(cake, chosenWeight[id]));
  // Рядом с ценой — за какой вес она посчитана
  $(".card__per", card).textContent = cake.fixed ? cake.fixed.weight : `за ${kilos(chosenWeight[id])}`;
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

  // Переставляем карточки в нужном порядке — FLIP доведёт их до новых мест плавно.
  // Трогаем только те, что стоят не на своём месте: если перевставить карточку в страницу,
  // браузер оборвёт её анимации (цифры цены перескочат без прокрутки)
  const catalog = $("#catalog");
  sortedCakeIds().forEach((id, i) => {
    const card = $(`.card[data-id="${id}"]`);
    if (catalog.children[i] !== card) catalog.insertBefore(card, catalog.children[i] || null);
  });

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

/* ===================== Заказ: окно с формой → WhatsApp ===================== */

// Что сейчас в окне заказа
const orderNow = { id: null, opener: null };

function orderWeight(cake) {
  return cake.fixed ? null : chosenWeight[cake.id];
}

// Цена и предоплата в окне — пересчитываются при смене веса
function renderOrderPrice() {
  const cake = findCake(orderNow.id);
  const total = cakePrice(cake, orderWeight(cake));
  $("#order-price").textContent = `Итого: ${money(total)}`;
  $("#order-prepay").textContent = `Предоплата ${Math.round(CONFIG.prepay * 100)}%: ${money(total * CONFIG.prepay)}`;
  $$("#order-weights .weight[data-kg]").forEach((button) => {
    button.setAttribute("aria-checked", String(Number(button.dataset.kg) === chosenWeight[cake.id]));
  });
  updateOrderLink();
}

function openOrder(cakeId, opener) {
  const cake = findCake(cakeId);
  orderNow.id = cakeId;
  orderNow.opener = opener;

  // Фото и название — только для чтения
  $("#order-photo").innerHTML = mediaHTML(cake, false);
  $("#order-title").textContent = cake.name;

  // Вес: 1,5 / 2 / 2,5 / 3 кг; у бенто — его фиксированный вес
  $("#order-weights").innerHTML = cake.fixed
    ? `<span class="weight weight--fixed">${cake.fixed.weight}</span>`
    : CONFIG.weights.map((kg) => `
        <button class="weight" type="button" role="radio" data-kg="${kg}">${kilos(kg)}</button>`).join("");
  $("#order-weights").setAttribute("role", cake.fixed ? "presentation" : "radiogroup");
  renderOrderPrice();
  $("#order-error").hidden = true;
  $$("#order-form .is-invalid").forEach((field) => field.classList.toggle("is-invalid", false));

  $("#order-modal").hidden = false;
  document.body.classList.add("no-scroll");
  $("#o-name").focus({ preventScroll: true });
}

function closeOrder() {
  $("#order-modal").hidden = true;
  if ($("#pd").hidden) document.body.classList.toggle("no-scroll", false);
  orderNow.opener?.focus({ preventScroll: true });
}

// Чего не хватает в форме. Пусто — можно отправлять
function orderProblems() {
  const problems = [];
  const name = $("#o-name");
  const date = $("#o-date");
  if (!name.value.trim()) problems.push([name, "Напишите имя"]);
  if (!date.value) problems.push([date, "Выберите дату"]);
  else if (date.value < date.min) problems.push([date, `Дата — не раньше ${prettyDate(date.min)}`]);
  return problems;
}

// Текст для WhatsApp — ровно в том виде, в каком его увидит кондитер
function orderText() {
  const cake = findCake(orderNow.id);
  const total = cakePrice(cake, orderWeight(cake));
  const weight = cake.fixed ? cake.fixed.weight : `${String(orderWeight(cake)).replace(".", ",")} кг`;
  return [
    "Здравствуйте! Хочу заказать торт.",
    `Торт: ${cake.name}`,
    `Вес: ${weight}`,
    `Дата: ${prettyDate($("#o-date").value)}`,
    `Имя: ${$("#o-name").value.trim()}`,
    `Стоимость: ${money(total)}`,
    `Предоплата ${Math.round(CONFIG.prepay * 100)}%: ${money(total * CONFIG.prepay)}`
  ].join("\n");
}

function updateOrderLink() {
  $("#order-send").href = orderProblems().length
    ? "#"
    : `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(orderText())}`;
}

function setupOrder() {
  // Дата: не раньше чем через CONFIG.minDays дней
  const date = $("#o-date");
  date.min = dateFromToday(CONFIG.minDays);
  date.value = date.min;
  $("#o-date-hint").textContent = `Не раньше чем через ${CONFIG.minDays} дней`;

  $("#order-form").addEventListener("input", (event) => {
    event.target.classList.toggle("is-invalid", false);
    $("#order-error").hidden = true;
    updateOrderLink();
  });
  $("#order-form").addEventListener("submit", (event) => event.preventDefault());

  // Не хватает имени или даты — подсказываем, а не открываем пустой чат
  $("#order-send").addEventListener("click", (event) => {
    const problems = orderProblems();
    if (!problems.length) return; // ссылка готова — WhatsApp откроется в новой вкладке
    event.preventDefault();
    problems.forEach(([field]) => field.classList.add("is-invalid"));
    $("#order-error").textContent = problems.map(([, text]) => text).join(". ") + ".";
    $("#order-error").hidden = false;
    problems[0][0].focus();
  });

  // Вес в окне: тот же вес встаёт на карточку и на страницу торта
  $("#order-weights").addEventListener("click", (event) => {
    const button = event.target.closest(".weight[data-kg]");
    if (!button) return;
    chosenWeight[orderNow.id] = Number(button.dataset.kg);
    updateCardPrice(orderNow.id);
    onCardWeightChange();
    if (!$("#pd").hidden) renderProductPrice();
    renderOrderPrice();
  });

  $("#order-close").addEventListener("click", closeOrder);
  $("#order-modal").addEventListener("click", (event) => {
    if (event.target.id === "order-modal") closeOrder();
  });

  // Липкая кнопка на телефоне: «Заказать торт» — прокрутка к тортам
  const bar = $("#order-bar");
  bar.addEventListener("click", () => {
    $("#cakes").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth" });
  });

  // Липкая кнопка прячется, пока на экране торты (иначе она закрывает кнопку «Заказать»
  // на карточке внизу экрана) или первый экран (там уже есть своя кнопка «Выбрать торт»)
  if ("IntersectionObserver" in window) {
    const onScreen = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) onScreen.add(entry.target);
        else onScreen.delete(entry.target);
      });
      bar.classList.toggle("is-hidden", onScreen.size > 0);
      bar.tabIndex = onScreen.size > 0 ? -1 : 0;
    });
    [$("#cakes"), $(".hero")].forEach((block) => observer.observe(block));
  } else {
    bar.classList.remove("is-hidden"); // старый браузер: кнопка просто видна всегда
  }
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
  document.body.classList.toggle("no-scroll", false);
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

  // «Заказать»: окно заказа поверх страницы торта
  $("#pd-add").addEventListener("click", (event) => openOrder(pd.id, event.currentTarget));
}

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
  // Под галереей может быть открыта страница торта — тогда прокрутку не возвращаем
  if ($("#pd").hidden) {
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

// Секции появляются при прокрутке: изначально прозрачные и сдвинуты вниз (см. style.css),
// когда секция входит в экран — получает класс is-visible и плавно приезжает на место
function setupSectionReveal() {
  const sections = $$(".section");
  if (!("IntersectionObserver" in window)) {
    sections.forEach((section) => section.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target); // появляется один раз
    });
  }, { rootMargin: "0px 0px -10% 0px" });
  sections.forEach((section) => observer.observe(section));
}

document.addEventListener("DOMContentLoaded", () => {
  renderFilters();
  renderCatalog();
  setupSectionReveal();

  // Высота шапки — в CSS: первый экран занимает всё окно под шапкой (см. .hero в style.css)
  const setHeaderHeight = () => {
    document.documentElement.style.setProperty("--header-h", `${$(".header").offsetHeight}px`);
  };
  setHeaderHeight();
  window.addEventListener("resize", setHeaderHeight);

  // Шапка: «Позвонить» и «WhatsApp» — номера из data.js
  $("#head-call").href = `tel:${CONFIG.phone.replace(/[^\d+]/g, "")}`;
  $("#head-wa").href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Здравствуйте! Хочу заказать торт.")}`;
  setupPriceFilter();
  setupOrder();
  // Телефон в подвале — тоже из data.js
  $("#footer-tel").textContent = CONFIG.phone;
  $("#footer-tel").href = `tel:${CONFIG.phone.replace(/[^\d+]/g, "")}`;
  $("#footer-wa").href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Здравствуйте! Хочу заказать торт.")}`;
  setupGallery();
  setupProduct();

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

  // Карточки: фото — галерея, остальное — страница торта.
  // У кнопок «Заказать» свой обработчик — он навешивается в renderCatalog
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

    // Нажали на карточку мимо кнопок — открываем страницу торта
    if (!event.target.closest("[data-order]")) openProduct(id, card);
  });

  // Escape закрывает сначала галерею, потом окно заказа, страницу торта, фильтры
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#lightbox").hidden) closeGallery();
    else if (!$("#order-modal").hidden) closeOrder();
    else if (!$("#pd").hidden) closeProduct();
    else closeFilters();
  });
});
