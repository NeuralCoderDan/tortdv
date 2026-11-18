// Логика сайта: каталог, фильтры, выбор веса, калькулятор и заказ через WhatsApp.

/* ===================== Вспомогательное ===================== */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const findCake = (id) => CAKES.find((cake) => cake.id === id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Текст из data.js перед вставкой в HTML: & < > " ' становятся безопасными.
// Иначе название вроде «Торт <Мечта>» или кавычка в описании сломали бы страницу
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[ch]);

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
// Заглушка одна для обоих случаев: фото ещё нет или файл не загрузился
const PHOTO_SOON = `<div class="media__ph">${PH_ICON}<small>Фото скоро будет</small></div>`;

function photoHTML(src, alt, tint, lazy = true) {
  if (!src) {
    return `
    <div class="media no-photo" style="--tint:${escapeHtml(tint)}">${PHOTO_SOON}</div>`;
  }
  return `
    <div class="media" style="--tint:${escapeHtml(tint)}">
      <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" ${lazy ? 'loading="lazy"' : ""}
           onerror="this.parentNode.classList.add('no-photo')">
      ${PHOTO_SOON}
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

// Один расчёт для всего сайта: 150 г торта на человека, дробная порция не считается.
// 1,5 кг → 10, 2 кг → 13, 2,5 кг → 16, 3 кг → 20, 750 г → 5
const GRAMS_PER_GUEST = 150;
const portions = (kg) => Math.floor((kg * 1000) / GRAMS_PER_GUEST);

// Подсказка в фильтре: на сколько гостей хватит торта выбранного веса
function guestsText(kg) {
  const n = portions(kg);
  return `≈ ${n} ${plural(n, "гость", "гостя", "гостей")}`;
}

function renderFilters() {
  // Показываем только поводы, под которые есть хотя бы один торт
  const shown = FILTERS.filter((filter) => filter.id === "all" || CAKES.some((cake) => cake.tags.includes(filter.id)));

  // Плашки по поводу наверху: быстрый доступ, можно выбрать несколько
  $("#filters").innerHTML = shown.map(
    (filter) =>
      `<button class="chip" type="button" data-filter="${escapeHtml(filter.id)}" aria-pressed="${isTagOn(filter.id)}">${escapeHtml(filter.label)}</button>`
  ).join("");

  // Те же поводы в панели фильтров
  $("#filter-tags").innerHTML = shown.filter((filter) => filter.id !== "all")
    .map((filter) => `
      <button class="tag-pick" type="button" data-filter="${escapeHtml(filter.id)}" aria-pressed="${isTagOn(filter.id)}">
        <span class="tag-pick__box" aria-hidden="true"></span>${escapeHtml(filter.label)}
      </button>`).join("");

  $("#filter-sort").innerHTML = SORTS
    .map((sort) => `<option value="${escapeHtml(sort.id)}">${escapeHtml(sort.label)}</option>`)
    .join("");
}

/* ===================== Полёт торта в корзину ===================== */

// Круглая копия фото (80 px) летит по дуге от места «from» (прямоугольник фото в окне заказа)
// к значку корзины в шапке, по пути уменьшается до 20 px и делает оборот.
// В конце значок корзины слегка подпрыгивает. Вызывается, когда торт уже лежит в корзине
function flyCake(cakeId, from) {
  const target = $("#cart-btn");
  const to = target.getBoundingClientRect();
  const SIZE = 80;
  const EASE = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";

  // Обёртка едет по горизонтали равномерно, фото внутри — по вертикали с замедлением.
  // Два разных темпа и складываются в плавную дугу
  const flyer = document.createElement("div");
  flyer.className = "cake-flyer";
  flyer.style.left = `${from.left + from.width / 2 - SIZE / 2}px`;
  flyer.style.top = `${from.top + from.height / 2 - SIZE / 2}px`;
  const img = document.createElement("img");
  img.src = findCake(cakeId).photo;
  img.alt = "";
  flyer.appendChild(img);
  document.body.appendChild(flyer);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  void flyer.offsetWidth; // фиксируем старт, чтобы переход сработал
  flyer.style.transition = "transform 0.7s linear";
  img.style.transition = `transform 0.7s ${EASE}, opacity 0.7s ${EASE}`;
  flyer.style.transform = `translateX(${dx}px)`;
  img.style.transform = `translateY(${dy}px) scale(0.25) rotate(360deg)`; // 80 px → 20 px
  img.style.opacity = "0.85";

  let done = false;
  const land = () => {
    if (done) return;
    done = true;
    flyer.remove();
    // Цель «прыгает»: 1 → 1.3 → 1
    target.animate?.(
      [{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }],
      { duration: 350, easing: "ease-out" }
    );
  };
  img.addEventListener("transitionend", land, { once: true });
  setTimeout(land, 900); // страховка, если transitionend не придёт
}

function renderCatalog() {
  $("#catalog").innerHTML = CAKES.map((cake) => `
    <article class="card" data-id="${escapeHtml(cake.id)}">
      <button class="card__zoom" type="button" data-zoom aria-label="Смотреть все фото торта «${escapeHtml(cake.name)}»">
        ${mediaHTML(cake)}
        <span class="zoom-hint" aria-hidden="true">
          <svg viewBox="0 0 12 12"><path d="M7 1h4v4M5 11H1V7M11 1 7 5M1 11l4-4"/></svg>${CONFIG.galleryLabels.length} фото
        </span>
        ${spinBadge(cake)}
      </button>
      <div class="card__body">
        <h3 class="card__name" title="${escapeHtml(cake.name)}"><span>${escapeHtml(cake.name)}</span></h3>
        <p class="card__desc">${escapeHtml(cake.desc)}</p>
        <div class="card__foot">
          <p class="card__rate">
            <button class="rate-chip" type="button" data-rate="${escapeHtml(cake.id)}">
              <span aria-hidden="true">⭐</span><b class="rate-chip__score"></b>
            </button>
            <button class="rate-chip" type="button" data-rate="${escapeHtml(cake.id)}">
              <span aria-hidden="true">💬</span><b class="rate-chip__count"></b>
            </button>
          </p>
          <p class="card__cost"><span class="card__price"></span><span class="card__per"></span></p>
          <button class="btn btn--primary" type="button" data-order="${escapeHtml(cake.id)}">Заказать</button>
        </div>
      </div>
    </article>`).join("");

  // «Заказать»: свой обработчик на каждой кнопке. Какой торт — берём из data-order.
  // Сразу открывается окно заказа: данные, предоплата, «Отправить в WhatsApp» или «В корзину»
  $$("#catalog [data-order]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation(); // нажатие на кнопку не открывает страницу торта
      openOrder(button.dataset.order, button);
    });
  });

  // ⭐ и 💬 на карточке открывают окно оценки
  $$("#catalog [data-rate]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation(); // не открываем заодно страницу торта
      openRate(button.dataset.rate, button);
    });
  });

  // 3D-наклон: карточка поворачивается за курсором, максимум на 8° в каждую сторону.
  // На телефонах и планшетах (нет мыши) и при отключённых анимациях эффект не работает
  const canTilt = window.matchMedia("(hover: hover) and (pointer: fine)");
  $$("#catalog .card").forEach((card) => {
    card.addEventListener("mousemove", (event) => {
      if (!canTilt.matches || reducedMotion.matches) return;
      // Над кнопками карточку не наклоняем: иначе кнопка уезжает из-под курсора
      if (event.target.closest("[data-order], [data-rate], .spin")) {
        card.style.transform = "";
        return;
      }
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

    // Телефон: карточка наклоняется в сторону пальца, отпустили — плавно возвращается.
    // На кнопках не наклоняем: кнопка не должна уезжать из-под пальца.
    // Палец поехал (человек листает страницу) — сразу возвращаем, это не нажатие
    let touchStart = null;
    const release = () => {
      touchStart = null;
      card.style.transition = "transform 0.4s ease";
      card.style.transform = "";
    };
    card.addEventListener("touchstart", (event) => {
      if (!isTouchFx() || event.touches.length > 1) return;
      if (event.target.closest("[data-order], [data-rate], .spin")) return;
      const touch = event.touches[0];
      const rect = card.getBoundingClientRect();
      const x = (touch.clientX - rect.left) / rect.width - 0.5;  // −0.5 … 0.5
      const y = (touch.clientY - rect.top) / rect.height - 0.5;
      const rx = Math.max(-8, Math.min(8, -y * 16));
      const ry = Math.max(-8, Math.min(8, x * 16));
      touchStart = { x: touch.clientX, y: touch.clientY };
      card.style.transition = "transform 0.15s ease-out";
      card.style.transform = `perspective(1000px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    }, { passive: true });
    card.addEventListener("touchmove", (event) => {
      if (!touchStart) return;
      const touch = event.touches[0];
      if (Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > 10) release();
    }, { passive: true });
    card.addEventListener("touchend", () => touchStart && release(), { passive: true });
    card.addEventListener("touchcancel", () => touchStart && release(), { passive: true });
  });

  CAKES.forEach((cake) => {
    updateCardPrice(cake.id);
    renderCardRating(cake.id);
  });
  setupCardSpins();
}

