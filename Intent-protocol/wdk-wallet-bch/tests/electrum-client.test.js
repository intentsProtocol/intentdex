// The Electrum client against two kinds of socket: the W3C WebSocket (browsers, Node, React Native) and the
// duplex stream a Bare worklet has as its global `WebSocket` (bare-ws).

import { describe, expect, it } from 'vitest'
import ElectrumClient from '../src/electrum-client.js'

/** Answers every request with `{ method, params }`, as the server would with a result. */
const answer = text => {
  const { id, method, params } = JSON.parse(text)
  return JSON.stringify({ jsonrpc: '2.0', id, result: method === 'server.version' ? ['Fulcrum', '1.5.3'] : { method, params } })
}

function w3cSocket ({ refuse = [] } = {}) {
  const opened = []
  class Socket {
    constructor (url) {
      this.url = url
      opened.push(this)
      queueMicrotask(() => (refuse.includes(url) ? this.onerror?.({}) : this.onopen?.({})))
    }

    send (text) { queueMicrotask(() => this.onmessage?.({ data: answer(text) })) }
    close () { this.closed = true; queueMicrotask(() => this.onclose?.({})) }
  }
  return { Socket, opened }
}

function streamSocket () {
  const opened = []
  class Socket {
    constructor (url) {
      this.url = url
      this.handlers = {}
      opened.push(this)
      queueMicrotask(() => this.emit('open'))
    }

    on (event, handler) { (this.handlers[event] ??= []).push(handler); return this }
    emit (event, value) { for (const handler of this.handlers[event] ?? []) handler(value) }
    // bare-ws delivers each message as a Buffer.
    write (text) { queueMicrotask(() => this.emit('data', new TextEncoder().encode(answer(text)))); return true }
    destroy () { this.destroyed = true; queueMicrotask(() => this.emit('close')) }
  }
  return { Socket, opened }
}

describe('Electrum client', () => {
  it('talks over a W3C WebSocket', async () => {
    const { Socket, opened } = w3cSocket()
    const client = new ElectrumClient({ servers: ['wss://one'], WebSocket: Socket })
    expect(await client.request('blockchain.headers.get_tip')).toEqual({ method: 'blockchain.headers.get_tip', params: [] })
    expect(opened).toHaveLength(1)
    await client.close()
    expect(opened[0].closed).toBe(true)
  })

  it('talks over a stream socket, as inside a Bare worklet', async () => {
    const { Socket, opened } = streamSocket()
    const client = new ElectrumClient({ servers: ['wss://one'], WebSocket: Socket })
    expect(await client.request('blockchain.scripthash.listunspent', ['ab'])).toEqual({ method: 'blockchain.scripthash.listunspent', params: ['ab'] })
    await client.close()
    expect(opened[0].destroyed).toBe(true)
  })

  it('moves on to the next server when one refuses', async () => {
    const { Socket, opened } = w3cSocket({ refuse: ['wss://down'] })
    const client = new ElectrumClient({ servers: ['wss://down', 'wss://up'], WebSocket: Socket })
    expect(await client.request('ping')).toEqual({ method: 'ping', params: [] })
    expect(opened.map(s => s.url)).toEqual(['wss://down', 'wss://up'])
  })

  it('reconnects after the stream closes', async () => {
    const { Socket, opened } = streamSocket()
    const client = new ElectrumClient({ servers: ['wss://one'], WebSocket: Socket })
    await client.request('ping')
    opened[0].emit('close')
    expect(await client.request('ping')).toEqual({ method: 'ping', params: [] })
    expect(opened).toHaveLength(2)
  })
})
