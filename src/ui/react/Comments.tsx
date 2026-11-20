import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { addReply, closeEditors, deleteReply, editReply, reactToComment, setComment } from "../../actions.js";
import { PEOPLE, REACTION_KINDS } from "../../config.js";
import { isPerson } from "../../domain/guards.js";
import type { Item, Person, Reply } from "../../domain/types.js";
import { clearDraftAfterSave, draftKey, readDraft, writeDraft } from "../../state/saving.js";
import { render, state } from "../../state/store.js";

interface CommentEditorProps { person: Person | ""; text: string; save: (text: string) => void; label: string }

function CommentEditor({ person, text, save, label }: CommentEditorProps) {
  const identity = state.editingReplyId ? `edit-${state.editingReplyId}` : state.replyDraft ? `reply-${state.replyDraft.itemId}-${state.replyDraft.to}` : `comment-${state.commentingId}-${person}`;
  const key = draftKey("comment", identity);
  const [value, setValue] = useState(() => {
    const draftText = readDraft(key)?.text;
    return typeof draftText === "string" ? draftText : text;
  });
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); }, []);
  const submit = (): void => {
    const snapshot = { text: value };
    writeDraft(key, snapshot);
    save(value.trim());
    clearDraftAfterSave(key, snapshot);
  };
  const cancel = (): void => { closeEditors(); render(); };
  return (
    <div className={`comment-line person-${person.toLowerCase()} mine`}>
      <span className="person-tag">{person}</span>
      <textarea ref={area} className="comment-input" rows={2} placeholder={label} aria-label={label} value={value}
        onChange={(e) => { setValue(e.target.value); writeDraft(key, { text: e.target.value }); }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }} />
      <div className="comment-actions">
        <button type="button" className="btn btn-primary" onClick={submit}>Сохранить</button>
        <button type="button" className="btn" onClick={cancel}>Отмена</button>
      </div>
    </div>
  );
}

interface CommentActionsProps { item: Item; target: string; author: Person; canEdit: boolean; isReply: boolean }

function CommentActions({ item, target, author, canEdit, isReply }: CommentActionsProps) {
  const mine = canEdit && state.person === author;
  const map = item.reactions[target] || {};
  const links: ReactNode[] = [];
  if (canEdit) {
    links.push(<button key="reply" type="button" className="comment-action" onClick={() => { closeEditors(); state.replyDraft = { itemId: item.id, to: target }; render(); }}>Ответить</button>);
  }
  if (isReply && mine) {
    links.push(
      <button key="edit" type="button" className="comment-action" onClick={() => { closeEditors(); state.editingReplyId = target; render(); }}>Изменить</button>,
      <button key="delete" type="button" className="comment-action" onClick={() => deleteReply(item.id, target)}>Удалить</button>
    );
  }
  return (
    <div className="comment-controls">
      <div className="reaction-options" role="group" aria-label="Реакции">
        {REACTION_KINDS.map((kind) => {
          const count = PEOPLE.filter((p) => map[p]?.includes(kind.key)).length;
          const active = canEdit && isPerson(state.person) && !!map[state.person]?.includes(kind.key);
          return (
            <button key={kind.key} type="button" className={`reaction-pill${active ? ` person-${state.person.toLowerCase()}` : ""}`}
              disabled={!canEdit || mine}
              title={mine ? "Нельзя реагировать на свой комментарий" : canEdit ? kind.label : "Войдите, чтобы реагировать"}
              aria-label={`${kind.label}: ${count}`} aria-pressed={active}
              onClick={() => reactToComment(item.id, target, kind.key)}>
              <span className="reaction-emoji" aria-hidden="true">{kind.emoji}</span>
              {count ? <span className="reaction-count" aria-hidden="true">{count}</span> : null}
            </button>
          );
        })}
      </div>
      {links.length > 0 && <div className="comment-links">{links}</div>}
    </div>
  );
}

