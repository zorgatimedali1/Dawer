/**
 * Runtime stand-in for the `cloudflare:workers` module so tests can import
 * Durable Object classes under plain Node/Vitest (the real module only exists
 * inside the Workers runtime). Wired up through the `cloudflare:workers`
 * alias in vitest.config.ts; typechecking still uses the real
 * @cloudflare/workers-types declarations.
 */
export class DurableObject<Env = unknown, _Props = {}> {
  protected ctx: unknown;
  protected env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
