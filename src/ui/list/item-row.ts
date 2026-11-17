import { closeEditors, rateItem, toggleWatched } from "../../actions.js";
import { PEOPLE, STATUS_LABELS } from "../../config.js";
import type { Item } from "../../domain/types.js";
import { expandedOverviews, openComments, render, state, getTypeColor, getTypeLabel } from "../../state/store.js";
import { el } from "../dom.js";
import { buildComments } from "./comments.js";
import { buildEditor } from "./editor.js";

export function buildItemRow(item: Item): HTMLElement {
  if (state.editingId === item.id && state.token) return buildEditor(item);

  const isFinished = item.status === "watched" || item.status === "dropped";
  const canEdit = !!state.token;

  // Checkbox: checked for watched/dropped.
  const cb = el("input", { type: "checkbox", class: "item-check", "aria-label": `Просмотрено: ${item.title}` });
  cb.checked = isFinished;
  if (!canEdit) cb.disabled = true;
  cb.addEventListener("change", () => toggleWatched(item.id));

  const children: HTMLElement[] = [el("label", { class: "check-wrap" }, cb)];
  children.push(el("span", { class: "item-title", text: item.title }));
  const typeColor = getTypeColor(item.type);
  children.push(el("span", { class: "badge badge-type", style: `--cat-color: ${typeColor}`, text: getTypeLabel(item.type) }));

  if (item.status === "watching" || item.status === "dropped") {
    children.push(el("span", { class: `badge badge-status-${item.status}`, text: STATUS_LABELS[item.status] }));
  }
  const body = el("div", { class: "item-body" });
  if (item.note) body.append(el("span", { class: "item-note", text: item.note }));
  if (item.genres?.length) body.append(el("span", { class: "item-genres", text: item.genres.join(" · ") }));
  if (item.tmdb && ["movie", "tv"].includes(item.tmdb.mediaType) && Number.isSafeInteger(item.tmdb.id) && item.tmdb.id > 0) {
    const meta = item.tmdb;
    children.push(el("span", { class: "item-meta", text: [meta.year, meta.runtime != null && meta.runtime > 0 ? `${meta.runtime} мин${meta.mediaType === "tv" ? " / серия" : ""}` : ""].filter(Boolean).join(" · ") }));
    const info = el("div", { class: "catalog-info" });
    if (typeof meta.posterPath === "string" && /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(meta.posterPath)) {
      const image = el("img", { class: "catalog-poster", src: `https://image.tmdb.org/t/p/w185${meta.posterPath}`, alt: `Постер: ${item.title}`, loading: "lazy", width: 92, height: 138 });
      image.addEventListener("error", () => { image.hidden = true; });
      info.append(image);
    }
    const overviewText = meta.overview || "Описание пока отсутствует.";
    const isClamped = overviewText.length > 220;
    const isExpanded = expandedOverviews.has(item.id);
    const descriptionChildren: HTMLElement[] = [el("p", { class: `catalog-overview${isClamped ? " clamp" : ""}${isClamped && isExpanded ? " expanded" : ""}`, text: overviewText })];
    if (isClamped) {
      const toggle = el("button", { type: "button", class: "link-btn overview-toggle", text: isExpanded ? "Свернуть" : "Ещё" });
      toggle.addEventListener("click", () => { if (expandedOverviews.has(item.id)) expandedOverviews.delete(item.id); else expandedOverviews.add(item.id); render(); });
      descriptionChildren.push(toggle);
    }
    info.append(el("div", { class: "catalog-description" }, ...descriptionChildren,
      el("a", { class: "catalog-source", href: `https://www.themoviedb.org/${meta.mediaType}/${meta.id}`, target: "_blank", rel: "noopener noreferrer", text: "Открыть в TMDB" })));
    body.append(info);
  }
  const finishedAt = item.status === "dropped" ? item.droppedAt : item.status === "watched" ? item.watchedAt : null;
  if (finishedAt) children.push(el("span", { class: "item-date", text: `${item.status === "dropped" ? "Брошено" : "Просмотрено"}: ${finishedAt.split("-").reverse().join(".")}` }));

  // Each person rates only on their own line; the other line is read-only.
  if (isFinished) {
    const ratings = el("div", { class: "ratings" });
    for (const p of PEOPLE) {
      const value = item.ratings[p];
      const mine = canEdit && state.person === p;
      const line = el("div", { class: `rating-line person-${p.toLowerCase()}${mine ? " mine" : ""}` },
        el("span", { class: "person-tag", text: p }));
      const stars = el("span", { class: "stars" });
      for (let i = 1; i <= 10; i++) {
        const on = value != null && i <= value;
        if (mine) {
          const s = el("button", { type: "button", class: `star${on ? " on" : ""}`, text: on ? "★" : "☆", "aria-label": `${p}: ${i} из 10` });
          s.addEventListener("click", () => rateItem(item.id, p, i));
          stars.append(s);
        } else {
          stars.append(el("span", { class: `star static${on ? " on" : ""}`, text: on ? "★" : "☆" }));
        }
      }
      line.append(stars, el("span", { class: "rating-value", text: value != null ? String(value) : "—" }));
      ratings.append(line);
    }
    body.append(ratings);
  }

  // Comments are expanded by default for finished items unless the user chose otherwise.
  const commentCount = PEOPLE.filter((p) => item.comments[p]).length + item.replies.length;
  const activeEditing = state.commentingId === item.id || state.replyDraft?.itemId === item.id || item.replies.some((r) => r.id === state.editingReplyId);
  const commentsExpanded = (openComments.get(item.id) ?? isFinished) || activeEditing;
  if (!activeEditing && (commentCount > 0 || canEdit)) {
    const toggleText = commentsExpanded ? "Скрыть комментарии" : commentCount === 0 ? "💬 Комментировать" : `💬 Комментарии (${commentCount})`;
    const commentsToggle = el("button", { type: "button", class: "link-btn comments-toggle", "aria-expanded": String(commentsExpanded), text: toggleText });
    commentsToggle.addEventListener("click", () => { openComments.set(item.id, !commentsExpanded); render(); });
    body.append(commentsToggle);
  }
  if (commentsExpanded) {
    const comments = buildComments(item, canEdit);
    if (comments.children.length > 0) body.append(comments);
  }

  if (body.children.length > 0) children.push(body);

  if (canEdit) {
    const editBtn = el("button", { type: "button", class: "icon-btn edit-btn", text: "✎", "aria-label": "Редактировать" });
    editBtn.addEventListener("click", () => { closeEditors(); state.editingId = item.id; render(); });
    children.push(editBtn);
  }

  return el("div", { class: `item-row${state.highlightId === item.id ? " highlight" : ""}`, "data-id": item.id }, ...children);
}
