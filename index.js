const SHP = require('simple-hypercore-protocol')
const crypto = require('hypercore-crypto')
const timeout = require('timeout-refresh')
const { Duplex } = require('streamx')

class Channelizer {
  constructor (stream, encrypted, keyPair) {
    this.stream = stream
    this.created = new Map()
    this.local = []
    this.remote = []
    this.encrypted = encrypted !== false
    this.keyPair = keyPair
  }

  allocLocal () {
    const id = this.local.indexOf(null)
    if (id > -1) return id
    this.local.push(null)
    return this.local.length - 1
  }

  attachLocal (ch) {
    const id = this.allocLocal()
    this.local[id] = ch
    ch.localId = id
  }

  attachRemote (ch, id) {
    if (this.remote.length === id) this.remote.push(null)
    this.remote[id] = ch
    ch.remoteId = id
  }

  getChannel (dk) {
    return this.created.get(dk.toString('hex'))
  }

  createChannel (dk) {
    const hex = dk.toString('hex')

    const old = this.created.get(hex)
    if (old) return old

    const fresh = new Channel(this.stream.state, this.stream, dk)
    this.created.set(hex, fresh)
    return fresh
  }

  onauthenticate (key, done) {
    if (this.stream.handlers && this.stream.handlers.onauthenticate) this.stream.handlers.onauthenticate(key, done)
    else done(null)
  }

  onhandshake () {
    if (this.stream.handlers && this.stream.handlers.onhandshake) this.stream.handlers.onhandshake()
  }

  onopen (channelId, message) {
    const ch = this.createChannel(message.discoveryKey)
    ch.remoteCapability = message.capability
    this.attachRemote(ch, channelId)
    if (this.stream.handlers.onremoteopen) {
      if (ch.localId === -1) this.stream.handlers.onremoteopen(ch.discoveryKey)
      this.stream.emit('remoteopen', ch.discoveryKey)
    }
    if (ch.handlers && ch.handlers.onopen) ch.handlers.onopen()
  }

  onoptions (channelId, message) {
    const ch = this.remote[channelId]
    if (ch && ch.handlers && ch.handlers.onoptions) ch.handlers.onoptions(message)
  }

  onstatus (channelId, message) {
    const ch = this.remote[channelId]
    if (ch && ch.handlers && ch.handlers.onstatus) ch.handlers.onstatus(message)
  }

  onhave (channelId, message) {
    const ch = this.remote[channelId]
    if (ch && ch.handlers && ch.handlers.onhave) ch.handlers.onhave(message)
  }

  onunhave (channelId, message) {
    const ch = this.remote[channelId]
    if (ch && ch.handlers && ch.handlers.onunhave) ch.handlers.onunhave(message)
  }

  onwant (channelId, message) {
    const ch = this.remote[channelId]
    if (ch && ch.handlers && ch.handlers.onwant) ch.handlers.onwant(message)
  }

  onunwant (channelId, message) {
    const ch = this.remote[channelId]
    if (ch && ch.handlers && ch.handlers.onunwant) ch.handlers.onunwant(message)
  }

  onrequest (channelId, message) {
    const ch = this.remote[channelId]
    if (ch && ch.handlers && ch.handlers.onrequest) ch.handlers.onrequest(message)
  }

  oncancel (channelId, message) {
    const ch = this.remote[channelId]
    if (ch && ch.handlers && ch.handlers.oncancel) ch.handlers.oncancel(message)
  }

  ondata (channelId, message) {
    const ch = this.remote[channelId]
    if (ch && ch.handlers && ch.handlers.ondata) ch.handlers.ondata(message)
  }

  onclose (channelId, message) {
    const ch = channelId < this.remote.length ? this.remote[channelId] : null

    if (ch) {
      this.remote[channelId] = null
      if (ch.handlers && ch.handlers.onclose) ch.handlers.onclose()
    } else if (message.discoveryKey) {
      const local = this.getChannel(message.discoveryKey)
      if (local && local.handlers && local.handlers.onclose) local.handlers.onclose()
    }

    if (ch && ch.localId > -1) {
      this.local[ch.localId] = null
    }

    if (ch) {
      this.created.delete(ch.discoveryKey.toString('hex'))
      this.stream._prefinalize()
    }
  }

  // called by the state machine
  send (data) {
    if (this.stream.keepAlive !== null) this.stream.keepAlive.refresh()
    return this.stream.push(data)
  }

  // called by the state machine
  destroy (err) {
    this.stream.destroy(err)
    for (const ch of this.created.values()) ch.destroy(err)
    this.created.clear()
  }
}

