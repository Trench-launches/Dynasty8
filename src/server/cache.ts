import "server-only";

/**
 * Small in-process TTL cache with in-flight de-duplication.
 * Keys are always built from validated, normalised parameters (never raw query strings),
 * which prevents cache poisoning via crafted inputs. For multi-instance deployments,
 * implement the same interface on Redis (see docs/BACKEND.md).
 */
export interface Cache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  wrap<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
  clear(): void;
}

export function createMemoryCache(maxEntries = 2_000): Cache {
  const store = new Map<string, { value: unknown; expires: number }>();
  const inflight = new Map<string, Promise<unknown>>();

  const get = <T>(key: string): T | undefined => {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      store.delete(key);
      return undefined;
    }
    return hit.value as T;
  };

  const set = <T>(key: string, value: T, ttlMs: number) => {
    if (store.size >= maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    store.set(key, { value, expires: Date.now() + ttlMs });
  };

  return {
    get,
    set,
    async wrap<T>(key: string, ttlMs: number, load: () => Promise<T>) {
      const hit = get<T>(key);
      if (hit !== undefined) return hit;
      const pending = inflight.get(key) as Promise<T> | undefined;
      if (pending) return pending;
      const p = load()
        .then((v) => {
          set(key, v, ttlMs);
          return v;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    clear() {
      store.clear();
      inflight.clear();
    },
  };
}

export const appCache = createMemoryCache();
