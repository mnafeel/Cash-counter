/** Polyfills used by pdfjs-dist on browsers without ES2025 Map helpers. */
export function installPdfJsPolyfills(): void {
  const mapProto = Map.prototype as Map<unknown, unknown> & {
    getOrInsertComputed?: (key: unknown, callback: () => unknown) => unknown
  }

  if (!mapProto.getOrInsertComputed) {
    mapProto.getOrInsertComputed = function (key, callback) {
      if (this.has(key)) return this.get(key)
      const value = callback()
      this.set(key, value)
      return value
    }
  }

  const promiseCtor = Promise as PromiseConstructor & {
    withResolvers?: <T>() => {
      promise: Promise<T>
      resolve: (value: T | PromiseLike<T>) => void
      reject: (reason?: unknown) => void
    }
  }

  if (!promiseCtor.withResolvers) {
    promiseCtor.withResolvers = function <T>() {
      let resolve!: (value: T | PromiseLike<T>) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }
  }
}
