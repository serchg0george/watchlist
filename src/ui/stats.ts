import { closeEditors, highlightItem } from "../actions.js";
import { PEOPLE } from "../config.js";
import { MONTH_FULL, computeStats } from "../domain/stats.js";
import type { Stats } from "../domain/stats.js";
import type { Item, Person, Status } from "../domain/types.js";
import { getTypes, openComments, render, state } from "../state/store.js";
import { byId, el, statsSvg } from "./dom.js";
import type { ElChild } from "./dom.js";

// ===== Stats tab =====

const MONTH_NAMES = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function statsFmt(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(1).replace(".", ",");
}


function statsChart(width: number, height: number, label: string, interactive = false): SVGSVGElement {
  return statsSvg("svg", { width: "100%", viewBox: `0 0 ${width} ${height}`, role: interactive ? "group" : "img", "aria-label": label });
}

function statsWho(person: Person, text: string = person): HTMLElement {
  return el("b", { class: `who ${person.toLowerCase()}`, text });
}

function statsBadge(item: Item): HTMLElement {
  const type = getTypes().find((t) => t.key === item.type);
  return el("span", { class: "badge", style: `--c:${type?.color || "var(--muted)"}`, text: type?.label || item.type || "Без типа" });
}

function statsEmpty(text: string): HTMLElement {
  return el("p", { class: "empty", text });
}

function statsSection(key: string, title: string, note?: string | null): { section: HTMLElement; body: HTMLElement } {
  const body = el("div", { class: "sec-body", id: key });
  const section = el("section", { class: `card sec-${key}`, "aria-labelledby": `h-${key}` },
    el("h2", { class: "sec-title", id: `h-${key}`, text: title }),
    note ? el("p", { class: "sec-note", text: note }) : null, body);
  return { section, body };
}

function statsLegend(entries: [string, string][]): HTMLElement {
  return el("div", { class: "legend" }, ...entries.map(([label, color]) => el("span", {}, el("i", { class: "sw", style: `background:${color}`, "aria-hidden": "true" }), label)));
}

function statsTooltip(tip: HTMLElement, node: HTMLElement | SVGElement, content: () => Node[]): void {
  const hide = () => { tip.hidden = true; };
  const show = () => {
    tip.replaceChildren(...content());
    tip.hidden = false;
    const bounds = node.getBoundingClientRect(), margin = 8;
    tip.style.left = `${Math.max(margin, Math.min(window.innerWidth - tip.offsetWidth - margin, bounds.left + bounds.width / 2 - tip.offsetWidth / 2))}px`;
    const top = bounds.top - tip.offsetHeight - margin;
    tip.style.top = `${Math.max(margin, Math.min(window.innerHeight - tip.offsetHeight - margin, top < margin ? bounds.bottom + margin : top))}px`;
  };
  node.addEventListener("pointerenter", show);
  node.addEventListener("focus", show);
  node.addEventListener("pointerleave", hide);
  node.addEventListener("blur", hide);
  node.addEventListener("keydown", (event: Event) => { if (event instanceof KeyboardEvent && event.key === "Escape") hide(); });
}

