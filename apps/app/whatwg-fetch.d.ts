// whatwg-fetch ships no types. deadline.test.ts imports its Response, the one React Native puts on native's global, to check
// that an answer read back through it keeps its Japanese; it has the standard Response's shape.
declare module 'whatwg-fetch' {
  export const Response: typeof globalThis.Response
}
