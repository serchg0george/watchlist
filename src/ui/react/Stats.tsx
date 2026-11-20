import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { closeEditors, highlightItem, revealItem } from "../../actions.js";
import { PEOPLE } from "../../config.js";
import { MONTH_FULL, computeStats } from "../../domain/stats.js";
import type { Stats as StatsData } from "../../domain/stats.js";
import type { Item, Person, Status } from "../../domain/types.js";
import { getTypes, openComments, render, state } from "../../state/store.js";

// ===== Stats tab =====

const MONTH_NAMES = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function statsFmt(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(1).replace(".", ",");
}

const rating = (value: number): string => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

// Shared tooltip: one node, positioned next to the hovered/focused element.
type ShowTip = (anchor: Element, content: ReactNode) => void;
interface TipApi { show: ShowTip; hide: () => void }

function tipHandlers(tip: TipApi, content: () => ReactNode) {
  return {
    onPointerEnter: (e: PointerEvent<Element>) => tip.show(e.currentTarget, content()),
    onFocus: (e: FocusEvent<Element>) => tip.show(e.currentTarget, content()),
    onPointerLeave: tip.hide,
    onBlur: tip.hide
  };
}

function Tooltip({ anchor, content }: { anchor: Element | null; content: ReactNode }) {
  const node = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tip = node.current;
    if (!tip || !anchor) return;
    const bounds = anchor.getBoundingClientRect(), margin = 8;
    tip.style.left = `${Math.max(margin, Math.min(window.innerWidth - tip.offsetWidth - margin, bounds.left + bounds.width / 2 - tip.offsetWidth / 2))}px`;
    const top = bounds.top - tip.offsetHeight - margin;
    tip.style.top = `${Math.max(margin, Math.min(window.innerHeight - tip.offsetHeight - margin, top < margin ? bounds.bottom + margin : top))}px`;
  });
  return <div ref={node} className="tip" role="tooltip" hidden={!anchor}>{anchor ? content : null}</div>;
}

const Who = ({ person, text = person }: { person: Person; text?: string }) => <b className={`who ${person.toLowerCase()}`}>{text}</b>;

function Badge({ item }: { item: Item }) {
  const type = getTypes().find((t) => t.key === item.type);
  return <span className="badge" style={{ "--c": type?.color || "var(--muted)" } as CSSProperties}>{type?.label || item.type || "Без типа"}</span>;
}

const Empty = ({ text }: { text: string }) => <p className="empty">{text}</p>;

function Section({ id, title, note, bodyId = id, bodyStyle, children }: { id: string; title: string; note?: string | null; bodyId?: string; bodyStyle?: CSSProperties; children: ReactNode }) {
  return (
    <section className={`card sec-${id}`} aria-labelledby={`h-${id}`}>
      <h2 className="sec-title" id={`h-${id}`}>{title}</h2>
      {note ? <p className="sec-note">{note}</p> : null}
      <div className="sec-body" id={bodyId} style={bodyStyle}>{children}</div>
    </section>
  );
}

function Legend({ entries }: { entries: [string, string][] }) {
  return <div className="legend">{entries.map(([label, color]) => <span key={label}><i className="sw" style={{ background: color }} aria-hidden="true" />{label}</span>)}</div>;
}

function Chart({ width, height, label, interactive = false, children }: { width: number; height: number; label: string; interactive?: boolean; children: ReactNode }) {
  return <svg width="100%" viewBox={`0 0 ${width} ${height}`} role={interactive ? "group" : "img"} aria-label={label}>{children}</svg>;
}