// Значок вращения на фото карточки: у примера (3D-модель или чужие кадры) — «Пример 360°»
function spinBadge(cake) {
  if (cake.model || cake.spin?.demo) return '<span class="spin-badge">Пример 360°</span>';
  if (cake.spin) return '<span class="spin-badge">360°</span>';
  return "";
}

// Вращение на карточке: только для настоящих кадров торта (у примера — только в галерее).
// Когда карточка показалась на экране — грузим первый кадр, остальные 35 — при первом касании.
// В режиме 3–4 карточки в ряд вращение выключено: нажатие открывает галерею, там торт и крутится
function setupCardSpins() {
  if (!window.TortSpin) return;
  const spinCards = $$("#catalog .card").filter((card) => {
    const cake = findCake(card.dataset.id);
    return cake.spin && !cake.spin.demo;
  });
  if (!spinCards.length) return;
  const small = () => {
    const catalog = $("#catalog");
    return window.matchMedia("(max-width: 639px)").matches
      && (catalog.classList.contains("cols-3") || catalog.classList.contains("cols-4"));
  };
  const mount = (card) => {
    const cake = findCake(card.dataset.id);
    const media = $(".media", card);
    media.classList.add("has-spin");
    new TortSpin.Viewer(media, cake.spin, {
      alt: `Торт «${cake.name}» на 360°: крутите влево и вправо`,
      enabled: () => !small()
    });
  };
  if (!("IntersectionObserver" in window)) return spinCards.forEach(mount);
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      mount(entry.target);
    });
  }, { rootMargin: "200px 0px" });
  spinCards.forEach((card) => observer.observe(card));
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

/* ===================== Оценки и комментарии ===================== */

// Оценки лежат в этом браузере: { cake1: [{ score, name, text, at }], ... }
const RATINGS_KEY = "tortdv-ratings";

