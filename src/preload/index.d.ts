import type { CopycatApi } from '../shared/types'

declare global {
  interface Window {
    api: CopycatApi
  }
}