function Hero({ items, data }: { items: Item[]; data: StatsData }) {
  const statuses: [Status, string, string][] = [
    ["watched", "Просмотрено", "var(--accent)"], ["watching", "Смотрим", "color-mix(in srgb,var(--accent) 50%,transparent)"],
    ["planned", "В планах", "var(--track)"], ["dropped", "Брошено", "var(--danger)"]
  ];
  let caption = "Для сравнения нужны оценки S и L";
  if (data.averages.S != null && data.averages.L != null) {
    const difference = data.averages.S - data.averages.L;
    caption = Math.abs(difference) < 0.05 ? "Поровну" : `${difference > 0 ? "S" : "L"} щедрее на ${statsFmt(Math.abs(difference))}`;
  }
  const circumference = 2 * Math.PI * 24;
  return (
    <section className="hero" aria-label="Главное">
      <div className="card hero-watched">
        <div className="kpi-label">Просмотрено</div>
        <div className="kpi">{data.statuses.watched}<small>{` из ${items.length}`}</small></div>
        {items.length ? (
          <>
            <div className="status-bar" role="img" aria-label={statuses.map(([key, label]) => `${label}: ${data.statuses[key]}`).join(", ")}>
              {statuses.filter(([key]) => data.statuses[key]).map(([key, label, color]) => <i key={key} style={{ flex: data.statuses[key], background: color }} title={`${label}: ${data.statuses[key]}`} />)}
            </div>
            <Legend entries={statuses.map(([key, label, color]): [string, string] => [`${label} ${data.statuses[key]}`, color])} />
          </>
        ) : <Empty text="Список пока пуст" />}
      </div>
      <div className="card hero-avg">
        <div className="kpi-label">Средняя оценка</div>
        {data.values.S.length || data.values.L.length ? (
          <>
            <div className="vs">
              <div className="vs-side s"><Who person="S" /><span className="kpi">{statsFmt(data.averages.S)}</span></div>
              <div className="vs-sep">vs</div>
              <div className="vs-side l"><Who person="L" /><span className="kpi">{statsFmt(data.averages.L)}</span></div>
            </div>
            <div className="avg-bars" aria-hidden="true">
              {PEOPLE.map((person) => <div key={person} className={`avg-bar ${person.toLowerCase()}`}><i style={{ width: `${(data.averages[person] || 0) * 10}%` }} /></div>)}
              <div className="avg-ticks">{[0, 5, 10].map((n) => <span key={n}>{n}</span>)}</div>
            </div>
            <div className="kpi-cap">{caption}</div>
          </>
        ) : <Empty text="Пока нет оценок" />}
        <div className="kpi-cap">{`Оценок: S ${data.values.S.length} · L ${data.values.L.length}`}</div>
      </div>
      <div className="card hero-match">
        <div className="kpi-label">Совпадение вкусов</div>
        {data.both.length ? (
          <>
            <div className="match">
              <svg width={60} height={60} viewBox="0 0 60 60" aria-hidden="true">
                <circle cx={30} cy={30} r={24} fill="none" stroke="var(--track)" strokeWidth={8} />
                <circle cx={30} cy={30} r={24} fill="none" stroke="var(--accent)" strokeWidth={8} strokeDasharray={`${circumference * data.close / data.both.length} ${circumference}`} transform="rotate(-90 30 30)" />
              </svg>
              <div className="kpi-m">{`${Math.round(data.close / data.both.length * 100)}%`}</div>
            </div>
            <div className="kpi-cap">{`${data.close} из ${data.both.length} общих оценок с разницей ≤ 1`}</div>
          </>
        ) : <Empty text="Пока нет общих оценок" />}
      </div>
      <div className="card hero-both">
        <div className="kpi-label">Оценили оба</div>
        <div className="kpi-m">{data.both.length}</div>
        <div className="kpi-cap">{`Совпали точно: ${data.exact}`}</div>
      </div>
    </section>
  );
}

