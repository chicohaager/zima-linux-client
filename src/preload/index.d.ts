import type { ZimaApi } from './index'

declare global {
  interface Window {
    readonly zima: ZimaApi
  }
}

export {}
