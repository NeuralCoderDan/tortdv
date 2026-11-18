// Вращение торта на 360° по кадрам. Чистый JavaScript, без библиотек.
// Торт крутят только пальцем или мышью (Pointer Events) — без гироскопа и без запросов разрешений.
//
// Кадры лежат в одной папке: frame-01.jpg … frame-36.jpg (36 кадров через 10°).
// У торта в data.js это описывается так:
//   spin: { folder: "images/spin/cake1/", count: 36, ext: "jpg" }
//
// Подключение: new TortSpin.Viewer(контейнер, spin, { label, enabled }).
//   viewer.loadAll()  — догрузить все кадры (в галерее — сразу, на карточке — при первом касании)
//   viewer.destroy()  — остановить и убрать

(function () {
  "use strict";

  const PX_PER_FRAME = 6;        // столько пикселей движения пальца = 1 кадр (высокая чувствительность)
  const MIN_SWIPE_FRAMES = 3;    // даже слабый свайп проворачивает минимум на 3 кадра
  const SAMPLE_MS = 100;         // скорость пальца берём за последние ~100 мс
  const FRICTION = 0.94;         // каждый кадр (1/60 с) скорость падает до 94% — плавное торможение
  const MAX_SPEED = 0.3;         // предел: кадров за миллисекунду
  const STOP_SPEED = 0.002;      // медленнее этого — считаем, что торт остановился
  const TAP_PX = 6;              // палец сдвинулся меньше — это нажатие, а не свайп
  const FRAME_MS = 1000 / 60;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Адреса кадров по описанию из data.js
  function frameUrls(spin) {
    const ext = spin.ext || "jpg";
    return Array.from({ length: spin.count }, (_, i) =>
      `${spin.folder}frame-${String(i + 1).padStart(2, "0")}.${ext}`);
  }

  // Каждый кадр грузится один раз на всю страницу — карточка и галерея делят загрузку
  const cache = new Map();
  function loadImage(url) {
    if (!cache.has(url)) {
      cache.set(url, new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Кадр не загрузился: ${url}`));
        img.src = url;
      }));
    }
    return cache.get(url);
  }

  // Подсказку «Покрутите пальцем» достаточно увидеть один раз за визит
  let hintSeen = false;

  class Viewer {
    constructor(host, spin, options = {}) {
      this.urls = frameUrls(spin);
      this.count = this.urls.length;
      this.dir = spin.reverse ? -1 : 1;           // если на видео торт крутится в другую сторону
      this.enabled = options.enabled || (() => true);
      this.pos = 0;                               // текущий кадр (дробный: между кадрами при движении)
      this.shown = -1;
      this.velocity = 0;                          // кадров в миллисекунду
      this.ready = false;                         // все кадры загружены
      this.loading = null;
      this.raf = 0;
      this.drag = null;
      this.suppressClick = false;

      // Разметка: картинка, подсказка, индикатор загрузки, подпись
      const root = document.createElement("div");
      root.className = "spin";
      root.tabIndex = 0;
      root.setAttribute("role", "img");
      root.setAttribute("aria-label", options.alt || "Торт на 360°: крутите влево и вправо");
      root.innerHTML = `
        <img class="spin__img" alt="" draggable="false">
        ${options.label ? '<span class="spin__label"></span>' : ""}
        <span class="spin__hint">Покрутите пальцем ↔</span>
        <span class="spin__load" hidden></span>`;
      if (options.label) root.querySelector(".spin__label").textContent = options.label;
      if (hintSeen || options.hint === false) root.querySelector(".spin__hint").classList.add("is-gone");
      host.appendChild(root);

      this.root = root;
      this.img = root.querySelector(".spin__img");
      this.hint = root.querySelector(".spin__hint");
      this.loader = root.querySelector(".spin__load");

      // Сразу — только первый кадр: остальные 35 по запросу (касание или галерея)
      loadImage(this.urls[0]).then(() => this.render(true)).catch(() => {});

      this.onDown = this.onDown.bind(this);
      this.onMove = this.onMove.bind(this);
      this.onUp = this.onUp.bind(this);
      this.onCancel = this.onCancel.bind(this);
      this.onKey = this.onKey.bind(this);
      this.onClick = this.onClick.bind(this);
      root.addEventListener("pointerdown", this.onDown);
      root.addEventListener("pointermove", this.onMove);
      root.addEventListener("pointerup", this.onUp);
      root.addEventListener("pointercancel", this.onCancel);
      root.addEventListener("keydown", this.onKey);
      // Клик после свайпа гасим: иначе карточка открыла бы галерею, а галерея — закрылась
      root.addEventListener("click", this.onClick, true);
    }

    // Догрузить все кадры, показывая «Загрузка 12 / 36»
    loadAll() {
      if (this.loading) return this.loading;
      let done = 0;
      const progress = () => {
        this.loader.textContent = `Загрузка ${done} / ${this.count}`;
      };
      this.loader.hidden = false;
      progress();
      this.loading = Promise.all(this.urls.map((url) =>
        loadImage(url).then(() => { done++; progress(); })
      )).then(() => {
        this.ready = true;
        this.loader.hidden = true;
      }).catch(() => {
        this.loader.textContent = "Не удалось загрузить кадры";
      });
      return this.loading;
    }

    // Показать кадр, соответствующий текущему положению (по кругу: после 36-го — 1-й)
    render(force = false) {
      const index = ((Math.round(this.pos) % this.count) + this.count) % this.count;
      if (index === this.shown && !force) return;
      // Пока не всё загружено — остаёмся на первом кадре
      if (!this.ready && index !== 0) return;
      this.shown = index;
      this.img.src = this.urls[index];
    }

    hideHint() {
      hintSeen = true;
      this.hint.classList.add("is-gone");
    }

    onDown(event) {
      if (!event.isPrimary || event.button > 0) return;
      if (!this.enabled()) return; // например, маленькая карточка — нажатие уходит дальше и открывает галерею
      this.hideHint();
      // Первое касание запускает загрузку остальных кадров. Движение пальца всё равно
      // отслеживаем, чтобы свайп не превратился в «нажатие» (оно открыло бы галерею)
      if (!this.ready) this.loadAll();
      // Торт ещё крутится — запоминаем скорость, чтобы сложить её со следующим свайпом
      this.carried = this.velocity;
      this.stop();
      this.drag = { id: event.pointerId, startX: event.clientX, startPos: this.pos, moved: 0, samples: [] };
      this.sample(event);
      try { this.root.setPointerCapture(event.pointerId); } catch (e) { /* палец уже отпущен — не страшно */ }
      this.root.classList.add("is-dragging");
    }

    sample(event) {
      const now = performance.now();
      const samples = this.drag.samples;
      samples.push({ t: now, x: event.clientX });
      while (samples.length > 2 && now - samples[0].t > SAMPLE_MS) samples.shift();
    }

    onMove(event) {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      const dx = event.clientX - this.drag.startX;
      this.drag.moved = Math.max(this.drag.moved, Math.abs(dx));
      if (!this.ready) return; // кадры ещё грузятся — крутить нечего
      this.pos = this.drag.startPos + (dx / PX_PER_FRAME) * this.dir;
      this.sample(event);
      this.render();
    }

    onUp(event) {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      if (this.ready) this.sample(event); // последняя точка — для скорости пальца
      const drag = this.drag;
      this.drag = null;
      this.root.classList.remove("is-dragging");

      // Почти не сдвинули палец — это нажатие: крутящийся торт останавливается, клик проходит дальше
      if (drag.moved < TAP_PX) {
        this.suppressClick = false;
        this.settle();
        return;
      }
      this.suppressClick = true;
      if (!this.ready || reducedMotion.matches) return this.settle(); // без кадров или без анимаций — без инерции

      // Скорость пальца за последние ~100 мс → кадров в миллисекунду
      const first = drag.samples[0];
      const last = drag.samples[drag.samples.length - 1];
      const dt = Math.max(1, last.t - first.t);
      let speed = ((last.x - first.x) / dt / PX_PER_FRAME) * this.dir;

      // Раз-раз-раз: свайп в ту же сторону прибавляет к уже имеющейся скорости
      if (this.carried && Math.sign(this.carried) === Math.sign(speed)) speed += this.carried;

      // Слабый свайп: вместе с инерцией торт должен провернуться хотя бы на 3 кадра
      const dragged = Math.abs(this.pos - drag.startPos);
      const coast = FRAME_MS / (1 - FRICTION); // путь инерции = скорость × это число
      const sign = Math.sign(speed) || Math.sign(this.pos - drag.startPos) || 1;
      if (dragged + Math.abs(speed) * coast < MIN_SWIPE_FRAMES) {
        // + STOP_SPEED: торт останавливается чуть раньше нуля скорости — добавляем этот хвост
        speed = sign * ((MIN_SWIPE_FRAMES - dragged) / coast + STOP_SPEED * 1.2);
      }

      this.velocity = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, speed));
      this.carried = 0;
      this.spinLoop();
    }

    // Браузер забрал жест себе (человек листает страницу вниз) — просто отпускаем
    onCancel() {
      if (!this.drag) return;
      this.drag = null;
      this.root.classList.remove("is-dragging");
      this.settle();
    }

    onClick(event) {
      if (!this.suppressClick) return;
      this.suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    // Стрелки на клавиатуре — по кадру
    onKey(event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation(); // в галерее стрелки иначе листали бы фото
      this.hideHint();
      if (!this.ready) return void this.loadAll();
      this.stop();
      this.pos = Math.round(this.pos) + (event.key === "ArrowRight" ? 1 : -1);
      this.render();
    }

    // Инерция: торт крутится по скорости и плавно тормозит
    spinLoop() {
      let lastTime = performance.now();
      const step = (now) => {
        const dt = Math.min(50, now - lastTime);
        lastTime = now;
        this.pos += this.velocity * dt;
        this.velocity *= Math.pow(FRICTION, dt / FRAME_MS);
        this.render();
        if (Math.abs(this.velocity) < STOP_SPEED) return this.settle();
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }

    stop() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.velocity = 0;
    }

    settle() {
      this.stop();
      this.pos = Math.round(this.pos) % this.count;
      this.render();
    }

    destroy() {
      this.stop();
      this.root.remove();
    }
  }

  window.TortSpin = {
    Viewer,
    frameUrls,
    // Заранее подгрузить только первый кадр (например, когда карточка показалась на экране)
    preloadFirst: (spin) => loadImage(frameUrls(spin)[0]).catch(() => {})
  };
})();