function Histogram({ data, tip }: { data: StatsData; tip: TipApi }) {
  const mode = (person: Person): number => data.counts[person].indexOf(Math.max(...data.counts[person]));
  const phrases = PEOPLE.filter((person) => data.values[person].length).map((person, i) => `${person}${i ? " —" : " ставит"} ${mode(person)}`);
  if (!phrases.length) return <Section id="hist" title="Распределение оценок"><Empty text="Пока нет оценок" /></Section>;
  const max = Math.max(...data.counts.S, ...data.counts.L), step = max <= 4 ? 1 : Math.ceil(max / 4), ceiling = Math.ceil(max / step) * step;
  const y = (n: number): number => 182 - n / ceiling * 160;
  const grid: ReactNode[] = [];
  for (let n = 0; n <= ceiling; n += step) grid.push(<line key={`g${n}`} className="grid" x1={26} x2={438} y1={y(n)} y2={y(n)} />, <text key={`t${n}`} className="ax" x={18} y={y(n) + 4} textAnchor="end">{n}</text>);
  const columns: ReactNode[] = [];
  for (let r = 1; r <= 10; r++) {
    const cx = 26 + (r - 0.5) * 41.2;
    columns.push(
      <g key={r} className="col" tabIndex={0} aria-label={`Оценка ${r}: S ${data.counts.S[r]}, L ${data.counts.L[r]}`}
        {...tipHandlers(tip, () => <><div className="tip-h">{`Оценка ${r}`}</div>{PEOPLE.map((person) => <div key={person} className="tip-row"><Who person={person} />{`${data.counts[person][r]} тайтлов`}</div>)}</>)}
        onKeyDown={(e: KeyboardEvent) => { if (e.key === "Escape") tip.hide(); }}>
        <rect className="col-bg" x={cx - 19} y={4} width={38} height={198} rx={6} />
        {PEOPLE.map((person, index) => {
          const count = data.counts[person][r] ?? 0, x = cx + (index ? 1 : -15);
          return count ? (
            <g key={person}>
              <rect x={x} y={y(count)} width={14} height={182 - y(count)} rx={3} fill={`var(--${person.toLowerCase()})`} />
              <text className="val" x={x + 7} y={y(count) - 5} textAnchor="middle" fill={`var(--${person.toLowerCase()})`}>{count}</text>
            </g>
          ) : null;
        })}
        <text className="ax-strong" x={cx} y={201} textAnchor="middle">{r}</text>
      </g>
    );
  }
  return (
    <Section id="hist" title="Распределение оценок" note={`Чаще всего ${phrases.join(", ")}`}>
      <Legend entries={[["S", "var(--s)"], ["L", "var(--l)"]]} />
      <div className="chart">
        <Chart width={440} height={220} label="Распределение оценок S и L, округление вниз до целого">
          {grid}{columns}
          <text className="ax" x={232} y={218} textAnchor="middle">оценка</text>
        </Chart>
      </div>
    </Section>
  );
}

function Months({ data, tip }: { data: StatsData; tip: TipApi }) {
  const total = data.months.reduce((sum, month) => sum + month.count, 0);
  const best = data.months.reduce((a, b) => b.count > a.count ? b : a);
  const note = total ? `${total} за 12 месяцев · больше всего — ${MONTH_FULL[best.month]} (${best.count}) · текущий месяц ещё идёт` : "Последние 12 календарных месяцев · текущий месяц ещё идёт";
  if (!total) return <Section id="months" title="Просмотрено по месяцам" note={note}><Empty text="За последние 12 месяцев ничего не просмотрено" /></Section>;
  const max = Math.max(...data.months.map((month) => month.count));
  return (
    <Section id="months" title="Просмотрено по месяцам" note={note}>
      <div className="chart">
        <Chart width={440} height={220} label="Просмотрено за последние 12 календарных месяцев">
          <line className="grid" x1={2} x2={438} y1={192} y2={192} />
          {data.months.map((month, index) => {
            const x = 2 + (index + 0.5) * 436 / 12, height = month.count / max * 168;
            return (
              <g key={`${month.year}-${month.month}`} className="col" tabIndex={0} aria-label={`${MONTH_FULL[month.month]} ${month.year}: ${month.count}`}
                {...tipHandlers(tip, () => <><div className="tip-h">{`${MONTH_FULL[month.month]} ${month.year}`}</div>{month.items.length ? month.items.map((item) => <div key={item.id} className="tip-row">{item.title}</div>) : <div className="tip-sub">Ничего не просмотрено</div>}</>)}
                onKeyDown={(e: KeyboardEvent) => { if (e.key === "Escape") tip.hide(); }}>
                <rect className="col-bg" x={x - 17} y={4} width={34} height={214} rx={6} />
                <rect x={x - 11} y={month.count ? 192 - height : 190} width={22} height={month.count ? height : 2} rx={3} fill={month.count ? "var(--accent)" : "var(--track)"} fillOpacity={index === 11 ? 0.55 : 1} />
                <text className="val" x={x} y={month.count ? 187 - height : 183} textAnchor="middle" fill="var(--text)">{month.count}</text>
                <text className={index === 11 ? "ax-strong" : "ax"} x={x} y={212} textAnchor="middle">{MONTH_NAMES[month.month]}</text>
              </g>
            );
          })}
        </Chart>
      </div>
    </Section>
  );
}