function loadRatings() {
  try {
    return JSON.parse(localStorage.getItem(RATINGS_KEY)) || {};
  } catch {
    return {}; // в приватном режиме хранилище может быть недоступно
  }
}

function saveRatings(all) {
  try {
    localStorage.setItem(RATINGS_KEY, JSON.stringify(all));
  } catch {
    /* не сохранилось — не страшно, оценка просто не переживёт перезагрузку */
  }
}

const myRatings = (cakeId) => loadRatings()[cakeId] || [];

// Средняя оценка = стартовые цифры из data.js плюс голоса из этого браузера
function cakeScore(cake) {
  const mine = myRatings(cake.id);
  const count = (cake.ratingsCount || 0) + mine.length;
  if (!count) return { average: null, count: 0 };
  const sum = (cake.rating || 0) * (cake.ratingsCount || 0)
    + mine.reduce((total, vote) => total + vote.score, 0);
  return { average: sum / count, count };
}

function renderCardRating(id) {
  const card = $(`.card[data-id="${id}"]`);
  if (!card) return;
  const { average, count } = cakeScore(findCake(id));
  $(".rate-chip__score", card).textContent = average === null ? "—" : average.toFixed(1).replace(".", ",");
  $(".rate-chip__count", card).textContent = count;
  $$("[data-rate]", card).forEach((button) => {
    button.setAttribute("aria-label", count
      ? `Оценка ${average.toFixed(1).replace(".", ",")} из 10, ${count} ${plural(count, "оценка", "оценки", "оценок")}. Оценить торт`
      : "Оценить торт");
  });
}

// Что сейчас в окне оценки
const rateNow = { id: null, score: 0, opener: null };

function renderRateDots() {
  $$("#rate-dots [data-score]").forEach((dot) => {
    dot.setAttribute("aria-checked", String(Number(dot.dataset.score) === rateNow.score));
  });
}

// Последние три комментария. Текст ставим через textContent — чужая разметка не выполнится
function renderRateComments() {
  const withText = myRatings(rateNow.id).filter((vote) => vote.text).slice(-3).reverse();
  $("#rate-comments").hidden = withText.length === 0;
  const list = $("#rate-comments-list");
  list.innerHTML = withText.map(() => `
    <li class="rate__comment">
      <b class="rate__comment-head"></b>
      <span class="rate__comment-text"></span>
    </li>`).join("");
  $$("#rate-comments-list .rate__comment").forEach((item, i) => {
    const vote = withText[i];
    $(".rate__comment-head", item).textContent = `${vote.name || "Гость"} · ${vote.score}/10`;
    $(".rate__comment-text", item).textContent = vote.text;
  });
}

function openRate(cakeId, opener) {
  const cake = findCake(cakeId);
  rateNow.id = cakeId;
  rateNow.score = 0;
  rateNow.opener = opener;

  $("#rate-cake").textContent = cake.name;
  $("#rate-dots").innerHTML = Array.from({ length: 10 }, (_, i) => `
    <button class="rate-dot" type="button" role="radio" data-score="${i + 1}"
            aria-checked="false" aria-label="Оценка ${i + 1} из 10">${i + 1}</button>`).join("");
  renderRateDots();
  renderRateComments();

  // Честная подпись: оценки никуда не уходят и стартовые цифры придуманы
  const note = $("#rate-note");
  note.hidden = !RATINGS_ARE_DEMO;
  if (RATINGS_ARE_DEMO) {
    note.textContent = "Оценка сохранится только в этом браузере и к кондитеру не попадёт. "
      + "Нынешние цифры — для примера.";
  }

  $("#rate-error").hidden = true;
  $("#r-name").classList.remove("is-invalid");
  $("#rate-thanks").hidden = true;
  $("#rate-form").hidden = false;
  $("#rate-modal").hidden = false;
  document.body.classList.add("no-scroll");
  $("#rate-close").focus({ preventScroll: true });
}

function closeRate() {
  $("#rate-modal").hidden = true;
  if ($("#pd").hidden && $("#order-modal").hidden && $("#cart-modal").hidden) {
    document.body.classList.toggle("no-scroll", false);
  }
  rateNow.opener?.focus({ preventScroll: true });
}

function sendRating() {
  // Нужны оценка и имя — как в заказе, ошибка одинаковая: «Напишите имя»
  const name = $("#r-name");
  const problems = [];
  if (!rateNow.score) problems.push("Поставьте оценку от 1 до 10");
  if (!name.value.trim()) {
    problems.push("Напишите имя");
    name.classList.add("is-invalid");
  }
  if (problems.length) {
    $("#rate-error").textContent = problems.join(". ") + ".";
    $("#rate-error").hidden = false;
    if (!name.value.trim() && rateNow.score) name.focus();
    return;
  }
  const all = loadRatings();
  all[rateNow.id] = [...(all[rateNow.id] || []), {
    score: rateNow.score,
    name: $("#r-name").value.trim(),
    text: $("#r-text").value.trim(),
    at: new Date().toISOString()
  }];
  saveRatings(all);
  renderCardRating(rateNow.id);

  // Галочка «Спасибо», и через мгновение окно закрывается
  $("#rate-form").hidden = true;
  $("#rate-thanks").hidden = false;
  $("#r-name").value = "";
  $("#r-text").value = "";
  setTimeout(closeRate, 1400);
}

