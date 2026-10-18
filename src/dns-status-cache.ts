export function createAsyncStatusCache<T>() {
  let cached: T | undefined;
  let revision = 0;
  let pending: { revision: number; promise: Promise<T> } | undefined;

  return {
    peek: () => cached,
    currentRevision: () => revision,
    isCurrent: (candidateRevision: number) => candidateRevision === revision,
    invalidate: () => { cached = undefined; revision += 1; pending = undefined; },
    get(loader: () => Promise<T>): Promise<T> {
      if (cached !== undefined) return Promise.resolve(cached);
      if (pending?.revision === revision) return pending.promise;

      const requestRevision = revision;
      const promise = loader().then((value) => {
        if (requestRevision === revision) cached = value;
        return value;
      }).finally(() => {
        if (pending?.promise === promise) pending = undefined;
      });
      pending = { revision: requestRevision, promise };
      return promise;
    },
  };
}