function renderStatsHero(items: Item[], data: Stats): HTMLElement {
  const card = (name: string, label: string, ...children: ElChild[]): HTMLElement => el("div", { class: `card hero-${name}` }, el("div", { class: "kpi-label", text: label }), ...children);
  const statuses: [Status, string, string][] = [
    ["watched", "Просмотрено", "var(--accent)"], ["watching", "Смотрим", "color-mix(in srgb,var(--accent) 50%,transparent)"],
    ["planned", "В планах", "var(--track)"], ["dropped", "Брошено", "var(--danger)"]
  ];
  const watched = card("watched", "Просмотрено", el("div", { class: "kpi" }, data.statuses.watched, el("small", { text: ` из ${items.length}` })));
  if (items.length) watched.append(el("div", { class: "status-bar", role: "img", "aria-label": statuses.map(([key, label]) => `${label}: ${data.statuses[key]}`).join(", ") },
    ...statuses.filter(([key]) => data.statuses[key]).map(([key, label, color]) => el("i", { style: `flex:${data.statuses[key]};background:${color}`, title: `${label}: ${data.statuses[key]}` }))),
    statsLegend(statuses.map(([key, label, color]): [string, string] => [`${label} ${data.statuses[key]}`, color])));
  else watched.append(statsEmpty("Список пока пуст"));
  const average = card("avg", "Средняя оценка");
  if (data.values.S.length || data.values.L.length) {
    average.append(el("div", { class: "vs" },
      el("div", { class: "vs-side s" }, statsWho("S"), el("span", { class: "kpi", text: statsFmt(data.averages.S) })),
      el("div", { class: "vs-sep", text: "vs" }),
      el("div", { class: "vs-side l" }, statsWho("L"), el("span", { class: "kpi", text: statsFmt(data.averages.L) }))));
    average.append(el("div", { class: "avg-bars", "aria-hidden": "true" },
      ...PEOPLE.map((person) => el("div", { class: `avg-bar ${person.toLowerCase()}` }, el("i", { style: `width:${(data.averages[person] || 0) * 10}%` }))),
      el("div", { class: "avg-ticks" }, ...[0, 5, 10].map((n) => el("span", { text: n })))));
    let caption = "Для сравнения нужны оценки S и L";
    if (data.averages.S != null && data.averages.L != null) {
      const difference = data.averages.S - data.averages.L;
      caption = Math.abs(difference) < 0.05 ? "Поровну" : `${difference > 0 ? "S" : "L"} щедрее на ${statsFmt(Math.abs(difference))}`;
    }
    average.append(el("div", { class: "kpi-cap", text: caption }));
  } else average.append(statsEmpty("Пока нет оценок"));
  average.append(el("div", { class: "kpi-cap", text: `Оценок: S ${data.values.S.length} · L ${data.values.L.length}` }));
  const match = card("match", "Совпадение вкусов");
  if (data.both.length) {
    const percentage = Math.round(data.close / data.both.length * 100), circumference = 2 * Math.PI * 24;
    const ring = statsSvg("svg", { width: 60, height: 60, viewBox: "0 0 60 60", "aria-hidden": "true" },
      statsSvg("circle", { cx: 30, cy: 30, r: 24, fill: "none", stroke: "var(--track)", "stroke-width": 8 }),
      statsSvg("circle", { cx: 30, cy: 30, r: 24, fill: "none", stroke: "var(--accent)", "stroke-width": 8, "stroke-dasharray": `${circumference * data.close / data.both.length} ${circumference}`, transform: "rotate(-90 30 30)" }));
    match.append(el("div", { class: "match" }, ring, el("div", { class: "kpi-m", text: `${percentage}%` })), el("div", { class: "kpi-cap", text: `${data.close} из ${data.both.length} общих оценок с разницей ≤ 1` }));
  } else match.append(statsEmpty("Пока нет общих оценок"));
  const both = card("both", "Оценили оба", el("div", { class: "kpi-m", text: data.both.length }), el("div", { class: "kpi-cap", text: `Совпали точно: ${data.exact}` }));
  return el("section", { class: "hero", "aria-label": "Главное" }, watched, average, match, both);
}

function renderStatsHistogram(data: Stats, tip: HTMLElement): HTMLElement {
  const mode = (person: Person): number => data.counts[person].indexOf(Math.max(...data.counts[person]));
  const phrases = PEOPLE.filter((person) => data.values[person].length).map((person, i) => `${person}${i ? " —" : " ставит"} ${mode(person)}`);
  const { section, body } = statsSection("hist", "Распределение оценок", phrases.length ? `Чаще всего ${phrases.join(", ")}` : null);
  if (!phrases.length) { body.append(statsEmpty("Пока нет оценок")); return section; }
  const chart = statsChart(440, 220, "Распределение оценок S и L от 1 до 10");
  const max = Math.max(...data.counts.S, ...data.counts.L), step = max <= 4 ? 1 : Math.ceil(max / 4), ceiling = Math.ceil(max / step) * step;
  const y = (n: number): number => 182 - n / ceiling * 160;
  for (let n = 0; n <= ceiling; n += step) chart.append(statsSvg("line", { class: "grid", x1: 26, x2: 438, y1: y(n), y2: y(n) }), statsSvg("text", { class: "ax", x: 18, y: y(n) + 4, "text-anchor": "end" }, n));
  for (let rating = 1; rating <= 10; rating++) {
    const cx = 26 + (rating - 0.5) * 41.2;
    const group = statsSvg("g", { class: "col", tabindex: 0, "aria-label": `Оценка ${rating}: S ${data.counts.S[rating]}, L ${data.counts.L[rating]}` });
    group.append(statsSvg("rect", { class: "col-bg", x: cx - 19, y: 4, width: 38, height: 198, rx: 6 }));
    PEOPLE.forEach((person, index) => {
      const count = data.counts[person][rating] ?? 0, x = cx + (index ? 1 : -15);
      if (count) group.append(statsSvg("rect", { x, y: y(count), width: 14, height: 182 - y(count), rx: 3, fill: `var(--${person.toLowerCase()})` }), statsSvg("text", { class: "val", x: x + 7, y: y(count) - 5, "text-anchor": "middle", fill: `var(--${person.toLowerCase()})` }, count));
    });
    group.append(statsSvg("text", { class: "ax-strong", x: cx, y: 201, "text-anchor": "middle" }, rating));
    statsTooltip(tip, group, () => [el("div", { class: "tip-h", text: `Оценка ${rating}` }), ...PEOPLE.map((person) => el("div", { class: "tip-row" }, statsWho(person), `${data.counts[person][rating]} тайтлов`))]);
    chart.append(group);
  }
  chart.append(statsSvg("text", { class: "ax", x: 232, y: 218, "text-anchor": "middle" }, "оценка"));
  body.append(statsLegend([["S", "var(--s)"], ["L", "var(--l)"]]), el("div", { class: "chart" }, chart));
  return section;
}