function setupRate() {
  $("#rate-dots").addEventListener("click", (event) => {
    const dot = event.target.closest("[data-score]");
    if (!dot) return;
    rateNow.score = Number(dot.dataset.score);
    renderRateDots();
    $("#rate-error").hidden = true;
  });
  $("#rate-send").addEventListener("click", sendRating);
  $("#rate-form").addEventListener("submit", (event) => event.preventDefault());
  $("#r-name").addEventListener("input", (event) => {
    event.target.classList.remove("is-invalid");
    $("#rate-error").hidden = true;
  });
  $("#rate-close").addEventListener("click", closeRate);
  $("#rate-modal").addEventListener("click", (event) => {
    if (event.target.id === "rate-modal") closeRate();
  });
}

/* ===================== Заказ: окно с формой → WhatsApp ===================== */

// Что сейчас в окне заказа
const orderNow = { id: null, opener: null };

function orderWeight(cake) {
  return cake.fixed ? null : chosenWeight[cake.id];
}

// Вес по числу гостей — самый лёгкий торт, которого хватит всем (по тому же расчёту):
// до 10 → 1,5 кг, 11–13 → 2 кг, 14–16 → 2,5 кг, 17 и больше → 3 кг
function weightForGuests(guests) {
  return CONFIG.weights.find((kg) => portions(kg) >= guests) ?? CONFIG.weights[CONFIG.weights.length - 1];
}

// Цена и предоплата в окне — пересчитываются при смене веса
function renderOrderPrice() {
  const cake = findCake(orderNow.id);
  const total = cakePrice(cake, orderWeight(cake));
  if (!cake.fixed) {
    const kg = chosenWeight[cake.id];
    const n = portions(kg);
    const guests = Math.floor(Number($("#o-guests").value));
    let hint = `${kilos(kg)} = примерно ${n} ${plural(n, "порция", "порции", "порций")}`;
    // Гостей больше, чем порций даже в самом большом торте, — говорим честно
    if (guests > n) hint += ` — на ${guests} ${plural(guests, "гостя", "гостей", "гостей")} не хватит, возьмите два торта`;
    $("#o-guests-hint").textContent = hint;
  }
  $("#order-price").textContent = `Итого: ${money(total)}`;
  $("#order-prepay").textContent = `Предоплата ${Math.round(CONFIG.prepay * 100)}%: ${money(total * CONFIG.prepay)}`;
  $$("#order-weights .weight[data-kg]").forEach((button) => {
    button.setAttribute("aria-checked", String(Number(button.dataset.kg) === chosenWeight[cake.id]));
  });
  updateOrderLink();
}

// Самая ранняя дата — сегодня + CONFIG.minDays, считаем в момент открытия окна.
// Страница могла быть открыта со вчера: тогда и минимум, и выбранная дата сдвигаются
function refreshMinDate(input) {
  input.min = dateFromToday(CONFIG.minDays);
  if (!input.value || input.value < input.min) input.value = input.min;
}

function openOrder(cakeId, opener) {
  refreshMinDate($("#o-date"));
  const cake = findCake(cakeId);
  orderNow.id = cakeId;
  orderNow.opener = opener;

  // Фото и название — только для чтения
  $("#order-photo").innerHTML = mediaHTML(cake, false);
  $("#order-title").textContent = cake.name;

  // Вес: 1,5 / 2 / 2,5 / 3 кг; у бенто — его фиксированный вес
  $("#order-weights").innerHTML = cake.fixed
    ? `<span class="weight weight--fixed">${escapeHtml(cake.fixed.weight)}</span>`
    : CONFIG.weights.map((kg) => `
        <button class="weight" type="button" role="radio" data-kg="${kg}">${kilos(kg)}</button>`).join("");
  $("#order-weights").setAttribute("role", cake.fixed ? "presentation" : "radiogroup");
  // У бенто вес один — калькулятор порций не нужен
  $("#order-guests").hidden = Boolean(cake.fixed);
  $("#o-guests").value = "";
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

/* ===================== Корзина: несколько тортов одним заказом ===================== */

// Корзина хранится в браузере и переживает перезагрузку страницы.
// Если хранилище недоступно (приватный режим, запрет в настройках) — корзина
// работает как раньше, просто живёт до перезагрузки
const CART_KEY = "tortdv-cart";

// Ключи от прошлых версий сайта: старая корзина и старый экран «Заказ принят».
// Сайт их больше не читает — убираем, чтобы не путали при проверке хранилища
try {
  ["tortdv-order", "tortdv-last-order"].forEach((key) => localStorage.removeItem(key));
} catch {
  /* хранилище недоступно — убирать нечего */
}

// Достаём корзину и отбрасываем то, чего на сайте уже нет:
// удалённый торт, вес, которого нет в списке, странное количество
function loadCart() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(CART_KEY));
  } catch {
    return [];
  }
  if (!Array.isArray(saved)) return [];
  return saved.filter((line) => {
    const cake = line && findCake(line.id);
    if (!cake || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 99) return false;
    return cake.fixed ? line.weight === null : CONFIG.weights.includes(line.weight);
  }).map((line) => ({ id: line.id, weight: line.weight, qty: line.qty }));
}

function saveCart() {
  try {
    if (cart.length) localStorage.setItem(CART_KEY, JSON.stringify(cart));
    else localStorage.removeItem(CART_KEY);
  } catch {
    /* хранилище недоступно — корзина просто не переживёт перезагрузку */
  }
}

const cart = loadCart();

// Корзину изменили — сохраняем и обновляем значок в шапке
function cartChanged() {
  saveCart();
  renderCartButton();
}

