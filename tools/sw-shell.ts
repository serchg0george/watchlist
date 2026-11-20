// Builds the service worker precache list from the files Vite emitted into dist/.

export const SHELL_PLACEHOLDER = '["__SHELL__"]';

/** dist-relative paths (forward slashes) → precache list: "./", every runtime file and the data overlaid at deploy. */
export function shellFrom(files: readonly string[]): string[] {
  const runtime = files
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => !file.startsWith(".vite/") && file !== "sw.js" && !file.startsWith("data/") && !file.endsWith(".map"))
    .sort();
  return ["./", ...runtime, "data/movies.json"];
}

/** Replaces the placeholder array in the compiled sw.js with the real list; throws if the placeholder is missing. */
export function injectShell(swSource: string, shell: readonly string[]): string {
  if (!swSource.includes(SHELL_PLACEHOLDER)) throw new Error(`sw.js has no ${SHELL_PLACEHOLDER} placeholder`);
  return swSource.replace(SHELL_PLACEHOLDER, JSON.stringify(shell));
}