function renderStatsMonths(data: Stats, tip: HTMLElement): HTMLElement {
  const total = data.months.reduce((sum, month) => sum + month.count, 0);
  const best = data.months.reduce((a, b) => b.count > a.count ? b : a);
  const note = total ? `${total} за 12 месяцев · больше всего — ${MONTH_FULL[best.month]} (${best.count}) · текущий месяц ещё идёт` : "Последние 12 календарных месяцев · текущий месяц ещё идёт";
  const { section, body } = statsSection("months", "Просмотрено по месяцам", note);
  if (!total) { body.append(statsEmpty("За последние 12 месяцев ничего не просмотрено")); return section; }
  const chart = statsChart(440, 220, "Просмотрено за последние 12 календарных месяцев");
  const max = Math.max(...data.months.map((month) => month.count));
  chart.append(statsSvg("line", { class: "grid", x1: 2, x2: 438, y1: 192, y2: 192 }));
  data.months.forEach((month, index) => {
    const x = 2 + (index + 0.5) * 436 / 12, height = month.count / max * 168;
    const group = statsSvg("g", { class: "col", tabindex: 0, "aria-label": `${MONTH_FULL[month.month]} ${month.year}: ${month.count}` });
    group.append(statsSvg("rect", { class: "col-bg", x: x - 17, y: 4, width: 34, height: 214, rx: 6 }),
      statsSvg("rect", { x: x - 11, y: month.count ? 192 - height : 190, width: 22, height: month.count ? height : 2, rx: 3, fill: month.count ? "var(--accent)" : "var(--track)", "fill-opacity": index === 11 ? 0.55 : 1 }),
      statsSvg("text", { class: "val", x, y: month.count ? 187 - height : 183, "text-anchor": "middle", fill: "var(--text)" }, month.count),
      statsSvg("text", { class: index === 11 ? "ax-strong" : "ax", x, y: 212, "text-anchor": "middle" }, MONTH_NAMES[month.month]));
    statsTooltip(tip, group, () => [el("div", { class: "tip-h", text: `${MONTH_FULL[month.month]} ${month.year}` }), ...(month.items.length ? month.items.map((item) => el("div", { class: "tip-row", text: item.title })) : [el("div", { class: "tip-sub", text: "Ничего не просмотрено" })])]);
    chart.append(group);
  });
  body.append(el("div", { class: "chart" }, chart));
  return section;
}

