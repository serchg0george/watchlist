// ===== Small DOM helper (no innerHTML with user data) =====

export type ElAttrValue = string | number | boolean | null | undefined | EventListener;
export type ElChild = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, ElAttrValue> | null, ...children: (ElChild | ElChild[])[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "class") node.className = String(v);
      else if (k === "text") node.textContent = String(v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: #${id}`);
  return element as T;
}

export type SvgChild = Node | string | number | null | undefined;

export function statsSvg<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Record<string, string | number> | null, ...children: (SvgChild | SvgChild[])[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
  children.flat().forEach((child) => { if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child))); });
  return node;
}
