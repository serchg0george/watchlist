import { closeEditors, rateItem, setStatus, toggleWatched } from "../../actions.js";
import { PEOPLE, STATUSES, STATUS_LABELS } from "../../config.js";
import type { Item, Status } from "../../domain/types.js";
import { collapsedCards, expandedOverviews, openComments, render, selectedIds, state, getTypeColor, getTypeLabel } from "../../state/store.js";
import { el } from "../dom.js";
import { buildComments } from "./comments.js";
import { buildEditor } from "./editor.js";

const STATUS_ICONS: Record<Status, string> = { planned: "↺", watching: "▶", watched: "✓", dropped: "✕" };

export function buildItemRow(item: Item): HTMLElement {
  if (state.editingId === item.id && state.token) return buildEditor(item);

  const isFinished = item.status === "watched" || item.status === "dropped";
  const canEdit = !!state.token;
  const selecting = state.selecting;
  const isSelected = selecting && selectedIds.has(item.id);

  // Check if the card is collapsed (for watched items only)
  const isWatched = item.status === "watched";
  const collapsed = isWatched && collapsedCards.has(item.id);

  // Checkbox: checked for watched/dropped.
  const cb = el("input", { type: "checkbox", class: "item-check", "aria-label": `Просмотрено: ${item.title}` });
  cb.checked = isFinished;
  if (!canEdit || selecting) cb.disabled = true;
  cb.addEventListener("change", () => toggleWatched(item.id));

  const children: HTMLElement[] = [];
  // Selection mode: a checkbox at the very start of the row.
  if (selecting) {
    const selInput = el("input", { type: "checkbox", class: "item-select", "aria-label": `Выбрать: ${item.title}` });
    selInput.checked = isSelected;
    selInput.addEventListener("change", () => {
      if (selInput.checked) selectedIds.add(item.id); else selectedIds.delete(item.id);
      render();
    });
    children.push(el("label", { class: "select-wrap" }, selInput));
  }
  children.push(el("label", { class: "check-wrap" }, cb));
  children.push(el("span", { class: "item-title", text: item.title }));
  const typeColor = getTypeColor(item.type);
  children.push(el("span", { class: "badge badge-type", style: `--cat-color: ${typeColor}`, text: getTypeLabel(item.type) }));

  if (item.status === "watching" || item.status === "dropped") {
    children.push(el("span", { class: `badge badge-status-${item.status}`, text: STATUS_LABELS[item.status] }));
  }

  // Add the collapse toggle for watched items
  if (isWatched) {
    const toggleText = collapsed ? "Развернуть" : "Свернуть";
    const toggleButton = el("button", {
      type: "button",
      class: "link-btn card-toggle",
      "aria-expanded": String(!collapsed),
      text: toggleText
    });
    toggleButton.addEventListener("click", () => {
      if (collapsed) {
        collapsedCards.delete(item.id);
      } else {
        collapsedCards.add(item.id);
      }
      render();
    });
    children.push(toggleButton);
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
    const isExpanded = expandedOverviews.has(item.id);
    // Watched cards show the full overview; other cards clamp it and show the toggle only when the text is cut off.
    const overview = el("p", { class: isWatched ? "catalog-overview" : `catalog-overview clamp${isExpanded ? " expanded" : ""}`, text: overviewText });
    const descriptionChildren: HTMLElement[] = [overview];
    if (!isWatched) {
      const toggle = el("button", { type: "button", class: "link-btn overview-toggle", hidden: !isExpanded, text: isExpanded ? "Свернуть" : "Ещё" });
      toggle.addEventListener("click", () => { if (expandedOverviews.has(item.id)) expandedOverviews.delete(item.id); else expandedOverviews.add(item.id); render(); });
      if (!isExpanded) requestAnimationFrame(() => { if (overview.isConnected && overview.scrollHeight > overview.clientHeight + 1) toggle.hidden = false; });
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
    const fmt = (v: number): string => v.toLocaleString("ru-RU");
    for (const p of PEOPLE) {
      const value = item.ratings[p];
      const mine = canEdit && state.person === p;
      const line = el("div", { class: `rating-line person-${p.toLowerCase()}${mine ? " mine" : ""}` },
        el("span", { class: "person-tag", text: p }));
      const stars = el("span", { class: "stars" });
      for (let i = 1; i <= 10; i++) {
        // Full when the star is at or below the value, half when it sits exactly on a half-step.
        const fill = value == null ? "" : i - 0.5 === value ? "half" : i <= value ? "on" : "";
        if (mine) {
          const s = el("span", { class: `star${fill ? ` ${fill}` : ""}`, text: fill === "" ? "☆" : "★" });
          // Two transparent halves over the glyph: left rates i - 0.5, right rates i.
          const left = el("button", { type: "button", class: "star-half star-half-left", "aria-label": `${p}: ${fmt(i - 0.5)} из 10` });
          left.addEventListener("click", () => rateItem(item.id, p, i - 0.5));
          const right = el("button", { type: "button", class: "star-half star-half-right", "aria-label": `${p}: ${fmt(i)} из 10` });
          right.addEventListener("click", () => rateItem(item.id, p, i));
          s.append(left, right);
          stars.append(s);
        } else {
          stars.append(el("span", { class: `star static${fill ? ` ${fill}` : ""}`, text: fill === "" ? "☆" : "★" }));
        }
      }
      line.append(stars, el("span", { class: "rating-value", text: value != null ? fmt(value) : "—" }));
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

  // Only render the body if not collapsed
  if (!collapsed && body.children.length > 0) children.push(body);

  // Status buttons take their own full-width line below the body.
  if (canEdit && !selecting) {
    const statusActions = el("div", { class: "status-actions", role: "group", "aria-label": "Статус" });
    for (const s of STATUSES) {
      const btn = el("button", { type: "button", class: `status-btn status-btn-${s}`, "aria-pressed": String(item.status === s), text: `${STATUS_ICONS[s]} ${STATUS_LABELS[s]}` });
      btn.addEventListener("click", () => setStatus(item.id, s));
      statusActions.append(btn);
    }
    children.push(statusActions);
  }

  if (canEdit && !selecting) {
    const editBtn = el("button", { type: "button", class: "icon-btn edit-btn", text: "✎", "aria-label": "Редактировать" });
    editBtn.addEventListener("click", () => { closeEditors(); state.editingId = item.id; render(); });
    children.push(editBtn);
  }

  return el("div", { class: `item-row${isSelected ? " selected" : ""}${state.highlightId === item.id ? " highlight" : ""}`, "data-id": item.id }, ...children);
}