function renderStatsScatter(data: Stats, tip: HTMLElement): HTMLElement {
  const { section, body } = statsSection("scatter", "S против L", "Каждая точка — тайтл, оценённый обоими. Нажмите на точку, чтобы увидеть названия.");
  if (!data.both.length) { body.append(statsEmpty("Пока нет общих оценок")); return section; }
  const chart = statsChart(440, 440, "Оценка S по горизонтали, оценка L по вертикали. Выберите точку, чтобы увидеть тайтлы", true);
  const x = (value: number): number => 30 + (value - 0.5) * 40, y = (value: number): number => 404 - (value - 0.5) * 39.4;
  const band: [number, number][] = [[0.5, 1.5], [9.5, 10.5], [10.5, 10.5], [10.5, 9.5], [1.5, 0.5], [0.5, 0.5]];
  chart.append(statsSvg("polygon", { points: band.map(([s, l]) => `${x(s)},${y(l)}`).join(" "), fill: "var(--accent)", "fill-opacity": 0.1 }));
  for (let rating = 1; rating <= 10; rating++) chart.append(
    statsSvg("line", { class: "grid", x1: x(rating), x2: x(rating), y1: 10, y2: 404 }), statsSvg("line", { class: "grid", x1: 30, x2: 430, y1: y(rating), y2: y(rating) }),
    statsSvg("text", { class: "ax-strong", x: x(rating), y: 420, "text-anchor": "middle" }, rating), statsSvg("text", { class: "ax-strong", x: 22, y: y(rating) + 4, "text-anchor": "end" }, rating));
  chart.append(statsSvg("line", { x1: x(0.5), x2: x(10.5), y1: y(0.5), y2: y(10.5), stroke: "var(--muted)", "stroke-dasharray": "5 5" }),
    statsSvg("text", { class: "ax", x: 150, y: 265, transform: "rotate(-45 150 265)", "text-anchor": "middle" }, "согласны · ±1"),
    statsSvg("text", { x: x(1), y: y(10), fill: "var(--l)", "font-size": 12, "font-weight": 600 }, "L выше"),
    statsSvg("text", { x: x(10), y: y(1), fill: "var(--s)", "font-size": 12, "font-weight": 600, "text-anchor": "end" }, "S выше"),
    statsSvg("text", { class: "ax", x: 230, y: 438, "text-anchor": "middle" }, "оценка S →"),
    statsSvg("text", { class: "ax", transform: "translate(9 207) rotate(-90)", "text-anchor": "middle" }, "оценка L →"));
  const detail = el("div", { class: "scatter-detail", id: "scatter-detail", hidden: true, role: "region", "aria-label": "Выбранные тайтлы", "aria-live": "polite" });
  const points: SVGGElement[] = [];
  [...data.groups.values()].sort((a, b) => b.length - a.length).forEach((items) => {
    const first = items[0];
    if (!first) return;
    const { S: s, L: l } = first.ratings, color = s > l ? "var(--s)" : l > s ? "var(--l)" : "var(--accent)";
    const point = statsSvg("g", { class: "pt", tabindex: 0, role: "button", "aria-label": `S ${s}, L ${l}: ${items.map((item) => item.title).join(", ")}. Показать тайтлы`, "aria-controls": "scatter-detail", "aria-expanded": "false", "fill-opacity": 0.5 });
    point.append(statsSvg("circle", { cx: x(s), cy: y(l), r: Math.min(18, 7 + (items.length - 1) * 4), fill: color, stroke: color, "stroke-width": 1.5 }));
    if (items.length > 1) point.append(statsSvg("text", { x: x(s), y: y(l) + 4, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "var(--text)", "fill-opacity": 1 }, items.length));
    const select = () => {
      tip.hidden = true;
      points.forEach((other) => other.setAttribute("aria-expanded", String(other === point)));
      detail.replaceChildren(el("div", { class: "scatter-detail-head" }, statsWho("S", `S ${s}`), statsWho("L", `L ${l}`)),
        el("div", { class: "scatter-detail-list" }, ...items.map((item) => el("div", { class: "scatter-detail-item" }, el("span", { class: "title", text: item.title }), statsBadge(item)))));
      detail.hidden = false;
    };
    point.addEventListener("click", select);
    point.addEventListener("keydown", (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } });
    statsTooltip(tip, point, () => items.map((item) => el("div", { class: "tip-row" }, el("span", { text: item.title }), el("span", { class: "tip-r" }, statsWho("S", `S ${s}`), statsWho("L", `L ${l}`)))));
    points.push(point); chart.append(point);
  });
  body.append(el("div", { class: "chart scatter-box" }, chart), statsLegend([["S выше", "var(--s)"], ["L выше", "var(--l)"], ["поровну", "var(--accent)"]]),
    el("p", { class: "sec-note", text: "Размер и число — сколько тайтлов" }), detail);
  return section;
}

function statsItemButton(item: Item): HTMLElement {
  const button = el("button", { type: "button", class: "title stats-title-button", text: item.title, title: item.title, "aria-label": `Открыть обсуждение: ${item.title}` });
  button.addEventListener("click", () => {
    closeEditors();
    state.tab = item.status === "watched" || item.status === "dropped" ? item.status : "list";
    state.statusFilter = item.status === "watching" ? "watching" : "all";
    state.typeFilter = "all";
    state.search = "";
    byId<HTMLInputElement>("search").value = "";
    highlightItem(item.id);
    openComments.set(item.id, true);
    render();
    const row = document.querySelector<HTMLElement>(`.item-row[data-id="${CSS.escape(item.id)}"]`);
    if (row) { row.setAttribute("tabindex", "-1"); row.focus({ preventScroll: true }); row.scrollIntoView({ behavior: "smooth", block: "center" }); }
  });
  return button;
}

