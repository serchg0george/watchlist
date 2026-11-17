// Minimal ambient declarations for the Node APIs used by tests/ and tools/ (no @types/node dependency).
declare module "node:test" {
  type TestFn = () => void | Promise<void>;
  export function test(name: string, fn: TestFn): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: TestFn): void;
}

declare module "node:assert/strict" {
  interface Assert {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | ((error: unknown) => boolean), message?: string): void;
    rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), expected?: RegExp | ((error: unknown) => boolean), message?: string): Promise<void>;
  }
  const assert: Assert;
  export default assert;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string, options: { recursive: true }): string[];
}

declare const console: {
  log(...data: unknown[]): void;
  error(...data: unknown[]): void;
};

declare const process: {
  readonly argv: readonly string[];
  exitCode: number | undefined;
  exit(code?: number): never;
};