const lineTotal = (line) => cakePrice(findCake(line.id), line.weight) * line.qty;
const cartTotal = () => cart.reduce((sum, line) => sum + lineTotal(line), 0);
const cartCount = () => cart.reduce((n, line) => n + line.qty, 0);

// Тот же торт в том же весе — не новая строка, а +1 к количеству
function addToCart(cakeId, weight) {
  const same = cart.find((line) => line.id === cakeId && line.weight === weight);
  if (same) same.qty += 1;
  else cart.push({ id: cakeId, weight, qty: 1 });
  cartChanged();
}

function renderCartButton() {
  const count = cartCount();
  const button = $("#cart-btn");
  button.hidden = count === 0;
  $("#cart-count").textContent = count;
  // Для озвучки экранным диктором — словами; на экране число видно в кружке
  button.setAttribute("aria-label", `Корзина: ${count} ${plural(count, "торт", "торта", "тортов")}`);
}

function renderCart() {
  $("#cart-list").innerHTML = cart.map((line, i) => {
    const cake = findCake(line.id);
    return `
      <li class="cart__item" data-index="${i}">
        <div class="cart__photo">${mediaHTML(cake, false)}</div>
        <div class="cart__info">
          <b class="cart__name">${escapeHtml(cake.name)}</b>
          <span class="cart__meta">${escapeHtml(weightText(cake, line.weight))} · ${money(cakePrice(cake, line.weight))}</span>
          <span class="cart__qty">
            <button type="button" data-step="-1" aria-label="Убрать один">−</button>
            <output>${line.qty}</output>
            <button type="button" data-step="1" aria-label="Добавить ещё один">+</button>
          </span>
        </div>
        <b class="cart__sum">${money(lineTotal(line))}</b>
      </li>`;
  }).join("");

  const total = cartTotal();
  $("#cart-total").textContent = `Итого: ${money(total)}`;
  $("#cart-prepay").textContent = `Предоплата ${Math.round(CONFIG.prepay * 100)}%: ${money(total * CONFIG.prepay)}`;
  updateCartLink();
}

let cartOpener = null;

function openCart(opener) {
  if (!cart.length) return;
  refreshMinDate($("#c-date"));
  cartOpener = opener;
  renderCart();
  $("#cart-error").hidden = true;
  $$("#cart-form .is-invalid").forEach((field) => field.classList.toggle("is-invalid", false));
  $("#cart-modal").hidden = false;
  document.body.classList.add("no-scroll");
  $("#c-name").focus({ preventScroll: true });
}

function closeCart() {
  $("#cart-modal").hidden = true;
  if ($("#pd").hidden && $("#order-modal").hidden) document.body.classList.toggle("no-scroll", false);
  cartOpener?.focus({ preventScroll: true });
}

// Чего не хватает в корзине. Пусто — можно отправлять
function cartProblems() {
  const problems = [];
  const name = $("#c-name");
  const date = $("#c-date");
  if (!name.value.trim()) problems.push([name, "Напишите имя"]);
  if (!date.value) problems.push([date, "Выберите дату"]);
  else if (date.value < date.min) problems.push([date, `Дата — не раньше ${prettyDate(date.min)}`]);
  return problems;
}

// Все торты одним сообщением, пронумерованным списком
function cartText() {
  const total = cartTotal();
  const lines = cart.map((line, i) => {
    const cake = findCake(line.id);
    const weight = cake.fixed ? cake.fixed.weight : `${String(line.weight).replace(".", ",")} кг`;
    const count = line.qty > 1 ? ` × ${line.qty}` : "";
    return `${i + 1}) ${cake.name}, ${weight}${count} — ${money(lineTotal(line))}`;
  });
  return [
    `Здравствуйте! Хочу заказать ${cartCount()} ${plural(cartCount(), "торт", "торта", "тортов")}.`,
    ...lines,
    `Дата: ${prettyDate($("#c-date").value)}`,
    `Имя: ${$("#c-name").value.trim()}`,
    `Итого: ${money(total)}`,
    `Предоплата ${Math.round(CONFIG.prepay * 100)}%: ${money(total * CONFIG.prepay)}`
  ].join("\n");
}

function updateCartLink() {
  $("#cart-send").href = cartProblems().length
    ? "#"
    : `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(cartText())}`;
}

function setupCart() {
  const date = $("#c-date");
  refreshMinDate(date);
  $("#c-date-hint").textContent = `Не раньше чем через ${CONFIG.minDays} дней`;

  $("#cart-btn").addEventListener("click", (event) => openCart(event.currentTarget));
  $("#cart-close").addEventListener("click", closeCart);
  $("#cart-modal").addEventListener("click", (event) => {
    if (event.target.id === "cart-modal") closeCart();
  });

  // Количество тортов в строке: − и +
  $("#cart-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-step]");
    if (!button) return;
    const line = cart[Number(button.closest(".cart__item").dataset.index)];
    line.qty += Number(button.dataset.step);
    if (line.qty < 1) cart.splice(cart.indexOf(line), 1);
    cartChanged();
    if (!cart.length) return closeCart(); // убрали последний торт — закрываем
    renderCart();
  });

  $("#cart-clear").addEventListener("click", () => {
    cart.length = 0;
    cartChanged();
    closeCart();
  });

  $("#cart-form").addEventListener("input", (event) => {
    event.target.classList.toggle("is-invalid", false);
    $("#cart-error").hidden = true;
    updateCartLink();
  });
  $("#cart-form").addEventListener("submit", (event) => event.preventDefault());

  // Не хватает имени или даты — подсказываем, а не открываем пустой чат
  $("#cart-send").addEventListener("click", (event) => {
    const problems = cartProblems();
    if (!problems.length) return;
    event.preventDefault();
    problems.forEach(([field]) => field.classList.add("is-invalid"));
    $("#cart-error").textContent = problems.map(([, text]) => text).join(". ") + ".";
    $("#cart-error").hidden = false;
    problems[0][0].focus();
  });

  renderCartButton();
}

