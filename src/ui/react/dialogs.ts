// The dialogs register their <dialog> nodes here so buttons anywhere can open them.
const dialogs: { settings: HTMLDialogElement | null; categories: HTMLDialogElement | null } = { settings: null, categories: null };

export function registerDialog(name: keyof typeof dialogs, node: HTMLDialogElement | null): void { dialogs[name] = node; }

export function openSettings(): void { dialogs.settings?.showModal(); }
export function closeSettings(): void { dialogs.settings?.close(); }
export function openCategories(): void { dialogs.categories?.showModal(); }
