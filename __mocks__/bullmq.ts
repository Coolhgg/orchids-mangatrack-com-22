interface MockQueue {
  add: jest.Mock
  addBulk: jest.Mock
  getJob: jest.Mock
  getJobCounts: jest.Mock
  close: jest.Mock
  on: jest.Mock
  drain: jest.Mock
  clean: jest.Mock
  pause: jest.Mock
  resume: jest.Mock
}

interface MockWorker {
  on: jest.Mock
  close: jest.Mock
  pause: jest.Mock
  resume: jest.Mock
}

const mockQueue: MockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'mock-job-1' }),
  addBulk: jest.fn().mockResolvedValue([{ id: 'mock-job-1' }]),
  getJob: jest.fn().mockResolvedValue(null),
  getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0 }),
  close: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  drain: jest.fn().mockResolvedValue(undefined),
  clean: jest.fn().mockResolvedValue([]),
  pause: jest.fn().mockResolvedValue(undefined),
  resume: jest.fn().mockResolvedValue(undefined),
}

const mockWorker: MockWorker = {
  on: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn().mockResolvedValue(undefined),
  resume: jest.fn().mockResolvedValue(undefined),
}

interface QueueOptions {
  connection?: unknown
  defaultJobOptions?: unknown
}

interface WorkerOptions {
  connection?: unknown
  concurrency?: number
}

interface JobOptions {
  jobId?: string
  delay?: number
  attempts?: number
}

export class Queue {
  name: string
  opts: QueueOptions
  add = mockQueue.add
  addBulk = mockQueue.addBulk
  getJob = mockQueue.getJob
  getJobCounts = mockQueue.getJobCounts
  close = mockQueue.close
  on = mockQueue.on
  drain = mockQueue.drain
  clean = mockQueue.clean
  pause = mockQueue.pause
  resume = mockQueue.resume

  constructor(name: string, opts?: QueueOptions) {
    this.name = name
    this.opts = opts || {}
  }
}

export class Worker {
  name: string
  processor: unknown
  opts: WorkerOptions
  on = mockWorker.on
  close = mockWorker.close
  pause = mockWorker.pause
  resume = mockWorker.resume

  constructor(name: string, processor: unknown, opts?: WorkerOptions) {
    this.name = name
    this.processor = processor
    this.opts = opts || {}
  }
}

export class QueueEvents {
  name: string
  opts: QueueOptions

  constructor(name: string, opts?: QueueOptions) {
    this.name = name
    this.opts = opts || {}
  }

  on(): void {}
  close(): void {}
}

export class FlowProducer {
  opts: QueueOptions

  constructor(opts?: QueueOptions) {
    this.opts = opts || {}
  }

  add(): Promise<Record<string, unknown>> {
    return Promise.resolve({})
  }

  addBulk(): Promise<unknown[]> {
    return Promise.resolve([])
  }

  close(): Promise<void> {
    return Promise.resolve()
  }
}

export class Job {
  queue: unknown
  name: string
  data: unknown
  opts: JobOptions
  id: string
  attemptsMade: number

  constructor(queue: unknown, name: string, data: unknown, opts?: JobOptions) {
    this.queue = queue
    this.name = name
    this.data = data
    this.opts = opts || {}
    this.id = opts?.jobId || `job-${Date.now()}`
    this.attemptsMade = 0
  }

  async getState(): Promise<string> {
    return 'completed'
  }

  async updateProgress(_progress: number): Promise<void> {}
  async moveToDelayed(_timestamp: number, _token?: string): Promise<void> {}
  async remove(): Promise<void> {}
}