function setupOrder() {
  // Дата: не раньше чем через CONFIG.minDays дней
  const date = $("#o-date");
  refreshMinDate(date);
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

  // Число гостей само выбирает вес (5–50; меньше 5 — ждём, пока человек допечатает)
  $("#o-guests").addEventListener("input", (event) => {
    const guests = Math.min(50, Math.floor(Number(event.target.value)));
    if (!guests || guests < 5) return;
    chosenWeight[orderNow.id] = weightForGuests(guests);
    updateCardPrice(orderNow.id);
    onCardWeightChange();
    if (!$("#pd").hidden) renderProductPrice();
    renderOrderPrice();
  });

  // «В корзину»: торт складывается в корзину, окно мягко уходит, человек снова на главной,
  // а фото торта вылетает из окна и по дуге улетает в значок корзины в шапке
  $("#order-to-cart").addEventListener("click", () => {
    const modal = $("#order-modal");
    if (modal.classList.contains("is-leaving")) return; // второе нажатие, пока окно уходит
    const cakeId = orderNow.id;
    // Откуда вылетит торт: из фото в окне, если оно на экране. На телефоне до кнопки
    // «В корзину» окно прокручивают, фото уезжает вверх — тогда торт вылетает из самой кнопки
    const card = $("#order-modal .order__card").getBoundingClientRect();
    let photo = $("#order-photo .media").getBoundingClientRect();
    const photoSeen = photo.top >= card.top - 8 && photo.bottom <= window.innerHeight + 8; // видно целиком
    if (!photoSeen) photo = $("#order-to-cart").getBoundingClientRect();
    addToCart(cakeId, orderWeight(findCake(cakeId)));
    if (!$("#pd").hidden) closeProduct(); // заказывали со страницы торта — возвращаемся на главную

    // Анимации отключены в системе — просто закрываем окно
    if (reducedMotion.matches) return closeOrder();

    flyCake(cakeId, photo);
    modal.classList.add("is-leaving"); // окно плавно гаснет
    setTimeout(() => {
      modal.classList.remove("is-leaving");
      closeOrder();
    }, 280);
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
    ? `<span class="weight weight--fixed">${escapeHtml(cake.fixed.weight)}</span>`
    : CONFIG.weights.map((kg) => `
        <button class="weight" type="button" role="radio" data-kg="${kg}"
                aria-checked="${kg === chosenWeight[cake.id]}">${kilos(kg)}</button>`).join("");
  weights.setAttribute("role", cake.fixed ? "presentation" : "radiogroup");

  // Миниатюры: главное фото и 5 ракурсов
  const items = galleryOf(cake);
  $("#pd-thumbs").innerHTML = items.map((item, i) => `
    <button class="pd__thumb" type="button" data-photo="${i}" aria-label="${escapeHtml(item.label)}">
      ${photoHTML(item.base, "", cake.tint)}
    </button>`).join("");

  // Вкладки: описание всегда первое, остальные из настроек
  $("#pd-tabs").innerHTML = [{ id: "about", label: "Описание" }, ...CONFIG.tabs, { id: "reviews", label: "Отзывы" }]
    .map((tab) => `
      <button class="pd__tab" type="button" role="tab" data-tab="${escapeHtml(tab.id)}"
              aria-selected="${tab.id === pd.tab}">${escapeHtml(tab.label)}</button>`).join("");

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

const gallery = { cake: null, items: [], index: 0, opener: null, spin: null };

// 3D-просмотр (model-viewer) грузим с CDN только когда впервые открыли слайд с моделью
const MODEL_VIEWER_URL = "https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js";
let modelViewerLoading = null;
function loadModelViewer() {
  if (window.customElements?.get("model-viewer")) return Promise.resolve();
  if (!modelViewerLoading) {
    modelViewerLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.type = "module";
      script.src = MODEL_VIEWER_URL;
      script.onerror = () => {
        modelViewerLoading = null; // в следующий раз попробуем снова
        reject(new Error("model-viewer не загрузился"));
      };
      document.head.appendChild(script);
      customElements.whenDefined("model-viewer").then(resolve);
    });
  }
  return modelViewerLoading;
}

// Слайд «Пример 360°»: модель, подсказка, загрузка, подпись под моделью
function showModelSlide(frame, cake) {
  const model = cake.model;
  frame.innerHTML = `
    <div class="lb__model">
      <div class="lb__model-view">
        <span class="spin__label">Пример 360°</span>
        <span class="spin__hint">Покрутите пальцем ↔</span>
        <span class="lb__model-load">Загрузка 3D…</span>
      </div>
      <p class="lb__model-note">
        Пример 360° — так будут выглядеть ваши торты. Модель демонстрационная, не этот торт
        <small class="lb__model-credit" hidden></small>
      </p>
    </div>`;
  const view = $(".lb__model-view", frame);
  const hint = $(".spin__hint", view);
  const load = $(".lb__model-load", view);
  if (gallery.hintSeen) hint.classList.add("is-gone");

  if (model.credit) {
    const credit = $(".lb__model-credit", frame);
    const link = document.createElement("a");
    link.href = model.credit.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = model.credit.author;
    credit.append("3D-модель: ", link, `, ${model.credit.license || "CC BY"}`);
    credit.hidden = false;
  }

  let broken = false;
  const failed = () => {
    broken = true;
    load.textContent = "3D-модель не загрузилась";
    load.hidden = false;
    hint.classList.add("is-gone");
  };

  loadModelViewer().then(() => {
    if (!view.isConnected) return; // пока грузилось, слайд уже переключили
    const viewer = document.createElement("model-viewer");
    // Наклон камеры 45°–85°: под торт не заглянуть. Приближение выключено —
    // камера всегда на удобном расстоянии, щипок двумя пальцами ничего не ломает
    const attrs = {
      src: model.src,
      alt: "Пример 360°: демонстрационная 3D-модель торта, крутите влево и вправо",
      "camera-controls": "",
      "touch-action": "pan-y",
      "interaction-prompt": "none",
      "disable-pan": "",
      "disable-zoom": "",
      "camera-orbit": "0deg 70deg 105%",
      "min-camera-orbit": "auto 45deg auto",
      "max-camera-orbit": "auto 85deg auto",
      "shadow-intensity": "1",
      "shadow-softness": "1",
      loading: "eager",
      reveal: "auto"
    };
    Object.entries(attrs).forEach(([name, value]) => viewer.setAttribute(name, value));
    // Свою полосу загрузки рисуем сами — встроенную прячем
    viewer.innerHTML = '<div slot="progress-bar"></div>';
    viewer.addEventListener("progress", (event) => {
      if (broken) return; // после ошибки model-viewer ещё присылает «100%» — не затираем сообщение
      const percent = Math.round(event.detail.totalProgress * 100);
      load.textContent = `Загрузка 3D… ${percent}%`;
    });
    viewer.addEventListener("load", () => { load.hidden = true; });
    viewer.addEventListener("error", failed);
    // Первое касание — подсказка исчезает
    viewer.addEventListener("pointerdown", () => {
      gallery.hintSeen = true;
      hint.classList.add("is-gone");
    });
    view.prepend(viewer);
  }).catch(failed);
}

// startIndex — номер фото, как на странице торта (0 — главное).
// Если у торта есть вращение, оно стоит первым слайдом, перед главным фото
function openGallery(cakeId, opener, startIndex = 0) {
  const cake = findCake(cakeId);
  gallery.cake = cake;
  gallery.items = galleryOf(cake);
  gallery.opener = opener;
  if (cake.model) {
    gallery.items.unshift({ model: true, label: "Пример 360°" });
    startIndex += 1;
  } else if (cake.spin && window.TortSpin) {
    gallery.items.unshift({
      spin: true,
      label: cake.spin.demo ? "Пример 360°" : "360°",
      base: TortSpin.frameUrls(cake.spin)[0]
    });
    startIndex += 1;
  }

  $("#lb-title").textContent = cake.name;
  $("#lb-thumbs").innerHTML = gallery.items.map((item, i) => `
    <button class="lb__thumb" type="button" data-index="${i}" aria-label="${escapeHtml(item.label)}">
      ${item.model ? '<span class="media lb__thumb-3d">360°</span>' : photoHTML(item.base, "", cake.tint)}
      ${escapeHtml(item.label)}
    </button>`).join("");

  $("#lightbox").hidden = false;
  document.body.classList.add("no-scroll");
  showSlide(startIndex);
  $("#lb-close").focus({ preventScroll: true });
}

function closeGallery() {
  gallery.spin?.destroy();
  gallery.spin = null;
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

  gallery.spin?.destroy();
  gallery.spin = null;
  if (item.model) {
    showModelSlide(frame, gallery.cake);
  } else if (item.spin) {
    // Слайд 360°: в галерее сразу грузим все кадры
    frame.innerHTML = '<div class="media lb__spin"></div>';
    gallery.spin = new TortSpin.Viewer($(".lb__spin", frame), gallery.cake.spin, {
      label: item.label,
      alt: `${item.label}: торт крутится влево и вправо`
    });
    gallery.spin.loadAll();
  } else {
    frame.innerHTML = photoHTML(item.base, `${gallery.cake.name}: ${item.label.toLowerCase()}`, gallery.cake.tint, false);
  }
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
    if (event.target.closest(".spin, model-viewer")) {
      startX = null; // на слайде 360° свайп крутит торт, листать — стрелками
      return;
    }
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
    if (event.target.closest?.("model-viewer")) return; // стрелками крутят модель
    if (event.key === "ArrowRight") showSlide(gallery.index + 1, 1);
    if (event.key === "ArrowLeft") showSlide(gallery.index - 1, -1);
  });
}