function Scatter({ data, tip }: { data: StatsData; tip: TipApi }) {
  const [selected, setSelected] = useState<string | null>(null);
  const title = "S против L", note = "Каждая точка — тайтл, оценённый обоими. Нажмите на точку, чтобы увидеть названия.";
  if (!data.both.length) return <Section id="scatter" title={title} note={note}><Empty text="Пока нет общих оценок" /></Section>;
  const x = (value: number): number => 30 + (value - 0.5) * 40, y = (value: number): number => 404 - (value - 0.5) * 39.4;
  const band: [number, number][] = [[0.5, 1.5], [9.5, 10.5], [10.5, 10.5], [10.5, 9.5], [1.5, 0.5], [0.5, 0.5]];
  const grid: ReactNode[] = [];
  for (let r = 1; r <= 10; r++) grid.push(
    <line key={`v${r}`} className="grid" x1={x(r)} x2={x(r)} y1={10} y2={404} />, <line key={`h${r}`} className="grid" x1={30} x2={430} y1={y(r)} y2={y(r)} />,
    <text key={`x${r}`} className="ax-strong" x={x(r)} y={420} textAnchor="middle">{r}</text>, <text key={`y${r}`} className="ax-strong" x={22} y={y(r) + 4} textAnchor="end">{r}</text>);
  const groups = [...data.groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const chosen = selected ? data.groups.get(selected) : undefined;
  const chosenFirst = chosen?.[0];
  return (
    <Section id="scatter" title={title} note={note}>
      <div className="chart scatter-box">
        <Chart width={440} height={440} label="Оценка S по горизонтали, оценка L по вертикали. Выберите точку, чтобы увидеть тайтлы" interactive>
          <polygon points={band.map(([s, l]) => `${x(s)},${y(l)}`).join(" ")} fill="var(--accent)" fillOpacity={0.1} />
          {grid}
          <line x1={x(0.5)} x2={x(10.5)} y1={y(0.5)} y2={y(10.5)} stroke="var(--muted)" strokeDasharray="5 5" />
          <text className="ax" x={150} y={265} transform="rotate(-45 150 265)" textAnchor="middle">согласны · ±1</text>
          <text x={x(1)} y={y(10)} fill="var(--l)" fontSize={12} fontWeight={600}>L выше</text>
          <text x={x(10)} y={y(1)} fill="var(--s)" fontSize={12} fontWeight={600} textAnchor="end">S выше</text>
          <text className="ax" x={230} y={438} textAnchor="middle">оценка S →</text>
          <text className="ax" transform="translate(9 207) rotate(-90)" textAnchor="middle">оценка L →</text>
          {groups.map(([key, items]) => {
            const first = items[0];
            if (!first) return null;
            const { S: s, L: l } = first.ratings, color = s > l ? "var(--s)" : l > s ? "var(--l)" : "var(--accent)";
            const select = (): void => { tip.hide(); setSelected(key); };
            return (
              <g key={key} className="pt" tabIndex={0} role="button" aria-label={`S ${rating(s)}, L ${rating(l)}: ${items.map((item) => item.title).join(", ")}. Показать тайтлы`}
                aria-controls="scatter-detail" aria-expanded={selected === key} fillOpacity={0.5}
                {...tipHandlers(tip, () => items.map((item) => <div key={item.id} className="tip-row"><span>{item.title}</span><span className="tip-r"><Who person="S" text={`S ${rating(s)}`} /><Who person="L" text={`L ${rating(l)}`} /></span></div>))}
                onClick={select}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
                  else if (e.key === "Escape") tip.hide();
                }}>
                <circle cx={x(s)} cy={y(l)} r={Math.min(18, 7 + (items.length - 1) * 4)} fill={color} stroke={color} strokeWidth={1.5} />
                {items.length > 1 && <text x={x(s)} y={y(l) + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--text)" fillOpacity={1}>{items.length}</text>}
              </g>
            );
          })}
        </Chart>
      </div>
      <Legend entries={[["S выше", "var(--s)"], ["L выше", "var(--l)"], ["поровну", "var(--accent)"]]} />
      <p className="sec-note">Размер и число — сколько тайтлов</p>
      <div className="scatter-detail" id="scatter-detail" hidden={!chosenFirst} role="region" aria-label="Выбранные тайтлы" aria-live="polite">
        {chosen && chosenFirst && (
          <>
            <div className="scatter-detail-head"><Who person="S" text={`S ${rating(chosenFirst.ratings.S)}`} /><Who person="L" text={`L ${rating(chosenFirst.ratings.L)}`} /></div>
            <div className="scatter-detail-list">{chosen.map((item) => <div key={item.id} className="scatter-detail-item"><span className="title">{item.title}</span><Badge item={item} /></div>)}</div>
          </>
        )}
      </div>
    </Section>
  );
}

