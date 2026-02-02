export default class PQueue {
  concurrency: number
  
  constructor(options?: { concurrency?: number }) {
    this.concurrency = options?.concurrency || 1
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  async addAll<T>(fns: Array<() => Promise<T>>): Promise<T[]> {
    return Promise.all(fns.map(fn => fn()))
  }

  get size(): number {
    return 0
  }

  get pending(): number {
    return 0
  }

  clear(): void {}

  async onEmpty(): Promise<void> {}

  async onIdle(): Promise<void> {}
}
