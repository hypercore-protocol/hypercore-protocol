const SHP = require('simple-hypercore-protocol')
const crypto = require('hypercore-crypto')
const { Duplex } = require('streamx')

class Channelizer {
  constructor (stream) {
    this.stream = stream
    this.created = new Map()
    this.local = []
    this.remote = []
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

    const fresh = new Channel(this.stream.state, dk, this)
    this.created.set(hex, fresh)
    return fresh
  }

  onauthenticate (key, done) {
    if (this.stream.handlers && this.stream.handlers.onauthenticate) this.stream.handlers.onauthenticate(key, done)
  }

  onhandshake () {
    if (this.stream.handlers && this.stream.handlers.onhandshake) this.stream.handlers.onhandshake()
  }

  onopen (channelId, message) {
    const ch = this.createChannel(message.discoveryKey)
    ch.remoteCapability = message.capability
    this.attachRemote(ch, channelId)
    if (ch.localId === -1 && this.stream.handlers.onremoteopen) this.stream.handlers.onremoteopen(ch.discoveryKey)
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
      if (ch.handlers && ch.handlers.onclose) ch.handlers.onclose()
      this.remote[channelId] = null
    } else if (message.discoveryKey) {
      const local = this.getChannel(message.discoveryKey)
      if (local && local.handlers && local.handlers.onclose) local.handlers.onclose()
    }
    const dk = ch ? ch.discoveryKey : message.discoveryKey
    if (dk) this.destroyChannel(dk)
  }

  // called by the state machine
  send (data) {
    return this.stream.push(data)
  }

  // called by the state machine
  destroy (err) {
    this.stream.destroy(err)
    for (const ch of this.created.values()) {
      this.destroyChannel(ch.discoveryKey)
    }
  }

  destroyChannel (dk) {
    const k = dk.toString('hex')
    const ch = this.created.get(k)
    this.created.delete(k)
    if (ch) ch.destroy()
  }
}

class Channel {
  constructor (state, dk) {
    this.key = null
    this.discoveryKey = dk
    this.localId = -1
    this.remoteId = -1
    this.remoteCapability = null
    this.handlers = null
    this.destroyed = false
    this.state = state
  }

  get opened () {
    return this.localId > -1
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
    this.state.close(this.localId, {})
  }

  destroy () {
    if (this.destroyed) return
    this.destroyed = true
  }
}

module.exports = class ProtocolStream extends Duplex {
  constructor (initator, handlers = {}) {
    super()

    this.initator = initator
    this.handlers = handlers
    this.channelizer = new Channelizer(this)
    this.state = new SHP(initator, this.channelizer)
    this.once('finish', this.push.bind(this, null))
  }

  get publicKey () {
    return this.state.publicKey
  }

  get remotePublicKey () {
    return this.state.remotePublicKey
  }

  _write (data, cb) {
    this.state.recv(data)
    cb(null)
  }

  _destroy (err) {
    this.channelizer.destroy()
    this.state.destroy(err)
  }

  remoteVerified (key) {
    const ch = this.channelizer.getChannel(crypto.discoveryKey(key))
    return !!ch && !!ch.remoteCapability && ch.remoteCapability.equals(this.state.remoteCapability(key))
  }

  opened (key) {
    const ch = this.channelizer.getChannel(crypto.discoveryKey(key))
    return !!(ch && ch.localId > -1)
  }

  setTimeout (ms, ontimeout) {
  }

  get channelCount () {
    return this.channelizer.channels.size
  }

  get channels () {
    return this.channelizer.channels.values()
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
