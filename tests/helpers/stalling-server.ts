import { createServer, type AddressInfo, type Socket } from 'net'

/** A server that accepts connections and never answers, like a stalled network. */
export async function stallingServer(): Promise<{
  url: string
  connections: () => number
  closed: () => number
  stop: () => Promise<void>
}> {
  const sockets: Socket[] = []
  let closed = 0
  const server = createServer((socket) => {
    sockets.push(socket)
    socket.on('close', () => closed++)
    socket.on('error', () => undefined)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/stalled.git`,
    connections: () => sockets.length,
    closed: () => closed,
    stop: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      })
  }
}

/** Keeps a proxy from intercepting connections to the local stalling server while `run` is active. */
export function bypassProxyForLocalhost(hooks: { beforeAll: (fn: () => void) => void; afterAll: (fn: () => void) => void }): void {
  const saved = { NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy }
  hooks.beforeAll(() => {
    process.env.NO_PROXY = '127.0.0.1,localhost'
    process.env.no_proxy = '127.0.0.1,localhost'
  })
  hooks.afterAll(() => {
    if (saved.NO_PROXY === undefined) delete process.env.NO_PROXY
    else process.env.NO_PROXY = saved.NO_PROXY
    if (saved.no_proxy === undefined) delete process.env.no_proxy
    else process.env.no_proxy = saved.no_proxy
  })
}
