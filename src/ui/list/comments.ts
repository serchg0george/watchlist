import { addReply, closeEditors, deleteReply, editReply, reactToComment, setComment } from "../../actions.js";
import { PEOPLE, REACTION_KINDS } from "../../config.js";
import { isPerson } from "../../domain/guards.js";
import type { Item, Person, Reply } from "../../domain/types.js";
import { clearDraftAfterSave, draftKey, readDraft, writeDraft } from "../../state/saving.js";
import { render, state } from "../../state/store.js";
import { el } from "../dom.js";

export function buildCommentEditor(person: Person | "", text: string, save: (text: string) => void, label: string): HTMLElement {
  const identity = state.editingReplyId ? `edit-${state.editingReplyId}` : state.replyDraft ? `reply-${state.replyDraft.itemId}-${state.replyDraft.to}` : `comment-${state.commentingId}-${person}`;
  const key = draftKey("comment", identity);
  const ta = el("textarea", { class: "comment-input", rows: 2, placeholder: label, "aria-label": label });
  const draftText = readDraft(key)?.text;
  ta.value = typeof draftText === "string" ? draftText : text;
  ta.addEventListener("input", () => writeDraft(key, { text: ta.value }));
  const submit = () => {
    const snapshot = { text: ta.value };
    writeDraft(key, snapshot);
    save(ta.value.trim());
    clearDraftAfterSave(key, snapshot);
  };
  const cancel = () => { closeEditors(); render(); };
  const saveBtn = el("button", { type: "button", class: "btn btn-primary", text: "Сохранить" });
  const cancelBtn = el("button", { type: "button", class: "btn", text: "Отмена" });
  saveBtn.addEventListener("click", submit);
  cancelBtn.addEventListener("click", cancel);
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  const editor = el("div", { class: `comment-line person-${person.toLowerCase()} mine` },
    el("span", { class: "person-tag", text: person }), ta,
    el("div", { class: "comment-actions" }, saveBtn, cancelBtn));
  setTimeout(() => { if (ta.isConnected) ta.focus(); }, 0);
  return editor;
}

export function buildCommentActions(item: Item, target: string, author: Person, canEdit: boolean, isReply: boolean): HTMLElement {
  const actions = el("div", { class: "comment-controls" });
  const reactions = el("div", { class: "reaction-options", role: "group", "aria-label": "Реакции" });
  const links = el("div", { class: "comment-links" });
  const mine = canEdit && state.person === author;
  const map = item.reactions[target] || {};
  for (const kind of REACTION_KINDS) {
    const count = PEOPLE.filter((p) => map[p]?.includes(kind.key)).length;
    const active = canEdit && isPerson(state.person) && map[state.person]?.includes(kind.key);
    const btn = el("button", {
      type: "button",
      class: `reaction-pill${active ? ` person-${state.person.toLowerCase()}` : ""}`,
      disabled: !canEdit || mine,
      title: mine ? "Нельзя реагировать на свой комментарий" : canEdit ? kind.label : "Войдите, чтобы реагировать",
      "aria-label": `${kind.label}: ${count}`,
      "aria-pressed": String(!!active)
    }, el("span", { class: "reaction-emoji", text: kind.emoji, "aria-hidden": "true" }),
    count ? el("span", { class: "reaction-count", text: count, "aria-hidden": "true" }) : null);
    btn.addEventListener("click", () => reactToComment(item.id, target, kind.key));
    reactions.append(btn);
  }
  if (canEdit) {
    const replyBtn = el("button", { type: "button", class: "comment-action", text: "Ответить" });
    replyBtn.addEventListener("click", () => {
      closeEditors();
      state.replyDraft = { itemId: item.id, to: target };
      render();
    });
    links.append(replyBtn);
  }
  if (isReply && mine) {
    const editBtn = el("button", { type: "button", class: "comment-action", text: "Изменить" });
    editBtn.addEventListener("click", () => { closeEditors(); state.editingReplyId = target; render(); });
    const deleteBtn = el("button", { type: "button", class: "comment-action", text: "Удалить" });
    deleteBtn.addEventListener("click", () => deleteReply(item.id, target));
    links.append(editBtn, deleteBtn);
  }
  actions.append(reactions);
  if (links.children.length) actions.append(links);
  return actions;
}