// Opens the item in its list tab with comments expanded, scrolls to it and focuses it.
function ItemButton({ item }: { item: Item }) {
  return (
    <button type="button" className="title stats-title-button" title={item.title} aria-label={`Открыть обсуждение: ${item.title}`} onClick={() => {
      closeEditors();
      state.tab = item.status === "watched" || item.status === "dropped" ? item.status : "list";
      state.statusFilter = item.status === "watching" ? "watching" : "all";
      state.typeFilter = "all";
      state.search = "";
      highlightItem(item.id);
      openComments.set(item.id, true);
      render();
      revealItem(item.id, true);
    }}>{item.title}</button>
  );
}

function Genres({ data }: { data: StatsData }) {
  const title = "Совпадение по жанрам", note = "Только просмотренное. Один тайтл может входить в несколько жанров.";
  if (!data.genres.length) return <Section id="genres" title={title} note={note}><Empty text="Добавьте жанры в редакторе просмотренных тайтлов — здесь появится сравнение ваших вкусов." /></Section>;
  return (
    <Section id="genres" title={title} note={note}>
      <div className="genre-grid">
        {data.genres.map((genre) => (
          <article key={genre.label} className="genre-card">
            <div className="genre-head"><h3>{genre.label}</h3><span className="genre-count">{`Просмотрено: ${genre.count}`}</span></div>
            <div className="genre-ratings">
              {PEOPLE.map((person) => (
                <div key={person} className="genre-rating">
                  <Who person={person} /><strong>{statsFmt(genre.people[person].average)}</strong>
                  <span className="genre-count">{`оценок: ${genre.people[person].count}`}</span>
                </div>
              ))}
            </div>
            <div className="genre-agreement">
              <strong>{genre.agreement == null ? "Пока не сравнить" : `${Math.round(genre.agreement)}% совпадения`}</strong>
              <span className="genre-count">{`Оценили оба: ${genre.paired}`}</span>
            </div>
            {genre.agreement != null && <div className="genre-meter" aria-hidden="true"><i style={{ width: `${genre.agreement}%` }} /></div>}
            {genre.paired < 3 && <p className="sec-note">{genre.paired ? "Пока мало совместных оценок — результат предварительный." : "Нужны оценки обоих на одни и те же тайтлы."}</p>}
          </article>
        ))}
      </div>
      <p className="sec-note genre-formula">Средние оценки S и L учитывают все их оценки в жанре. Совпадение = 100 × (1 − средняя разница общих оценок / 9,5): одинаковые оценки дают 100%, разница в 9,5 балла — 0%.</p>
    </Section>
  );
}