/* ===================== Эффекты для телефонов ===================== */

// Телефон или планшет с пальцем вместо мыши, и анимации в системе не отключены.
// На компьютере все три эффекта ниже не работают
const touchQuery = window.matchMedia("(hover: none) and (pointer: coarse)");
const isTouchFx = () => touchQuery.matches && !reducedMotion.matches;

// 2. Параллакс первого экрана: размытый фон едет медленнее страницы (30% скорости).
// Двигаем через transform — на телефоне это плавнее, чем background-position
function setupHeroParallax() {
  const hero = $(".hero");
  const narrow = window.matchMedia("(max-width: 768px)");
  let queued = false;
  const update = () => {
    queued = false;
    const on = narrow.matches && !reducedMotion.matches;
    // Ниже первого экрана фон уже не видно — не тратим силы
    const shift = on ? Math.min(window.scrollY, hero.offsetHeight) * 0.3 : 0;
    hero.style.setProperty("--hero-shift", `${shift.toFixed(1)}px`);
  };
  window.addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update); // не чаще одного раза за кадр
  }, { passive: true });
  window.addEventListener("resize", update);
  update();
}

// 3. Карточки вплывают: снизу, из прозрачности и с наклоном 6°, по очереди
function setupCardArrival() {
  if (!isTouchFx() || !("IntersectionObserver" in window)) return;
  const cards = $$("#catalog .card");
  cards.forEach((card) => card.classList.add("is-pending"));
  const observer = new IntersectionObserver((entries) => {
    entries.filter((entry) => entry.isIntersecting).forEach((entry, i) => {
      const card = entry.target;
      observer.unobserve(card);
      card.style.transitionDelay = `${i * 80}ms`; // появившиеся вместе — лесенкой
      card.classList.add("is-arriving");
      card.classList.remove("is-pending");
      card.addEventListener("transitionend", () => {
        card.classList.remove("is-arriving");
        card.style.transitionDelay = "";
      }, { once: true });
    });
  }, { threshold: 0.15 });
  cards.forEach((card) => observer.observe(card));
}

