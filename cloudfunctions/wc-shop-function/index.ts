type FunctionScope = 'shop' | 'admin';

type FunctionEvent = {
  scope?: unknown;
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
 * The endpoint implementations still perform their own user/admin checks.
 */
export function resolveScope(event: unknown): FunctionScope {
  const source = event && typeof event === 'object' ? event as FunctionEvent : {};
  if (source.scope === undefined) return 'shop';
  if (source.scope === 'shop' || source.scope === 'admin') return source.scope;
  throw errorFrom('INVALID_ARGUMENT', { field: 'scope' });
}

export async function main(event: unknown, context: unknown): Promise<unknown> {
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