function Favorite({ data }: { data: StatsData }) {
  const favorite = data.favoriteMonth;
  const title = "Фаворит месяца", note = `${favorite.label} · по средней оценке двоих`;
  if (!favorite.items.length) return <Section id="favorite" title={title} note={note}><Empty text="В этом месяце пока нет просмотренных тайтлов с датой и оценками обоих." /></Section>;
  return (
    <Section id="favorite" title={title} note={note}>
      <p className="sec-note">{`Тайтлов с двумя оценками за месяц: ${favorite.count}${favorite.items.length > 1 ? ". Первое место разделили:" : ""}`}</p>
      {favorite.items.map((item) => (
        <div key={item.id} className="favorite-row">
          <div className="favorite-main"><ItemButton item={item} /><Badge item={item} /></div>
          <div className="pair"><Who person="S" text={`S ${rating(item.ratings.S)}`} /><Who person="L" text={`L ${rating(item.ratings.L)}`} /></div>
          <strong className="favorite-score" aria-label={`Средняя оценка ${statsFmt((item.ratings.S + item.ratings.L) / 2)}`}>{statsFmt((item.ratings.S + item.ratings.L) / 2)}</strong>
        </div>
      ))}
    </Section>
  );
}

function Diffs({ data }: { data: StatsData }) {
  const title = "Самые спорные просмотры", note = "Пять самых больших расхождений среди просмотренного. Нажмите на название, чтобы открыть обсуждение.";
  if (!data.diffs.length) return <Section id="diff" bodyId="diffs" title={title} note={note}><Empty text="Пока нет просмотренных тайтлов с разными оценками обоих." /></Section>;
  const position = (value: number): number => (value - 0.5) / 9.5 * 100;
  const ticks = Array.from({ length: 10 }, (_, i) => i + 1);
  return (
    <Section id="diff" bodyId="diffs" title={title} note={note}>
      {data.diffs.map((item) => {
        const { S: s, L: l } = item.ratings;
        const delta = rating(Math.abs(s - l));
        return (
          <div key={item.id} className="row">
            <div className="row-head">
              <ItemButton item={item} />
              <span className="pair"><Who person="S" text={`S ${rating(s)}`} /><Who person="L" text={`L ${rating(l)}`} /></span>
              <span className="delta" aria-label={`разница ${delta}`}>{`Δ ${delta}`}</span>
            </div>
            <div className="scale" aria-hidden="true">
              <div className="scale-track" />
              {ticks.map((value) => <i key={value} className="scale-tick" style={{ left: `${position(value)}%` }} />)}
              <i className="scale-line" style={{ left: `${position(Math.min(s, l))}%`, width: `${Math.abs(s - l) / 9.5 * 100}%`, background: `linear-gradient(90deg,var(--${s <= l ? "s" : "l"}),var(--${s <= l ? "l" : "s"}))` }} />
              <span className="dot s" style={{ left: `${position(s)}%` }}>S</span>
              <span className="dot l" style={{ left: `${position(l)}%` }}>L</span>
            </div>
          </div>
        );
      })}
      <div className="scale-axis" aria-hidden="true">{ticks.map((value) => <span key={value} style={{ left: `${position(value)}%` }}>{value}</span>)}</div>
    </Section>
  );
}