/* ===================== Колонки каталога на телефоне ===================== */

// 2, 3 или 4 карточки в ряд. На компьютере не действует — там свой ряд из трёх
const COLS_KEY = "tortdv-cols";

function setCols(cols, remember = true) {
  const catalog = $("#catalog");
  catalog.classList.remove("cols-2", "cols-3", "cols-4");
  catalog.classList.add(`cols-${cols}`);
  $$("#cols-pick [data-cols]").forEach((button) => {
    button.setAttribute("aria-checked", String(Number(button.dataset.cols) === cols));
  });
  if (!remember) return;
  try {
    localStorage.setItem(COLS_KEY, String(cols));
  } catch {
    /* хранилище недоступно — выбор просто не запомнится */
  }
}

function setupCols() {
  let cols = 2;
  try {
    const saved = Number(localStorage.getItem(COLS_KEY));
    if ([2, 3, 4].includes(saved)) cols = saved;
  } catch {
    /* хранилище недоступно — начинаем с двух */
  }
  setCols(cols, false);
  $("#cols-pick").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cols]");
    if (button) setCols(Number(button.dataset.cols));
  });
}

/* ===================== Часы работы ===================== */

// Время в Хабаровске, а не у посетителя: из Москвы в 15:00 у нас уже 22:00
function bakeryNow() {
  const shifted = new Date(Date.now() + CONFIG.utcOffset * 3600 * 1000);
  return { day: shifted.getUTCDay(), hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}

// «Откроемся в понедельник» — день недели в нужной форме (0 — воскресенье)
const ON_DAY = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];

// Работаем сейчас? Если нет — ищем ближайший рабочий день:
// сегодня (если ещё не открылись), завтра или конкретный день недели
function openStatus() {
  const { day, hour, minute } = bakeryNow();
  const now = hour + minute / 60;
  const { days, open, close } = CONFIG.hours;
  if (days.includes(day) && now >= open && now < close) return { open: true, text: "Сейчас работаем" };
  for (let ahead = 0; ahead < 7; ahead++) {
    const next = (day + ahead) % 7;
    if (!days.includes(next) || (ahead === 0 && now >= open)) continue;
    const when = ahead === 0 ? "сегодня" : ahead === 1 ? "завтра" : ON_DAY[next];
    return { open: false, text: `Откроемся ${when} в ${open}:00` };
  }
  return { open: false, text: "Сейчас закрыто" }; // на случай, если рабочих дней не указано
}

function renderOpenStatus() {
  const status = openStatus();
  $("#open-now").classList.toggle("is-open", status.open);
  $("#open-now-text").textContent = status.text;
}

function setupHours() {
  $("#footer-hours").textContent = CONFIG.hours.label;
  $("#footer-dayoff").textContent = CONFIG.hours.dayOff || "";
  $("#footer-address").textContent = CONFIG.address;
  renderOpenStatus();
  setInterval(renderOpenStatus, 60 * 1000); // раз в минуту: страница может быть открыта долго
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
  setupCols();
  setupSectionReveal();
  setupHeroParallax();
  setupCardArrival();

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
  setupCart();
  setupRate();
  setupOrder();
  // Телефон в подвале — тоже из data.js
  $("#footer-tel").textContent = CONFIG.phone;
  $("#footer-tel").href = `tel:${CONFIG.phone.replace(/[^\d+]/g, "")}`;
  $("#footer-wa").href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Здравствуйте! Хочу заказать торт.")}`;
  // Telegram: имя или номер из data.js (номер — с «+», имя — без «@»)
  $("#footer-tg").href = `https://t.me/${CONFIG.telegram.replace(/^@/, "")}`;
  setupHours();
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
      // −1 — слайд перед главным фото, то есть вращение 360°
      openGallery(id, zoomBtn, event.target.closest(".spin-badge") ? -1 : 0);
      return;
    }

    // Нажали на карточку мимо кнопок — открываем страницу торта
    if (!event.target.closest("[data-order]")) openProduct(id, card);
  });

  // Escape закрывает сначала галерею, потом окно заказа, страницу торта, фильтры
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#lightbox").hidden) closeGallery();
    else if (!$("#rate-modal").hidden) closeRate();
    else if (!$("#cart-modal").hidden) closeCart();
    else if (!$("#order-modal").hidden) closeOrder();
    else if (!$("#pd").hidden) closeProduct();
    else closeFilters();
  });
});