function renderStatsGenres(data: Stats): HTMLElement {
  const { section, body } = statsSection("genres", "Совпадение по жанрам", "Только просмотренное. Один тайтл может входить в несколько жанров.");
  if (!data.genres.length) { body.append(statsEmpty("Добавьте жанры в редакторе просмотренных тайтлов — здесь появится сравнение ваших вкусов.")); return section; }
  body.append(el("div", { class: "genre-grid" }, ...data.genres.map((genre) => {
    const card = el("article", { class: "genre-card" },
      el("div", { class: "genre-head" }, el("h3", { text: genre.label }), el("span", { class: "genre-count", text: `Просмотрено: ${genre.count}` })),
      el("div", { class: "genre-ratings" }, ...PEOPLE.map((person) => el("div", { class: "genre-rating" },
        statsWho(person), el("strong", { text: statsFmt(genre.people[person].average) }),
        el("span", { class: "genre-count", text: `оценок: ${genre.people[person].count}` })))),
      el("div", { class: "genre-agreement" }, el("strong", { text: genre.agreement == null ? "Пока не сравнить" : `${Math.round(genre.agreement)}% совпадения` }),
        el("span", { class: "genre-count", text: `Оценили оба: ${genre.paired}` })));
    if (genre.agreement != null) card.append(el("div", { class: "genre-meter", "aria-hidden": "true" }, el("i", { style: `width:${genre.agreement}%` })));
    if (genre.paired < 3) card.append(el("p", { class: "sec-note", text: genre.paired ? "Пока мало совместных оценок — результат предварительный." : "Нужны оценки обоих на одни и те же тайтлы." }));
    return card;
  })));
  body.append(el("p", { class: "sec-note genre-formula", text: "Средние оценки S и L учитывают все их оценки в жанре. Совпадение = 100 × (1 − средняя разница общих оценок / 9): одинаковые оценки дают 100%, разница в 9 баллов — 0%." }));
  return section;
}

function renderStatsFavorite(data: Stats): HTMLElement {
  const favorite = data.favoriteMonth;
  const { section, body } = statsSection("favorite", "Фаворит месяца", `${favorite.label} · по средней оценке двоих`);
  if (!favorite.items.length) { body.append(statsEmpty("В этом месяце пока нет просмотренных тайтлов с датой и оценками обоих.")); return section; }
  body.append(el("p", { class: "sec-note", text: `Тайтлов с двумя оценками за месяц: ${favorite.count}${favorite.items.length > 1 ? ". Первое место разделили:" : ""}` }));
  favorite.items.forEach((item) => body.append(el("div", { class: "favorite-row" },
    el("div", { class: "favorite-main" }, statsItemButton(item), statsBadge(item)),
    el("div", { class: "pair" }, statsWho("S", `S ${item.ratings.S}`), statsWho("L", `L ${item.ratings.L}`)),
    el("strong", { class: "favorite-score", "aria-label": `Средняя оценка ${statsFmt((item.ratings.S + item.ratings.L) / 2)}`, text: statsFmt((item.ratings.S + item.ratings.L) / 2) }))));
  return section;
}

