/**
 * How long one API call may take, its answer's body included, before the app gives up on it. It sits above the API's own
 * waits (10 s for a pool connection, then 10 s for the account's lock), so a call reaches it only when something hangs.
 */
export const REQUEST_TIMEOUT_MS = 30_000

/**
 * What a call rejects with once its deadline passed without a whole answer. The write it carried may still have landed, so
 * {@link refusalMessage} says the list was read again rather than asking for a retry.
 */
export class RequestTimeoutError extends Error {
  override name = 'RequestTimeoutError'

  constructor() {
    super('the request did not answer in time')
  }
}

/**
 * Runs `request` until it settles or `ms` passes, whichever comes first: the RPC link's `fetch` wraps every call in it, so a
 * request that never answers fails and releases the correction panel instead of holding it until the page reloads. Built on
 * one AbortController because Hermes may lack `AbortSignal.any` and `AbortSignal.timeout`.
 * @param signal - The caller's signal (oRPC puts TanStack's cancellation on the Request); its abort aborts the request too.
 * @param ms - The deadline, {@link REQUEST_TIMEOUT_MS} in the app.
 * @param request - The work, handed the signal to pass to `fetch`; it should read the whole answer, body included.
 * @returns
 * - what `request` resolves to, when it settles in time
 * - rejects with {@link RequestTimeoutError} once `ms` passed, and aborts the request
 * - rejects with the request's own error when it fails or the caller aborts first
 * @example await withDeadline(request.signal, REQUEST_TIMEOUT_MS, async (signal) => fetch(request, { signal })) // a Response, or RequestTimeoutError after 30 s
 */
export async function withDeadline<T>(
  signal: AbortSignal | undefined,
  ms: number,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  // A caller that already gave up never starts the request.
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  // The deadline rejects on its own, so a request that ignores the abort is still let go of.
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new RequestTimeoutError())
      abort()
    }, ms)
  })
  try {
    return await Promise.race([request(controller.signal), deadline])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
