var duplexify = require('duplexify')
var inherits = require('inherits')
var crypto = require('crypto')
var varint = require('varint')
var lpstream = require('length-prefixed-stream')
var stream = require('readable-stream')
var events = require('events')
var sodium = require('sodium-prebuilt').api // TODO: make me work in the browser
var increment = require('increment-buffer')
var bitfield = require('bitfield')
var messages = require('./messages')

var MAX_BITFIELD = 4 * 1024 * 1024
var MAX_MESSAGE = 5 * 1024 * 1024
var MAX_EXTENSIONS = 64 // theoretically we can support any amount though
var MAX_SINGLE_BYTE_VARINT = 127
var EXTENSION_OFFSET = 64
var KEEP_ALIVE = Buffer([0])

var INVALID_EXTENSIONS = [
  'data',
  'flush',
  'close',
  'drain',
  'readable',
  'finish',
  'prefinish',
  'error'
]

var ENCODERS = [
  messages.Handshake,
  null, // close
  messages.Have,
  null, // pause
  null, // resume
  messages.Request,
  messages.Response,
  messages.Cancel
]

module.exports = use([])

function use (extensions) {
  if (extensions.length > MAX_EXTENSIONS) {
    throw new Error('Only ' + MAX_EXTENSIONS + ' extensions are supported')
  }

  function Channel (protocol, id) {
    events.EventEmitter.call(this)

    this.id = id
    this.key = null
    this.context = null // someone else can set this

    this.remoteOpened = false
    this.opened = false

    this.closed = false

    this.remotePausing = true
    this.pausing = true

    this.remoteBitfield = bitfield(1, {grow: MAX_BITFIELD})

    this._secure = protocol._secure !== false
    this._nonce = null
    this._remoteNonce = null
    this._buffer = null
    this._protocol = protocol
    this._encode = protocol._encode
    this._localId = -1
    this._localIdLen = 0
    this._remoteId = -1
  }

  inherits(Channel, events.EventEmitter)

  Channel.prototype._onopen = function (remoteId, remoteNonce) {
    if (this.remoteOpened) return
    this.remoteOpened = true

    this._remoteNonce = remoteNonce
    this._remoteId = remoteId
    this._protocol._remote[remoteId] = this
    this.emit('open')
  }

  Channel.prototype.handshake = function (handshake) {
    this._send(0, handshake)
  }

  Channel.prototype.close = function () {
    if (this.closed) return
    this._send(1)
    this.closed = true
    this.remotePausing = true
    this.pausing = true

    if (this._protocol._local[this._localId] === this) {
      this._protocol._local[this._localId] = null
      delete this._protocol._channels[this.id.toString('hex')]
    }

    this.emit('close')
    this.emit('update')
  }

  Channel.prototype.have = function (blocks, bitfield) {
    if (typeof blocks === 'number') blocks = [blocks]
    this._send(2, {blocks: blocks, bitfield: toBuffer(bitfield)})
  }

  Channel.prototype.resume = function () {
    this._send(3, null)
  }

  Channel.prototype.pause = function () {
    this._send(4, null)
  }

  Channel.prototype.request = function (block) {
    this._send(5, {block: block})
  }

  Channel.prototype.response = function (block, data, proof) {
    this._send(6, {block: block, data: data, proof: proof})
  }

  Channel.prototype.cancel = function (block) {
    this._send(7, {block: block})
  }

  Channel.prototype.remoteSupports = function (id) {
    return this._protocol.remoteSupports(id)
  }

  Channel.prototype._open = function (key) {
    if (this.opened) return
    this.opened = true
    this.key = key

    this._localId = this._protocol._local.indexOf(null)
    if (this._localId === -1) this._localId = this._protocol._local.push(null) - 1

    this._protocol._local[this._localId] = this
    this._nonce = crypto.randomBytes(24)
    this._localIdLen = varint.encodingLength(this._localId)

    var open = {
      nonce: this._nonce,
      id: this.id
    }

    var len = this._localIdLen + messages.Open.encodingLength(open)
    var buf = Buffer(varint.encodingLength(len) + len)
    var offset = 0

    varint.encode(len, buf, 0)
    offset += varint.encode.bytes

    varint.encode(this._localId, buf, offset)
    offset += varint.encode.bytes

    messages.Open.encode(open, buf, offset)
    this._encode.write(buf)

    if (!this._protocol.remoteId) {
      this.handshake({
        peer: this._protocol.id,
        extensions: extensions
      })
    }

    this._protocol.emit('channel', key, this)

    if (!this._buffer) return
    while (this._buffer.length) this._onmessage(this._buffer.shift(), 0)
  }

  Channel.prototype._send = function (type, message) {
    if (this.closed) return

    var enc = ENCODERS[type]
    var buf = null

    // TODO: add result buffer support to sodium

    if (type >= EXTENSION_OFFSET) {
      if (!message) message = Buffer(0)
      buf = Buffer(1 + message.length)
      message.copy(buf, 1)
    } else {
      buf = Buffer(1 + (enc ? enc.encodingLength(message) : 0))
      if (enc) enc.encode(message, buf, 1)
    }

    buf[0] = type

    var cipher = this._secure ? this._encrypt(buf) : buf
    var len = cipher.length + this._localIdLen
    var container = Buffer(varint.encodingLength(len) + len)
    var offset = 0

    varint.encode(len, container, offset)
    offset += varint.encode.bytes

    varint.encode(this._localId, container, offset)
    offset += varint.encode.bytes

    cipher.copy(container, offset)
    this._encode.write(container)
  }

  Channel.prototype._onmessage = function (buf, offset) {
    if (!this.opened) {
      if (!this._buffer) this._buffer = []

      if (this._buffer.length >= 16) {
        this.emit('warning', new Error('Buffer overflow'))
        this.close()
        return
      }

      this._buffer.push(buf.slice(offset))
      return
    }

    var plain = this._secure ? this._decrypt(buf.slice(offset)) : buf.slice(offset)
    if (!plain) return

    var type = plain[0]
    if (type > MAX_SINGLE_BYTE_VARINT) return
    if (type >= EXTENSION_OFFSET) return this._onextension(type, plain)
    if (type >= ENCODERS.length) return

    var enc = ENCODERS[type]

    try {
      var message = enc ? enc.decode(plain, 1) : null
    } catch (err) {
      return
    }

    switch (type) {
      case 0: return this._onhandshake(message)
      case 1: return this._onclose()
      case 2: return this._onhave(message)
      case 3: return this._onresume()
      case 4: return this._onpause()
      case 5: return this._onrequest(message)
      case 6: return this._onresponse(message)
      case 7: return this._oncancel(message)
    }
  }

  Channel.prototype._onextension = function (type, message) {
    var ext = this._protocol._remoteExtensions[type - EXTENSION_OFFSET]
    if (ext > -1) this.emit(extensions[ext], message.slice(1))
  }

  Channel.prototype._onhandshake = function (handshake) {
    this._protocol._onhandshake(handshake)
    if (!this.closed) this.emit('handshake', handshake)
  }

  Channel.prototype._onclose = function () {
    if (this._protocol._remote[this._remoteId] === this) {
      this._protocol._remote[this._remoteId] = null
      this.close()
    }
  }

  Channel.prototype._onhave = function (message) {
    if (this.closed) return

    if (message.bitfield) {
      // TODO: this should be a proof bitfield instead
      this.remoteBitfield = bitfield(message.bitfield, {grow: MAX_BITFIELD})
    }

    var i = 0

    for (i = 0; i < message.blocks.length; i++) {
      var block = message.blocks[i]
      this.remoteBitfield.set(block)
    }

    this.emit('have')
    this.emit('update')
  }

  Channel.prototype._onresume = function () {
    if (this.closed) return
    this.remotePausing = false
    this.emit('resume')
    this.emit('update')
  }

  Channel.prototype._onpause = function () {
    if (this.closed) return
    this.remotePausing = true
    this.emit('pause')
    this.emit('update')
  }

  Channel.prototype._onrequest = function (message) {
    if (!this.closed) this.emit('request', message.block)
  }

  Channel.prototype._onresponse = function (message) {
    if (!this.closed) this.emit('response', message.block, message.data, message.proof)
  }

  Channel.prototype._oncancel = function (message) {
    if (!this.closed) this.emit('cancel', message.block)
  }

  Channel.prototype._decrypt = function (cipher) {
    var buf = sodium.crypto_secretbox_open_easy(cipher, this._remoteNonce, this.key)
    if (buf) increment(this._remoteNonce)
    return buf
  }

  Channel.prototype._encrypt = function (message) {
    var buf = sodium.crypto_secretbox_easy(message, this._nonce, this.key)
    if (buf) increment(this._nonce)
    return buf
  }

  extensions.forEach(function (name, id) {
    if (INVALID_EXTENSIONS.indexOf(name) > -1 || !/^[a-z][_a-z0-9]+$/i.test(name) || Channel.prototype[name]) {
      throw new Error('Invalid extension name: ' + name)
    }

    Channel.prototype[name] = function (buf) {
      this._send(id + EXTENSION_OFFSET, buf)
    }
  })

  function Protocol (opts) {
    if (!(this instanceof Protocol)) return new Protocol(opts)
    if (!opts) opts = {}
    duplexify.call(this)

    var self = this

    this.id = opts.id || crypto.randomBytes(32)
    this.remoteId = null

    this._remoteExtensions = new Array(extensions.length)
    this._localExtensions = new Array(extensions.length)
    for (var i = 0; i < extensions.length; i++) {
      this._remoteExtensions[i] = this._localExtensions[i] = -1
    }

    this._secure = opts.secure !== false
    this._nonce = null
    this._encode = stream.PassThrough()
    this._decode = lpstream.decode({limit: MAX_MESSAGE}).on('data', parse)
    this._channels = {}
    this._join = opts.join
    this._local = []
    this._remote = []
    this.on('finish', onfinish)

    this.setReadable(this._encode)
    this.setWritable(this._decode)

    function onfinish () {
      self._encode.end()
    }

    function parse (data) {
      self._parse(data)
    }
  }

  inherits(Protocol, duplexify)

  Protocol.prototype.keepAlive = function (time) {
    this._encode.write(KEEP_ALIVE)
  }

  Protocol.prototype.remoteSupports = function (id) {
    var i = typeof id === 'number' ? id : extensions.indexOf(id)
    return this._localExtensions[i] > -1
  }

  Protocol.prototype._onhandshake = function (handshake) {
    if (this.remoteId) return

    // extensions *must* be sorted
    var local = 0
    var remote = 0

    while (local < extensions.length && remote < handshake.extensions.length && remote < MAX_EXTENSIONS) {
      if (extensions[local] === handshake.extensions[remote]) {
        this._localExtensions[local] = remote
        this._remoteExtensions[remote] = local
        local++
        remote++
      } else if (extensions[local] < handshake.extensions[remote]) {
        local++
      } else {
        remote++
      }
    }

    this.remoteId = handshake.peerId || crypto.randomBytes(32)
    this.emit('handshake')
  }

  Protocol.prototype._parse = function (data) {
    if (!data.length) {
      return
    }

    var remoteId = varint.decode(data, 0)
    var offset = varint.decode.bytes

    if (!this._remote[remoteId]) {
      try {
        var open = messages.Open.decode(data, offset)
      } catch (err) {
        return
      }

      if (open.nonce.length === 24 && open.id.length === 32) {
        this._onjoin(open, remoteId)
      }
      return
    }

    this._remote[remoteId]._onmessage(data, offset)
  }

  Protocol.prototype._onjoin = function (open, remoteId) {
    var self = this
    var idHex = open.id.toString('hex')
    var ch = this._channels[idHex]

    if (ch) {
      ch._onopen(remoteId, open.nonce)
      return
    }

    if (!this._join) return

    ch = this._channels[idHex] = new Channel(this, open.id)
    ch._onopen(remoteId, open.nonce)

    this._join(open.id, function (err, key) {
      if (ch !== self._channels[idHex]) return // changed underneath us

      if (err) {
        ch.close()
        return
      }

      ch._open(key)
    })
  }

  Protocol.extensions = extensions
  Protocol.use = function (name) {
    return use(extensions.concat(name).sort().map(toString).filter(noDups))
  }

  Protocol.prototype.list = function () {
    var keys = Object.keys(this._channels)
    var list = []

    for (var i = 0; i < keys.length; i++) {
      var key = this._channels[keys[i]].key
      if (key) list.push(key)
    }

    return list
  }

  Protocol.prototype.leave = function (key) {
    assertKey(key)

    var id = publicId(key)
    var idHex = id.toString('hex')
    var ch = this._channels[idHex]

    if (ch) ch.close()
  }

  Protocol.prototype.join = function (key) {
    assertKey(key)

    var id = publicId(key)
    var idHex = id.toString('hex')
    var ch = this._channels[idHex]

    if (ch) {
      ch._open(key)
      return ch
    }

    ch = this._channels[idHex] = new Channel(this, id)
    ch._open(key)
    return ch
  }

  return Protocol
}

function assertKey (key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Key should be a 32 byte buffer')
}

function publicId (key) {
  return crypto.createHmac('sha256', key).update('hypercore').digest()
}

function toBuffer (bitfield) {
  if (!bitfield) return null
  if (Buffer.isBuffer(bitfield)) return bitfield
  return bitfield.buffer
}

function toString (val) {
  return val.toString()
}

function noDups (val, i, list) {
  return list.indexOf(val) === i
}
