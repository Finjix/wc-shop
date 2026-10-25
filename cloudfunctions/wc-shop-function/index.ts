type FunctionScope = 'shop' | 'admin';

type FunctionEvent = {
  scope?: unknown;
  httpMethod?: unknown;
  body?: unknown;
  isBase64Encoded?: boolean;
  headers?: Record<string, string>;
};

type Runtime = Record<string, unknown>;
type Payload = {
  action?: unknown;
  data: Record<string, unknown>;
};
type Endpoint = (
  event: unknown,
  context: unknown,
  runtime: Runtime,
  action: string,
  data: Record<string, unknown>,
) => unknown | Promise<unknown>;

type RuntimeModule = {
  createRuntime: () => Runtime;
  getPayload: (event: unknown) => Payload;
};

type ResponseModule = {
  runEndpoint: (
    endpoint: (event: unknown, context: unknown) => unknown | Promise<unknown>,
    event: unknown,
    context: unknown,
  ) => Promise<unknown>;
};

type ErrorModule = {
  errorFrom: (code: string, details?: Record<string, unknown>) => Error;
};

declare function require(moduleName: string): unknown;

const { createRuntime, getPayload } = require('../shared/runtime') as RuntimeModule;
const { runEndpoint } = require('../shared/response') as ResponseModule;
const { errorFrom } = require('../shared/errors') as ErrorModule;
const { shopEndpoint } = require('../shared/shop') as { shopEndpoint: Endpoint };
const { adminEndpoint } = require('../shared/admin') as { adminEndpoint: Endpoint };

/**
 * Resolve the logical API scope without using it as an authorization decision.
 * Shop endpoints enforce user ownership; admin endpoints have no access-token gate.
 */
export function resolveScope(event: unknown): FunctionScope {
  const source = event && typeof event === 'object' ? event as FunctionEvent : {};
  if (source.scope === undefined) return 'shop';
  if (source.scope === 'shop' || source.scope === 'admin') return source.scope;
  throw errorFrom('INVALID_ARGUMENT', { field: 'scope' });
}

async function invoke(event: unknown, context: unknown): Promise<unknown> {
  return runEndpoint(async (input, ctx) => {
    const runtime = createRuntime();
    const { action, data } = getPayload(input);
    if (!action || typeof action !== 'string') {
      throw errorFrom('INVALID_ARGUMENT', { field: 'action' });
    }

    const endpoint = resolveScope(input) === 'admin' ? adminEndpoint : shopEndpoint;
    return endpoint(input, ctx, runtime, action, data || {});
  }, event, context);
}

/** Public HTTP gateway for the admin. Shop identity only comes from SDK calls. */
export async function handleAdminHttp(event: FunctionEvent, invokeAdmin: (input: unknown) => Promise<unknown>): Promise<unknown> {
  const headers = { 'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', 'cache-control': 'no-store' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  const result = await runEndpoint(async () => {
    if (event.httpMethod !== 'POST') throw errorFrom('INVALID_ARGUMENT', { field: 'httpMethod' });
    let input: unknown;
    try {
      const body = event.isBase64Encoded && typeof event.body === 'string'
        ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      input = typeof body === 'string' ? JSON.parse(body) : body;
    } catch { throw errorFrom('INVALID_ARGUMENT', { field: 'body' }); }
    if (!input || typeof input !== 'object' || Array.isArray(input) || (input as FunctionEvent).scope !== 'admin') {
      throw errorFrom('INVALID_ARGUMENT', { field: 'scope' });
    }
    return invokeAdmin(input);
  }, event, {});
  // invoke already returns an envelope; parse failures use this outer envelope.
  const envelope = result as { ok: boolean; data?: unknown };
  return { statusCode: event.httpMethod === 'POST' ? 200 : 405, headers,
    body: JSON.stringify(envelope.ok ? envelope.data : envelope) };
}

export async function main(event: unknown, context: unknown): Promise<unknown> {
  const timer = event as { Type?: string; TriggerName?: string } | null;
  if (timer?.Type === 'Timer' && timer.TriggerName === 'image-cleanup') {
    return (require('../shared/catalog-lifecycle') as { sweep: (runtime: Runtime) => Promise<unknown> }).sweep(createRuntime());
  }
  if (timer?.Type === 'Timer' && timer.TriggerName === 'payment-reconcile') {
    // This branch only queries signed provider state. It never accepts amounts, IDs or a refund command.
    const result = await (require('../shared/payments') as { reconcile: (runtime: Runtime) => Promise<{ processed: boolean }> }).reconcile(createRuntime());
    return { reconciled: true, ...result };
  }
  if (event && typeof event === 'object' && typeof (event as FunctionEvent).httpMethod === 'string') {
    const http = event as FunctionEvent;
    const headers = http.headers || {};
    const header = (key: string) => Object.entries(headers).find(([name]) => name.toLowerCase() === key)?.[1];
    // Notifications are accepted only as raw HTTP and always verified cryptographically.
    if (header('wechatpay-signature')) {
      return (require('../shared/payments') as { notification: (runtime: Runtime, event: unknown) => Promise<unknown> })
        .notification(createRuntime(), http);
    }
    return handleAdminHttp(http, (input) => invoke(input, {}));
  }
  return invoke(event, context);
}
