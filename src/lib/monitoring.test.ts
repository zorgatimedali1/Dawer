import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerErrorCapture, reportError } from '@/lib/monitoring';

async function freshMonitoring() {
  vi.resetModules();
  return import('@/lib/monitoring');
}

describe('monitoring registry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a no-op before any capture function is registered', async () => {
    const { reportError: freshReport } = await freshMonitoring();

    expect(() => freshReport(new Error('early'))).not.toThrow();
  });

  it('forwards the error and context to the registered capture function', () => {
    const capture = vi.fn();
    registerErrorCapture(capture);

    const error = new Error('boom');
    reportError(error, { componentStack: 'at App' });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(error, { componentStack: 'at App' });
  });

  it('forwards without context when none is given', () => {
    const capture = vi.fn();
    registerErrorCapture(capture);

    reportError(new Error('bare'));

    expect(capture).toHaveBeenCalledWith(new Error('bare'), undefined);
  });

  it('swallows exceptions thrown by the capture function', () => {
    registerErrorCapture(() => {
      throw new Error('monitoring is down');
    });

    expect(() => reportError(new Error('app error'))).not.toThrow();
  });

  it('re-registration replaces the previous capture function', () => {
    const first = vi.fn();
    const second = vi.fn();
    registerErrorCapture(first);
    registerErrorCapture(second);

    reportError(new Error('later'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