class Channel {
  constructor (state, stream, dk) {
    this.key = null
    this.discoveryKey = dk
    this.localId = -1
    this.remoteId = -1
    this.remoteCapability = null
    this.handlers = null
    this.state = state
    this.stream = stream
  }

  get opened () {
    return this.localId > -1
  }

  get closed () {
    return this.localId === -1
  }

  get remoteOpened () {
    return this.remoteId > -1
  }

  options (message) {
    return this.state.options(this.localId, message)
  }

  status (message) {
    return this.state.status(this.localId, message)
  }

  have (message) {
    return this.state.have(this.localId, message)
  }

  unhave (message) {
    return this.state.unhave(this.localId, message)
  }

  want (message) {
    return this.state.want(this.localId, message)
  }

  unwant (message) {
    return this.state.unwant(this.localId, message)
  }

  request (message) {
    return this.state.request(this.localId, message)
  }

  cancel (message) {
    return this.state.cancel(this.localId, message)
  }

  data (message) {
    return this.state.data(this.localId, message)
  }

  close () {
    if (this.closed) return
    this.state.close(this.localId, {})
  }

  destroy (err) {
    this.stream.destroy(err)
  }
}

module.exports = class ProtocolStream extends Duplex {
  constructor (initator, handlers = {}) {
    super()

    this.initator = initator
    this.handlers = handlers
    this.channelizer = new Channelizer(this, handlers.encrypted, handlers.keyPair)
    this.state = new SHP(initator, this.channelizer)
    this.timeout = null
    this.keepAlive = null
    this.autoSeal = handlers.autoSeal !== false
    this.sealed = false

    this.once('finish', this.push.bind(this, null))

    if (handlers.timeout !== false && handlers.timeout !== 0) {
      const timeout = handlers.timeout || 20000
      this.setTimeout(timeout, () => this.destroy(new Error('ETIMEDOUT')))
      this.setKeepAlive(Math.ceil(timeout / 2))
    }
  }

  get publicKey () {
    return this.state.publicKey
  }

  get remotePublicKey () {
    return this.state.remotePublicKey
  }

  _write (data, cb) {
    if (this.timeout !== null) this.timeout.refresh()
    this.state.recv(data)
    cb(null)
  }

  _destroy (cb) {
    this.channelizer.destroy()
    this.state.destroy()
    cb(null)
  }

  _predestroy () {
    this.timeout.destroy()
    this.timeout = null
    this.keepAlive.destroy()
    this.keepAlive = null
  }

  _prefinalize () {
    if (this.channelCount) return
    if (!this.autoSeal && !this.sealed) return
    this.finalize()
  }

  seal () {
    this.sealed = true
    this._prefinalize()
  }

  remoteVerified (key) {
    const ch = this.channelizer.getChannel(crypto.discoveryKey(key))
    return !!ch && !!ch.remoteCapability && ch.remoteCapability.equals(this.state.remoteCapability(key))
  }

  opened (key) {
    const ch = this.channelizer.getChannel(crypto.discoveryKey(key))
    return !!(ch && ch.localId > -1)
  }

  ping () {
    return this.state.ping()
  }

  setKeepAlive (ms) {
    if (this.keepAlive) this.keepAlive.destroy()
    if (!ms) {
      this.keepAlive = null
      return
    }
    this.keepAlive = timeout(ms, ping, this)

    function ping () {
      this.ping()
      this.keepAlive = timeout(ms, ping, this)
    }
  }

  setTimeout (ms, ontimeout) {
    if (this.timeout) this.timeout.destroy()
    if (!ms) {
      this.timeout = null
      return
    }
    this.timeout = timeout(ms, this.emit.bind(this, 'timeout'))
    if (ontimeout) this.once('timeout', ontimeout)
  }

  get channelCount () {
    return this.channelizer.created.size
  }

  get channels () {
    return this.channelizer.created.values()
  }

  open (key, handlers) {
    const discoveryKey = crypto.discoveryKey(key)
    const ch = this.channelizer.createChannel(discoveryKey)

    if (ch.key === null) {
      ch.key = key
      this.channelizer.attachLocal(ch)
      this.state.open(ch.local, { key, discoveryKey })
    }

    if (handlers) ch.handlers = handlers

    return ch
  }

  close (key) {
    const discoveryKey = crypto.discoveryKey(key)
    const ch = this.channelizer.getChannel(discoveryKey)

    if (ch) ch.close()
    else this.state.close(this.channelizer.allocLocal(), { discoveryKey })
  }

  finalize () {
    this.push(null)
  }
}
