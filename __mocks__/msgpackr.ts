export const Packr = jest.fn().mockImplementation(() => ({
  pack: jest.fn((data: unknown) => Buffer.from(JSON.stringify(data))),
  unpack: jest.fn((buffer: Buffer) => JSON.parse(buffer.toString())),
}))

export const Encoder = jest.fn()

export const addExtension = jest.fn()

export const pack = jest.fn((data: unknown) => Buffer.from(JSON.stringify(data)))

export const encode = jest.fn((data: unknown) => Buffer.from(JSON.stringify(data)))

export const unpack = jest.fn((buffer: Buffer) => JSON.parse(buffer.toString()))

export const decode = jest.fn((buffer: Buffer) => JSON.parse(buffer.toString()))

export const NEVER = 0
export const ALWAYS = 1
export const DECIMAL_ROUND = 2
export const DECIMAL_FIT = 3
export const REUSE_BUFFER_MODE = 4
export const RESET_BUFFER_MODE = 5
export const RESERVE_START_SPACE = 6
