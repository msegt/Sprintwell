/**
 * A tiny, framework-neutral routing interface so the same API handlers run on
 * Fastify (Node) and Hono (Cloudflare Workers).
 */

export interface ApiRequest {
  params: Record<string, string>;
  body: unknown;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  ip: string;
}

export interface RouteOptions {
  /** Applies the stricter rate limit used for sign-up and join endpoints. */
  strict?: boolean;
}

/** Returned by a handler to send a file download instead of JSON. */
export class FileResponse {
  constructor(
    readonly body: string,
    readonly contentType: string,
    readonly filename: string,
  ) {}

  get headers(): Record<string, string> {
    return {
      'content-type': this.contentType,
      'content-disposition': `attachment; filename="${this.filename.replace(/["\\\r\n]/g, '')}"`,
    };
  }
}

export type ApiHandler = (req: ApiRequest) => Promise<unknown>;

type Register = {
  (path: string, handler: ApiHandler): void;
  (path: string, options: RouteOptions, handler: ApiHandler): void;
};

export interface ApiRouter {
  get: Register;
  post: Register;
  patch: Register;
  delete: Register;
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Builds an ApiRouter from a single "add route" function. */
export function makeRouter(add: (method: Method, path: string, handler: ApiHandler, options: RouteOptions) => void): ApiRouter {
  const reg =
    (method: Method): Register =>
    (path: string, a: RouteOptions | ApiHandler, b?: ApiHandler) => {
      if (typeof a === 'function') add(method, path, a, {});
      else add(method, path, b!, a);
    };
  return { get: reg('GET'), post: reg('POST'), patch: reg('PATCH'), delete: reg('DELETE') };
}

/** Side effects on live connections that the API triggers after changing data. */
export interface RealtimeControl {
  notifyTeam(teamId: string): void;
  revoke(teamId: string, userId: string): void;
  forgetTeam(teamId: string): void;
  forgetMeeting(teamId: string, meetingId: string): void;
}
