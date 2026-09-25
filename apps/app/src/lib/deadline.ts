/**
 * How long one API call may take, its answer's body included, before the app gives up on it. It sits above the API's own
 * 25 s deadline on its transactional calls (`REQUEST_DEADLINE_MS`), so such a call reaches it only when the answer is lost
 * in transit; a call the API does not bound yet (TODOS.md) can also reach it on a stuck database connection.
 */
export const REQUEST_TIMEOUT_MS = 30_000

/**
 * What a call rejects with once its deadline passed without a whole answer. The write it carried may still have landed, so
 * {@link refusalMessage} asks the user to check the rows rather than asking for a retry.
 */
export class RequestTimeoutError extends Error {
  override name = 'RequestTimeoutError'

  constructor() {
    super('the request did not answer in time')
  }
}

/**
 * The answer with its whole body already read: the RPC link's `fetch` calls it inside {@link withDeadline}, because oRPC reads
 * the body only after `fetch` resolves, so an answer that stalls after its headers would otherwise outlive the deadline. The
 * body is read as text (every RPC answer is JSON): native's `Response` is React Native's whatwg-fetch polyfill, which decodes
 * an ArrayBuffer body one byte per character and turned 仕事 into mojibake.
 * @param response - The answer `fetch` resolved with.
 * @returns
 * - the same answer, when it has no body (204, a manual redirect)
 * - a new answer with the same status and headers whose body is the text already read
 * @example await readWholeAnswer(await fetch(request)) // a Response whose body is already in memory
 */
export async function readWholeAnswer(response: Response): Promise<Response> {
  if (response.body === null) return response
  return new Response(await response.text(), response)
}

/**
 * Runs `request` until it settles or `ms` passes, whichever comes first: the RPC link's `fetch` wraps every call in it, so a
 * request that never answers fails, and the correction panel is released once the refetch after it settles (each call of which
 * has its own deadline), instead of being held until the page reloads. Built on
 * one AbortController because Hermes may lack `AbortSignal.any` and `AbortSignal.timeout`.
 * @param signal - The caller's signal (oRPC puts TanStack's cancellation on the Request); its abort aborts the request too.
 * @param ms - The deadline, {@link REQUEST_TIMEOUT_MS} in the app.
 * @param request - The work, handed the signal to pass to `fetch`; it should read the whole answer, body included.
 * @returns
 * - what `request` resolves to, when it settles in time
 * - rejects with {@link RequestTimeoutError} once `ms` passed, and aborts the request
 * - rejects with the request's own error when it fails first
 * - rejects with the caller's abort reason once the caller aborts, and aborts the request, even one that ignores its signal
 * @example await withDeadline(request.signal, REQUEST_TIMEOUT_MS, async (signal) => fetch(request, { signal })) // a Response, or RequestTimeoutError after 30 s
 */
export async function withDeadline<T>(
  signal: AbortSignal | undefined,
  ms: number,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel = (): void => undefined
  // The deadline and the caller's cancelling reject on their own, so a request that ignores the abort is still let go of.
  const stopped = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new RequestTimeoutError())
      controller.abort()
    }, ms)
    cancel = (): void => {
      reject(signal?.reason)
      controller.abort()
    }
  })
  // A caller that already gave up hands the request an aborted signal, and the call rejects with the caller's reason.
  if (signal?.aborted) cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    // `stopped` first: when both have already settled (a caller that already gave up), the race takes the earlier entry.
    return await Promise.race([stopped, request(controller.signal)])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
