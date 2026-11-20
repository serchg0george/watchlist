import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { closeEditors, rateItem, setStatus, toggleWatched } from "../../actions.js";
import { PEOPLE, STATUSES, STATUS_LABELS } from "../../config.js";
import type { Item, Status } from "../../domain/types.js";
import { collapsedCards, expandedOverviews, getTypeColor, getTypeLabel, openComments, render, selectedIds, state } from "../../state/store.js";
import { Comments } from "./Comments.js";
import { Editor } from "./Editor.js";
import { Stars } from "./Stars.js";

const STATUS_ICONS: Record<Status, string> = { planned: "↺", watching: "▶", watched: "✓", dropped: "✕" };

function toggleIn(set: Set<string>, id: string): void {
  if (set.has(id)) set.delete(id); else set.add(id);
  render();
}

// Watched cards show the full overview; other cards clamp it and show the toggle only when the text is cut off.
function Overview({ item, text, full }: { item: Item; text: string; full: boolean }) {
  const isExpanded = expandedOverviews.has(item.id);
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const node = paragraph.current;
    if (full || isExpanded || !node) return;
    setCut(node.scrollHeight > node.clientHeight + 1);
  });
  if (full) return <p className="catalog-overview">{text}</p>;
  return (
    <>
      <p ref={paragraph} className={`catalog-overview clamp${isExpanded ? " expanded" : ""}`}>{text}</p>
      <button type="button" className="link-btn overview-toggle" hidden={!isExpanded && !cut} onClick={() => toggleIn(expandedOverviews, item.id)}>{isExpanded ? "Свернуть" : "Ещё"}</button>
    </>
  );
}

function Poster({ path, title }: { path: string; title: string }) {
  const [failed, setFailed] = useState(false);
  return <img className="catalog-poster" src={`https://image.tmdb.org/t/p/w185${path}`} alt={`Постер: ${title}`} loading="lazy" width={92} height={138} hidden={failed} onError={() => setFailed(true)} />;
}

