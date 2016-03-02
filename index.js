var duplexify = require('duplexify')
var inherits = require('inherits')
var crypto = require('crypto')
var varint = require('varint')
var lpstream = require('length-prefixed-stream')
var stream = require('readable-stream')
var events = require('events')
var sodium = require('sodium-prebuilt').api
var increment = require('increment-buffer')
var bitfield = require('bitfield')
var messages = require('./messages')

module.exports = Protocol

var MAX_BITFIELD = 4 * 1024 * 1024
var MAX_MESSAGE = 5 * 1024 * 1024
var MAX_EXTENSIONS = 64 // theoretically we can support any amount though
var MAX_SINGLE_BYTE_VARINT = 127
var EXTENSION_OFFSET = 64

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

function Channel (protocol, id) {
  events.EventEmitter.call(this)

  this.id = id
  this.key = null
  this.context = null // someone else can set this

  this.remoteOpened = false
  this.opened = false

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
  this._send(1)
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
      extensions: this._protocol.extensions
    })
  }

  this._protocol.emit('channel', key, this)

  if (!this._buffer) return
  while (this._buffer.length) this._onmessage(this._buffer.shift(), 0)
}

Channel.prototype._send = function (type, message) {
  var enc = ENCODERS[type]

  // TODO: add result buffer support to sodium

  var mlen = enc ? enc.encodingLength(message) : 0
  var buf = Buffer(1 + mlen)
  buf[0] = type
  if (enc) enc.encode(message, buf, 1)

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
    this._buffer.push(buf.slice(offset))
    return
  }

  var plain = this._secure ? this._decrypt(buf.slice(offset)) : buf.slice(offset)
  if (!plain) return

  var type = plain[0]
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

Channel.prototype._onhandshake = function (handshake) {
  this._protocol._onhandshake(handshake)
  this.emit('handshake', handshake)
}

Channel.prototype._onclose = function () {
  console.log('onclose')
}

Channel.prototype._onhave = function (message) {
  if (message.bitfield) {
    // TODO: this should be a proof bitfield instead
    this.remoteBitfield = bitfield(message.bitfield, {grow: MAX_BITFIELD})
  }
  if (message.blocks) {
    for (var i = 0; i < message.blocks.length; i++) {
      var block = message.blocks[i]
      this.remoteBitfield.set(block)
    }
  }

  this.emit('have')
  this.emit('update')
}

Channel.prototype._onresume = function () {
  this.remotePausing = false
  this.emit('resume')
  this.emit('update')
}

Channel.prototype._onpause = function () {
  this.remotePausing = true
  this.emit('pause')
  this.emit('update')
}

Channel.prototype._onrequest = function (message) {
  this.emit('request', message.block)
}

Channel.prototype._onresponse = function (message) {
  this.emit('response', message.block, message.data, message.proof)
}

Channel.prototype._oncancel = function (message) {
  this.emit('cancel', message.block)
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

function Protocol (opts) {
  if (!(this instanceof Protocol)) return new Protocol(opts)
  if (!opts) opts = {}
  duplexify.call(this)

  var self = this

  this.id = opts.id || crypto.randomBytes(32)
  this.remoteId = null

  this._secure = opts.secure !== false
  this._nonce = null
  this._encode = stream.PassThrough()
  this._decode = lpstream.decode({limit: MAX_MESSAGE}).on('data', parse)
  this._channels = {}
  this._join = opts.join
  this._local = []
  this._remote = []

  this.setReadable(this._encode)
  this.setWritable(this._decode)

  function parse (data) {
    self._parse(data)
  }
}

inherits(Protocol, duplexify)

Protocol.prototype._onhandshake = function (handshake) {
  if (this.remoteId) return
  this.remoteId = handshake.peer
  this.emit('handshake')
}

Protocol.prototype._parse = function (data) {
  var remoteId = varint.decode(data, 0)
  var offset = varint.decode.bytes

  if (!this._remote[remoteId]) {
    try {
      var open = messages.Open.decode(data, offset)
    } catch (err) {
      return
    }

    this._onjoin(open, remoteId)
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

  ch = this._channels[idHex] = new Channel(this, open.id)
  ch._onopen(remoteId, open.nonce)
  if (!this._join) return

  this._join(open.id, function (err, key) {
    if (ch !== self._channels[idHex]) return // changed underneath us

    if (err) {
      ch.close()
      return
    }

    ch._open(key)
  })
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

Protocol.prototype.join = function (key) {
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

function publicId (key) {
  return crypto.createHmac('sha256', key).update('hypercore').digest()
}

function toBuffer (bitfield) {
  if (!bitfield) return null
  if (Buffer.isBuffer(bitfield)) return bitfield
  return bitfield.buffer
}