function Categories({ items, data }: { items: Item[]; data: StatsData }) {
  const title = "По типам", note = "Длина отрезка — всего в списке, заливка — просмотрено";
  if (!items.length) return <Section id="cats" title={title} note={note}><Empty text="Список пока пуст" /></Section>;
  return (
    <Section id="cats" title={title} note={note}>
      <div className="seg" role="img" aria-label={data.categories.map((type) => `${type.label}: ${type.watched} из ${type.total}`).join(", ")}>
        {data.categories.filter((type) => type.total).map((type) => (
          <div key={type.key} className="seg-part" style={{ "--c": type.color || "var(--muted)", flex: type.total } as CSSProperties} title={`${type.label}: ${type.watched} из ${type.total}`}>
            <i style={{ width: `${type.watched / type.total * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="cat-grid">
        {data.categories.map((type) => (
          <div key={type.key} className="cat-item">
            <span className="cat-name"><i className="sw" style={{ background: type.color || "var(--muted)" }} />{type.label}</span>
            <span className="cnt">{type.watched}<small>{` / ${type.total}`}</small></span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Top({ data }: { data: StatsData }) {
  const title = "Топ по средней оценке", note = "Только тайтлы, оценённые обоими";
  if (!data.top.length) return <Section id="top" title={title} note={note}><Empty text="Пока нет общих оценок" /></Section>;
  return (
    <Section id="top" title={title} note={note} bodyStyle={{ "--top-rows": String(Math.ceil(data.top.length / 2)) } as CSSProperties}>
      {data.top.map((item, index) => (
        <div key={item.id} className="top-row">
          <span className="rank">{index + 1}</span>
          <div className="top-main"><span className="title" title={item.title}>{item.title}</span><Badge item={item} /></div>
          <div className="mini-pair" aria-label={`S ${rating(item.ratings.S)}, L ${rating(item.ratings.L)}`}>
            {PEOPLE.map((person) => (
              <div key={person} className={`mini ${person.toLowerCase()}`} aria-hidden="true">
                <b>{person}</b><span className="mini-bar"><i style={{ width: `${item.ratings[person] * 10}%` }} /></span><span>{rating(item.ratings[person])}</span>
              </div>
            ))}
          </div>
          <span className="avg" aria-label={`средняя ${statsFmt((item.ratings.S + item.ratings.L) / 2)}`}>{statsFmt((item.ratings.S + item.ratings.L) / 2)}</span>
        </div>
      ))}
    </Section>
  );
}

export function Stats({ hidden }: { hidden: boolean }) {
  const [view, setView] = useState<"overview" | "genres">("overview");
  const [tipState, setTipState] = useState<{ anchor: Element | null; content: ReactNode }>({ anchor: null, content: null });
  const tip: TipApi = {
    show: (anchor, content) => setTipState({ anchor, content }),
    hide: () => setTipState((current) => current.anchor ? { anchor: null, content: null } : current)
  };
  let body: ReactNode;
  if (state.loading) body = <div className="state-msg">Загрузка…</div>;
  else if (state.error) body = <div className="state-msg error">{state.error}</div>;
  else if (!hidden) {
    const items = state.data?.items || [], data = computeStats(items, getTypes());
    // Overview: hero, histogram, months, scatter, categories, top, favorite, diffs. Genres: its own sub-tab.
    body = (
      <>
        <div className="stats-wrap">
          <header className="page-head">
            <h1>Статистика</h1>
            <p>{`S и L · данные на ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`}</p>
          </header>
          <div className="chips stats-views" role="tablist" aria-label="Разделы статистики">
            <button
              type="button"
              role="tab"
              className={`chip${view === "overview" ? " active" : ""}`}
              aria-selected={view === "overview"}
              aria-controls="stats-panel"
              onClick={() => { setView("overview"); tip.hide(); }}
            >
              Обзор
            </button>
            <button
              type="button"
              role="tab"
              className={`chip${view === "genres" ? " active" : ""}`}
              aria-selected={view === "genres"}
              aria-controls="stats-panel"
              onClick={() => { setView("genres"); tip.hide(); }}
            >
              Совпадение по жанрам
            </button>
          </div>
          <div id="stats-panel" role="tabpanel" className={`stack${view === "genres" ? " stack-genres" : ""}`}>
            {view === "overview" ? (
              <>
                <Hero items={items} data={data} />
                <Histogram data={data} tip={tip} />
                <Months data={data} tip={tip} />
                <Scatter data={data} tip={tip} />
                <Categories items={items} data={data} />
                <Top data={data} />
                <Favorite data={data} />
                <Diffs data={data} />
              </>
            ) : (
              <Genres data={data} />
            )}
          </div>
        </div>
        <Tooltip anchor={tipState.anchor} content={tipState.content} />
      </>
    );
  }
  return (
    <section id="stats-tab" className="tab-panel" hidden={hidden}>
      <div id="stats" className="stats">{body}</div>
    </section>
  );
}