export function ItemRow({ item }: { item: Item }) {
  if (state.editingId === item.id && state.token) return <Editor item={item} />;

  const isFinished = item.status === "watched" || item.status === "dropped";
  const isWatched = item.status === "watched";
  const canEdit = !!state.token;
  const selecting = state.selecting;
  const isSelected = selecting && selectedIds.has(item.id);
  const collapsed = isWatched && collapsedCards.has(item.id);

  const head: ReactNode[] = [];
  const body: ReactNode[] = [];

  // Selection mode: a checkbox at the very start of the row.
  if (selecting) {
    head.push(
      <label key="select" className="select-wrap">
        <input type="checkbox" className="item-select" aria-label={`Выбрать: ${item.title}`} checked={isSelected}
          onChange={(e) => { if (e.target.checked) selectedIds.add(item.id); else selectedIds.delete(item.id); render(); }} />
      </label>
    );
  }
  // Checkbox: checked for watched/dropped.
  head.push(
    <label key="check" className="check-wrap">
      <input type="checkbox" className="item-check" aria-label={`Просмотрено: ${item.title}`} checked={isFinished} disabled={!canEdit || selecting} onChange={() => toggleWatched(item.id)} />
    </label>,
    <span key="title" className="item-title">{item.title}</span>,
    <span key="type" className="badge badge-type" style={{ "--cat-color": getTypeColor(item.type) } as CSSProperties}>{getTypeLabel(item.type)}</span>
  );
  if (item.status === "watching" || item.status === "dropped") {
    head.push(<span key="status" className={`badge badge-status-${item.status}`}>{STATUS_LABELS[item.status]}</span>);
  }
  if (isWatched) {
    head.push(<button key="collapse" type="button" className="link-btn card-toggle" aria-expanded={!collapsed} onClick={() => toggleIn(collapsedCards, item.id)}>{collapsed ? "Развернуть" : "Свернуть"}</button>);
  }

  if (item.note) body.push(<span key="note" className="item-note">{item.note}</span>);
  if (item.genres?.length) body.push(<span key="genres" className="item-genres">{item.genres.join(" · ")}</span>);
  const meta = item.tmdb;
  if (meta && ["movie", "tv"].includes(meta.mediaType) && Number.isSafeInteger(meta.id) && meta.id > 0) {
    head.push(<span key="meta" className="item-meta">{[meta.year, meta.runtime != null && meta.runtime > 0 ? `${meta.runtime} мин${meta.mediaType === "tv" ? " / серия" : ""}` : ""].filter(Boolean).join(" · ")}</span>);
    const poster = typeof meta.posterPath === "string" && /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(meta.posterPath) ? meta.posterPath : null;
    body.push(
      <div key="catalog" className="catalog-info">
        {poster && <Poster path={poster} title={item.title} />}
        <div className="catalog-description">
          <Overview item={item} text={meta.overview || "Описание пока отсутствует."} full={isWatched} />
          <a className="catalog-source" href={`https://www.themoviedb.org/${meta.mediaType}/${meta.id}`} target="_blank" rel="noopener noreferrer">Открыть в TMDB</a>
        </div>
      </div>
    );
  }
  const finishedAt = item.status === "dropped" ? item.droppedAt : item.status === "watched" ? item.watchedAt : null;
  if (finishedAt) head.push(<span key="date" className="item-date">{`${item.status === "dropped" ? "Брошено" : "Просмотрено"}: ${finishedAt.split("-").reverse().join(".")}`}</span>);

  // Each person rates only on their own line; the other line is read-only.
  if (isFinished) {
    body.push(
      <div key="ratings" className="ratings">
        {PEOPLE.map((p) => {
          const mine = canEdit && state.person === p;
          return (
            <div key={p} className={`rating-line person-${p.toLowerCase()}${mine ? " mine" : ""}`}>
              <span className="person-tag">{p}</span>
              <Stars person={p} value={item.ratings[p]} editable={mine} onRate={(value) => rateItem(item.id, p, value)} />
            </div>
          );
        })}
      </div>
    );
  }

  // Comments are expanded by default for finished items unless the user chose otherwise.
  const commentCount = PEOPLE.filter((p) => item.comments[p]).length + item.replies.length;
  const activeEditing = state.commentingId === item.id || state.replyDraft?.itemId === item.id || item.replies.some((r) => r.id === state.editingReplyId);
  const commentsExpanded = (openComments.get(item.id) ?? isFinished) || activeEditing;
  if (!activeEditing && (commentCount > 0 || canEdit)) {
    const label = commentsExpanded ? "Скрыть комментарии" : commentCount === 0 ? "💬 Комментировать" : `💬 Комментарии (${commentCount})`;
    body.push(<button key="comments-toggle" type="button" className="link-btn comments-toggle" aria-expanded={commentsExpanded} onClick={() => { openComments.set(item.id, !commentsExpanded); render(); }}>{label}</button>);
  }
  if (commentsExpanded && (commentCount > 0 || canEdit)) body.push(<Comments key="comments" item={item} canEdit={canEdit} />);

  return (
    <div className={`item-row${isSelected ? " selected" : ""}${state.highlightId === item.id ? " highlight" : ""}`} data-id={item.id}>
      {head}
      {!collapsed && body.length > 0 && <div className="item-body">{body}</div>}
      {canEdit && !selecting && (
        <div className="status-actions" role="group" aria-label="Статус">
          {STATUSES.map((s) => (
            <button key={s} type="button" className={`status-btn status-btn-${s}`} aria-pressed={item.status === s} onClick={() => setStatus(item.id, s)}>{`${STATUS_ICONS[s]} ${STATUS_LABELS[s]}`}</button>
          ))}
        </div>
      )}
      {canEdit && !selecting && (
        <button type="button" className="icon-btn edit-btn" aria-label="Редактировать" onClick={() => { closeEditors(); state.editingId = item.id; render(); }}>✎</button>
      )}
    </div>
  );
}
