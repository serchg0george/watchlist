// Minimal ambient declarations for the Node APIs used by tests/ and tools/ (no @types/node dependency).
declare module "node:test" {
  type TestFn = () => void | Promise<void>;
  export function test(name: string, fn: TestFn): void;
  export function describe(name: string, options: { concurrency: number; skip: boolean | string }, fn: () => void): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: TestFn): void;
}

declare module "node:assert/strict" {
  interface Assert {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    match(value: string, pattern: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | ((error: unknown) => boolean), message?: string): void;
    rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), expected?: RegExp | ((error: unknown) => boolean), message?: string): Promise<void>;
  }
  const assert: Assert;
  export default assert;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
  export function readdirSync(path: string, options: { recursive: true }): string[];
  export function existsSync(path: string): boolean;
}

declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly argv: readonly string[];
  exitCode: number | undefined;
  exit(code?: number): never;
};

declare module "node:child_process" {
  interface RunOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    encoding: "utf8";
    timeout?: number;
  }
  export function execFileSync(command: string, args: string[], options: RunOptions & { stdio?: "pipe" }): string;
  export function execFile(command: string, args: string[], options: RunOptions,
    callback: (error: Error | null, stdout: string, stderr: string) => void): void;
}
declare module "node:os" {
  export function tmpdir(): string;
}
declare module "node:path" {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}
declare module "node:fs" {
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string): void;
  export function writeFileSync(path: string, data: string): void;
  export function rmSync(path: string, options: { recursive: true; force: true }): void;
}