export function replyDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildComments(item: Item, canEdit: boolean): HTMLElement {
  const comments = el("div", { class: "comments" });
  const sorted = item.replies.slice().sort((a, b) => a.at.localeCompare(b.at));
  const children = new Map<string, Reply[]>();
  const ids = new Set(item.replies.map((r) => r.id));
  for (const reply of sorted) {
    const list = children.get(reply.to) ?? [];
    list.push(reply);
    children.set(reply.to, list);
  }
  const appendDraft = (node: HTMLElement, target: string): void => {
    if (canEdit && state.replyDraft?.itemId === item.id && state.replyDraft.to === target) {
      node.append(buildCommentEditor(state.person, "", (text) => addReply(item.id, target, text), "Ваш ответ…"));
    }
  };
  // Flatten the tree so the visual indent can stop growing after level three.
  // Track reply objects to render malformed cycles/duplicate ids without looping or losing text.
  const visited = new Set<Reply>();
  const appendReplies = (replies: Reply[], depth: number): void => {
    const stack = replies.slice().reverse().map((reply) => ({ reply, depth }));
    for (let next = stack.pop(); next; next = stack.pop()) {
      const { reply, depth } = next;
      if (visited.has(reply)) continue;
      visited.add(reply);
      const node = el("div", {
        class: "comment-node reply-node", style: `--reply-depth:${Math.min(depth, 3)}`, "data-reply-id": reply.id
      });
      const mine = canEdit && state.person === reply.by;
      if (mine && state.editingReplyId === reply.id) {
        node.append(buildCommentEditor(reply.by, reply.text,
          (text) => editReply(item.id, reply.id, text), "Ваш ответ…"));
      } else {
        node.append(el("div", { class: `comment-line person-${reply.by.toLowerCase()}` },
          el("span", { class: "person-tag", text: reply.by }),
          el("span", { class: "comment-text", text: reply.text }),
          el("span", { class: "reply-date", text: `${replyDate(reply.at)}${reply.editedAt ? " (изм.)" : ""}` })),
        buildCommentActions(item, reply.id, reply.by, canEdit, true));
      }
      appendDraft(node, reply.id);
      comments.append(node);
      const nested = children.get(reply.id) || [];
      for (const child of nested.slice().reverse()) stack.push({ reply: child, depth: depth + 1 });
    }
  };
  for (const p of PEOPLE) {
    const text = item.comments[p];
    const mine = canEdit && state.person === p;
    const rootReplies = children.get(p) || [];
    const node = el("div", { class: "comment-node" });
    if (mine && state.commentingId === item.id) {
      node.append(buildCommentEditor(p, text, (value) => setComment(item.id, p, value), `Комментарий ${p}`));
    } else {
      if (text || rootReplies.length) {
        const line = el("div", {
          class: `comment-line person-${p.toLowerCase()}${mine && text ? " mine" : ""}${!text ? " comment-deleted" : ""}`,
          role: mine && text ? "button" : null,
          tabindex: mine && text ? 0 : null,
          title: mine && text ? "Изменить комментарий" : null
        }, el("span", { class: "person-tag", text: p }),
        el("span", { class: "comment-text", text: text || "Комментарий удалён" }));
        if (mine && text) {
          const open = () => { closeEditors(); state.commentingId = item.id; render(); };
          line.addEventListener("click", open);
          line.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
        }
        node.append(line);
        if (text) node.append(buildCommentActions(item, p, p, canEdit, false));
      }
      if (!text && mine) {
        const addBtn = el("button", { type: "button", class: "comment-add", text: "💬 Комментарий" });
        addBtn.addEventListener("click", () => { closeEditors(); state.commentingId = item.id; render(); });
        node.append(addBtn);
      }
    }
    appendDraft(node, p);
    if (node.children.length) comments.append(node);
    appendReplies(rootReplies, 1);
  }
  // Orphans follow both roots. Cycles have no root, so start any remaining component here as well.
  appendReplies(sorted.filter((r) => !isPerson(r.to) && !ids.has(r.to)), 1);
  for (const reply of sorted) if (!visited.has(reply)) appendReplies([reply], 1);
  return comments;
}
