// Minimal ambient types for the k6 modules the scenarios import (#105). k6 runs the scripts in its
// own runtime and ships no npm types; this covers only what they use, so tsc and ESLint can check them.
declare module 'k6' {
  export function check<T>(value: T, checks: Record<string, (value: T) => boolean>): boolean;
  export function sleep(seconds: number): void;
}

declare module 'k6/metrics' {
  export class Counter {
    constructor(name: string);
    add(value: number): void;
  }
}

declare module 'k6/http' {
  interface Params {
    headers?: Record<string, string>;
    tags?: Record<string, string>;
    redirects?: number;
  }
  interface Response {
    status: number;
    body: string | null;
    json(selector?: string): unknown;
  }
  interface FileData {
    data: string;
    filename: string;
    content_type: string;
  }
  const http: {
    get(url: string, params?: Params): Response;
    post(url: string, body?: string | Record<string, unknown>, params?: Params): Response;
    file(data: string, filename: string, contentType: string): FileData;
  };
  export default http;
}