function renderStatsDiffs(data: Stats): HTMLElement {
  const { section, body } = statsSection("diff", "Самые спорные просмотры", "Пять самых больших расхождений среди просмотренного. Нажмите на название, чтобы открыть обсуждение.");
  body.id = "diffs";
  if (!data.diffs.length) { body.append(statsEmpty("Пока нет просмотренных тайтлов с разными оценками обоих.")); return section; }
  const position = (value: number): number => (value - 1) / 9 * 100;
  data.diffs.forEach((item) => {
    const { S: s, L: l } = item.ratings;
    const scale = el("div", { class: "scale", "aria-hidden": "true" }, el("div", { class: "scale-track" }));
    for (let value = 1; value <= 10; value++) scale.append(el("i", { class: "scale-tick", style: `left:${position(value)}%` }));
    scale.append(el("i", { class: "scale-line", style: `left:${position(Math.min(s, l))}%;width:${Math.abs(s - l) / 9 * 100}%;background:linear-gradient(90deg,var(--${s <= l ? "s" : "l"}),var(--${s <= l ? "l" : "s"}))` }),
      el("span", { class: "dot s", style: `left:${position(s)}%`, text: "S" }), el("span", { class: "dot l", style: `left:${position(l)}%`, text: "L" }));
    body.append(el("div", { class: "row" }, el("div", { class: "row-head" }, statsItemButton(item),
      el("span", { class: "pair" }, statsWho("S", `S ${s}`), statsWho("L", `L ${l}`)), el("span", { class: "delta", "aria-label": `разница ${Math.abs(s - l)}`, text: `Δ ${Math.abs(s - l)}` })), scale));
  });
  body.append(el("div", { class: "scale-axis", "aria-hidden": "true" }, ...Array.from({ length: 10 }, (_, i) => el("span", { style: `left:${position(i + 1)}%`, text: i + 1 }))));
  return section;
}

function renderStatsCategories(items: Item[], data: Stats): HTMLElement {
  const { section, body } = statsSection("cats", "По типам", "Длина отрезка — всего в списке, заливка — просмотрено");
  if (!items.length) { body.append(statsEmpty("Список пока пуст")); return section; }
  body.append(el("div", { class: "seg", role: "img", "aria-label": data.categories.map((type) => `${type.label}: ${type.watched} из ${type.total}`).join(", ") },
    ...data.categories.filter((type) => type.total).map((type) => el("div", { class: "seg-part", style: `--c:${type.color || "var(--muted)"};flex:${type.total}`, title: `${type.label}: ${type.watched} из ${type.total}` }, el("i", { style: `width:${type.watched / type.total * 100}%` })))),
    el("div", { class: "cat-grid" }, ...data.categories.map((type) => el("div", { class: "cat-item" }, el("span", { class: "cat-name" }, el("i", { class: "sw", style: `background:${type.color || "var(--muted)"}` }), type.label), el("span", { class: "cnt" }, type.watched, el("small", { text: ` / ${type.total}` }))))));
  return section;
}

function renderStatsTop(data: Stats): HTMLElement {
  const { section, body } = statsSection("top", "Топ по средней оценке", "Только тайтлы, оценённые обоими");
  if (!data.top.length) { body.append(statsEmpty("Пока нет общих оценок")); return section; }
  body.style.setProperty("--top-rows", String(Math.ceil(data.top.length / 2)));
  data.top.forEach((item, index) => body.append(el("div", { class: "top-row" }, el("span", { class: "rank", text: index + 1 }),
    el("div", { class: "top-main" }, el("span", { class: "title", text: item.title, title: item.title }), statsBadge(item)),
    el("div", { class: "mini-pair", "aria-label": `S ${item.ratings.S}, L ${item.ratings.L}` }, ...PEOPLE.map((person) => el("div", { class: `mini ${person.toLowerCase()}`, "aria-hidden": "true" }, el("b", { text: person }), el("span", { class: "mini-bar" }, el("i", { style: `width:${item.ratings[person] * 10}%` })), el("span", { text: item.ratings[person] })))),
    el("span", { class: "avg", "aria-label": `средняя ${statsFmt((item.ratings.S + item.ratings.L) / 2)}`, text: statsFmt((item.ratings.S + item.ratings.L) / 2) }))));
  return section;
}

export function renderStats(): void {
  const box = byId("stats");
  box.textContent = "";
  if (state.loading) { box.append(el("div", { class: "state-msg", text: "Загрузка…" })); return; }
  if (state.error) { box.append(el("div", { class: "state-msg error", text: state.error })); return; }
  const items = state.data?.items || [], data = computeStats(items, getTypes());
  const tip = el("div", { class: "tip", role: "tooltip", hidden: true });
  const stack = el("div", { class: "stack" }, renderStatsHero(items, data), renderStatsHistogram(data, tip), renderStatsMonths(data, tip), renderStatsScatter(data, tip), renderStatsCategories(items, data), renderStatsTop(data),
    // Long lists go last so the compact charts stay on top; favorite and diffs share a row on wide screens.
    renderStatsFavorite(data), renderStatsDiffs(data), renderStatsGenres(data));
  box.append(el("div", { class: "stats-wrap" }, el("header", { class: "page-head" }, el("h1", { text: "Статистика" }), el("p", { text: `S и L · данные на ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}` })), stack), tip);
}