export function replyDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Comment roots for S and L with their reply threads; returns null when there is nothing to show. */
export function Comments({ item, canEdit }: { item: Item; canEdit: boolean }) {
  const nodes: ReactNode[] = [];
  const sorted = item.replies.slice().sort((a, b) => a.at.localeCompare(b.at));
  const children = new Map<string, Reply[]>();
  const ids = new Set(item.replies.map((r) => r.id));
  for (const reply of sorted) {
    const list = children.get(reply.to) ?? [];
    list.push(reply);
    children.set(reply.to, list);
  }
  const draftFor = (target: string): ReactNode =>
    canEdit && state.replyDraft?.itemId === item.id && state.replyDraft.to === target
      ? <CommentEditor key={`draft-${target}`} person={state.person} text="" save={(text) => addReply(item.id, target, text)} label="Ваш ответ…" />
      : null;
  // Flatten the tree so the visual indent can stop growing after level three.
  // Track reply objects to render malformed cycles/duplicate ids without looping or losing text.
  const visited = new Set<Reply>();
  let seq = 0;
  const appendReplies = (replies: Reply[], depth: number): void => {
    const stack = replies.slice().reverse().map((reply) => ({ reply, depth }));
    for (let next = stack.pop(); next; next = stack.pop()) {
      const { reply, depth: level } = next;
      if (visited.has(reply)) continue;
      visited.add(reply);
      const mine = canEdit && state.person === reply.by;
      nodes.push(
        <div key={`r${seq++}-${reply.id}`} className="comment-node reply-node" style={{ "--reply-depth": Math.min(level, 3) } as CSSProperties} data-reply-id={reply.id}>
          {mine && state.editingReplyId === reply.id
            ? <CommentEditor person={reply.by} text={reply.text} save={(text) => editReply(item.id, reply.id, text)} label="Ваш ответ…" />
            : <>
              <div className={`comment-line person-${reply.by.toLowerCase()}`}>
                <span className="person-tag">{reply.by}</span>
                <span className="comment-text">{reply.text}</span>
                <span className="reply-date">{`${replyDate(reply.at)}${reply.editedAt ? " (изм.)" : ""}`}</span>
              </div>
              <CommentActions item={item} target={reply.id} author={reply.by} canEdit={canEdit} isReply />
            </>}
          {draftFor(reply.id)}
        </div>
      );
      const nested = children.get(reply.id) || [];
      for (const child of nested.slice().reverse()) stack.push({ reply: child, depth: level + 1 });
    }
  };
  for (const p of PEOPLE) {
    const text = item.comments[p];
    const mine = canEdit && state.person === p;
    const rootReplies = children.get(p) || [];
    const parts: ReactNode[] = [];
    if (mine && state.commentingId === item.id) {
      parts.push(<CommentEditor key="editor" person={p} text={text} save={(value) => setComment(item.id, p, value)} label={`Комментарий ${p}`} />);
    } else {
      if (text || rootReplies.length) {
        const editable = mine && !!text;
        const open = (): void => { closeEditors(); state.commentingId = item.id; render(); };
        parts.push(
          <div key="line" className={`comment-line person-${p.toLowerCase()}${editable ? " mine" : ""}${!text ? " comment-deleted" : ""}`}
            role={editable ? "button" : undefined} tabIndex={editable ? 0 : undefined} title={editable ? "Изменить комментарий" : undefined}
            onClick={editable ? open : undefined}
            onKeyDown={editable ? (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } } : undefined}>
            <span className="person-tag">{p}</span>
            <span className="comment-text">{text || "Комментарий удалён"}</span>
          </div>
        );
        if (text) parts.push(<CommentActions key="actions" item={item} target={p} author={p} canEdit={canEdit} isReply={false} />);
      }
      if (!text && mine) {
        parts.push(<button key="add" type="button" className="comment-add" onClick={() => { closeEditors(); state.commentingId = item.id; render(); }}>💬 Комментарий</button>);
      }
    }
    const draft = draftFor(p);
    if (draft) parts.push(draft);
    if (parts.length) nodes.push(<div key={`root-${p}`} className="comment-node">{parts}</div>);
    appendReplies(rootReplies, 1);
  }
  // Orphans follow both roots. Cycles have no root, so start any remaining component here as well.
  appendReplies(sorted.filter((r) => !isPerson(r.to) && !ids.has(r.to)), 1);
  for (const reply of sorted) if (!visited.has(reply)) appendReplies([reply], 1);
  return nodes.length ? <div className="comments">{nodes}</div> : null;
}
