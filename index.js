var events = require('events')
var channels = require('stream-channels')
var inherits = require('inherits')
var increment = require('increment-buffer')
var pe = require('passthrough-encoding')
var xtend = require('xtend')
var sodium = require('sodium-native')
var messages = require('./messages')

// increment = function ( buf) {

// }

var DEFAULT_TYPES = [
  messages.Handshake,
  messages.Have,
  messages.Want,
  messages.Request,
  messages.Data,
  messages.Cancel,
  null, // pause
  null, // resume
  null,  // end
  messages.Unhave,
  messages.Unwant
]

var DEFAULT_EVENTS = [
  'handshake',
  'have',
  'want',
  'request',
  'data',
  'cancel',
  'pause',
  'resume',
  'end',
  'unhave',
  'unwant'
]

while (DEFAULT_EVENTS.length < 64) { // reserved
  DEFAULT_EVENTS.push('unknown')
  DEFAULT_TYPES.push(null)
}

module.exports = use({})

function use (extensions) {
  var extensionNames = Object.keys(extensions).sort()
  var types = DEFAULT_TYPES.slice(0)
  var eventNames = DEFAULT_EVENTS.slice(0)

  function Channel (stream) {
    events.EventEmitter.call(this)

    this.stream = stream
    this.outgoing = stream.createChannel({preallocated: true})
    this.outgoing.state = this
    this.nonce = random(sodium.crypto_stream_NONCEBYTES)
    this.state = null
    this.remoteNonce = null
    this.key = null
    this.discoveryKey = null
    this.closed = false
    this.opened = false

    this._buffer = []

    var self = this

    this.outgoing.on('close', onclose)
    this.outgoing.on('end', onclose)

    function onclose () {
      self.close()
    }
  }

  inherits(Channel, events.EventEmitter)

  Channel.prototype.remoteSupports = function (name) {
    return this.stream.remoteSupports(name)
  }

  Channel.prototype._onhandshake = function (handshake) {
    if (this.stream.remoteId) return
    this.stream.remoteId = handshake.id

    var exts = handshake.extensions
    // extensions *must* be sorted
    var local = 0
    var remote = 0

    while (local < extensionNames.length && remote < exts.length && remote < 64) {
      if (extensionNames[local] === exts[remote]) {
        this.stream._localExtensions[local] = remote
        this.stream._remoteExtensions[remote] = local
        local++
        remote++
      } else if (extensionNames[local] < exts[remote]) {
        local++
      } else {
        remote++
      }
    }

    this.stream.emit('handshake')
    this.emit('handshake')
  }

  Channel.prototype._ondata = function (data) {
    if (!data.length || this.closed) return // ignore

    if (!this.key || this._buffer.length) {
      if (this._buffer.length === 16) {
        return this.stream.destroy(new Error('Buffer overflow'))
      }

      this._buffer.push(data)
      return
    }

    if (this.stream.encrypted) {
      sodium.crypto_stream_xor(data, data, this.remoteNonce, this.key)
      increment(this.remoteNonce)
    }

    var type = this._parseType(data[0])
    if (type === -1 || type >= types.length) return // ignore

    var enc = types[type]
    var message = null

    if (enc && !(message = decode(enc, data, 1))) {
      this.stream.destroy(new Error('Invalid message'))
      return
    }

    if (type === 0) {
      this._onhandshake(message)
      return
    }

    var name = eventNames[type]
    this.emit(name, message)
  }

  Channel.prototype._onopenmaybe = function () {
    if (!this.opened && this.key && this.remoteNonce && !this.closed) {
      this.opened = true
      this.emit('open')
    }
  }

  Channel.prototype._parseType = function (type) {
    if (type > 127) return -1
    if (type < 64) return type
    if (type - 64 >= this.stream._remoteExtensions.length) return -1

    type = this.stream._remoteExtensions[type - 64]
    if (type === -1) return -1
    return type + 64
  }

  Channel.prototype.close = function () {
    if (this.closed) return
    this.closed = true
    if (!this.stream.destroyed) this.outgoing.end()
    this.emit('close')
  }

  extensionNames.forEach(function (name, type) {
    if (Channel.prototype[name] || name === 'error' || name === 'tick') {
      throw new Error('Invalid extension name')
    }

    types.push(isEncoder(extensions[name]) ? extensions[name] : pe)
    eventNames.push(name)
  })

  eventNames.forEach(function (name, type) {
    // TODO: faster if inlined using generate-function?
    Channel.prototype[name] = function (message) {
      var enc = types[type]
      var length = 1 + (enc ? enc.encodingLength(message) : 0)
      var data = this.outgoing.preallocate(length)
      var payload = data.slice(data.length - length)

      payload[0] = type
      if (enc) enc.encode(message, payload, 1)

      if (this.stream.encrypted) {
        sodium.crypto_stream_xor(payload, payload, this.nonce, this.key)
        increment(this.nonce)
      }

      return this.outgoing.write(data)
    }
  })

  function Protocol (opts, onopen) {
    if (!(this instanceof Protocol)) return new Protocol(opts, onopen)
    if (!opts) opts = {}

    channels.call(this, onchannel)

    var self = this
    if (!onopen) onopen = opts.onopen

    this.id = opts.id || random(32)
    this.remoteId = null
    this.extensions = extensionNames
    this.channels = {}
    this.debugging = !!(opts.debug || opts.debugMode)
    this.encrypted = opts.encrypt !== false

    this._remoteExtensions = new Array(extensionNames.length)
    this._localExtensions = new Array(extensionNames.length)
    for (var i = 0; i < extensionNames.length; i++) {
      this._remoteExtensions[i] = this._localExtensions[i] = -1
    }

    this.on('close', this._channelCleanup)
    this.on('end', this.destroy)
    if (onopen) this.on('open', onopen)

    function onchannel (incoming) {
      incoming.on('data', ondata)
      incoming.on('end', onclose)
      incoming.on('close', onclose)
    }

    function ondata (data) {
      if (this.state) this.state._ondata(data)
      else self._onopen(this, data)
    }

    function onclose () {
      if (this.state) this.state.close()
    }
  }

  inherits(Protocol, channels)

  Protocol.use = function (ext) {
    if (typeof ext === 'string') ext = toObject(ext)
    return use(xtend(ext, extensions))
  }

  Protocol.parseDiscoveryKey = function (buf) {
    var disc = messages.Open.decode(buf, 1).discoveryKey
    if (disc.length !== 32) throw new Error('Invalid message')
    return disc
  }

  Protocol.prototype.remoteSupports = function (name) {
    var i = typeof name === 'string' ? extensionNames.indexOf(name) : name
    return i > -1 && this._localExtensions[i] > -1
  }

  Protocol.prototype._onopen = function (incoming, data) {
    var open = decode(messages.Open, data, 0)

    if (!open || open.discoveryKey.length !== 32 || open.nonce.length !== 24) {
      this.destroy(new Error('Invalid open message'))
      return
    }

    var hex = open.discoveryKey.toString('hex')
    var channel = this.channels[hex] || new Channel(this)

    channel.remoteNonce = open.nonce
    channel.discoveryKey = open.discoveryKey
    this.channels[hex] = channel
    incoming.state = channel

    if (!channel.key) this.emit('open', open.discoveryKey)
    channel._onopenmaybe()
  }

  Protocol.prototype.open = function (key, disc) {
    if (this.destroyed) return null

    if (!disc) disc = discoveryKey(key)
    var hex = disc.toString('hex')
    var channel = this.channels[hex] || new Channel(this)

    channel.key = key
    channel.discoveryKey = disc
    this.channels[hex] = channel

    var length = messages.Open.encodingLength(channel)
    var buffer = channel.outgoing.preallocate(length)
    messages.Open.encode(channel, buffer, buffer.length - length)
    channel.outgoing.write(buffer)

    if (!this.remoteId) channel.handshake(this)

    channel._onopenmaybe()
    if (channel._buffer.length) this._shiftBuffer(channel)

    return channel
  }

  Protocol.prototype._channelCleanup = function () {
    var keys = Object.keys(this.channels)
    for (var i = 0; i < keys.length; i++) {
      this.channels[keys[i]].close()
    }
  }

  Protocol.prototype._shiftBuffer = function (channel) {
    process.nextTick(function () {
      var buf = channel._buffer
      channel._buffer = []
      while (buf.length) channel._ondata(buf.shift())
    })
  }

  return Protocol
}

function discoveryKey (key) {
  return require('crypto').createHmac('sha256', key).update('hypercore').digest()
}

function decode (enc, data, offset) {
  try {
    return enc.decode(data, offset)
  } catch (err) {
    return null
  }
}

function isEncoder (val) {
  return val && typeof val.encode === 'function'
}

function toObject (name) {
  var tmp = {}
  tmp[name] = true
  return tmp
}

function random (n) {
  var buf = new Buffer(n)
  sodium.randombytes_buf(buf)
  return buf
}
