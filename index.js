var crypto = require('crypto')
var duplexify = require('duplexify')
var inherits = require('inherits')
var varint = require('varint')
var events = require('events')
var messages = require('./messages')
var stream = require('readable-stream')
var lpstream = require('length-prefixed-stream')
var encryption = require('sodium-encryption')
var increment = require('increment-buffer')
var equals = require('buffer-equals')

var KEEP_ALIVE = Buffer([0])
var ENCODERS = [
  messages.Handshake,
  null, // close
  null, // pause
  null, // resume
  messages.Have,
  messages.Want,
  messages.Request,
  messages.Response,
  messages.Cancel
]

module.exports = use([])

function use (extensions) {
  if (extensions.length > 64) {
    throw new Error('Only 64 extensions are supported')
  }

  function Channel (stream, publicId) {
    events.EventEmitter.call(this)

    this.feed = null
    this.stream = stream
    this.publicId = publicId
    this.key = null
    this.closed = false

    this.remotePaused = true
    this.amPaused = true

    // populated by hypercore. defined here so v8 is happy
    this.feed = null
    this.remoteBitfield = null
    this.remoteTree = null

    this._firstMessage = null
    this._encrypted = stream.encrypted
    this._receivedHandshake = false
    this._nonce = null
    this._remoteNonce = null
    this._local = -1
    this._remote = -1
  }

  inherits(Channel, events.EventEmitter)

  Channel.prototype.handshake = function (handshake) {
    if (!handshake) handshake = {}
    if (!this.stream.remoteId) {
      handshake.peerId = this.stream.id
      handshake.extensions = extensions
    }

    this.amPaused = !!handshake.paused
    this._send(0, handshake)
  }

  Channel.prototype.close = function (err) {
    if (err) return this.stream.destroy(err) // fatal close

    var keyHex = this.publicId.toString('hex')
    if (this.stream._channels[keyHex] !== this) return

    delete this.stream._channels[keyHex]
    if (this._remote > -1) this.stream._remote[this._remote] = null
    if (this._local > -1) this.stream._local[this._local] = null

    this.closed = true
    this.remotePaused = true
    this.emit('close')

    if (this.key && !this.stream.destroyed && this._receivedHandshake) this._send(1, null)
  }

  Channel.prototype.pause = function () {
    this._send(2, null)
  }

  Channel.prototype.resume = function () {
    this._send(3, null)
  }

  Channel.prototype.have = function (have) {
    this._send(4, have)
  }

  Channel.prototype.want = function (want) {
    this._send(5, want)
  }

  Channel.prototype.request = function (request) {
    this._send(6, request)
  }

  Channel.prototype.response = function (response) {
    this._send(7, response)
  }

  Channel.prototype.cancel = function (cancel) {
    this._send(8, cancel)
  }

  Channel.prototype.remoteSupports = function (id) {
    return this.stream.remoteSupports(id)
  }

  Channel.prototype._open = function (key) {
    if (this.key) return
    this.key = key

    this._local = this.stream._local.indexOf(null)
    if (this._local === -1) this._local = this.stream._local.push(null) - 1
    this.stream[this._local] = this
    this._nonce = crypto.randomBytes(24)

    var open = {publicId: this.publicId, nonce: this._nonce}
    var len = varint.encodingLength(this._local) + messages.Open.encodingLength(open)
    var buf = Buffer(varint.encodingLength(len) + len)
    var offset = 0

    varint.encode(len, buf, offset)
    offset += varint.encode.bytes

    varint.encode(this._local, buf, offset)
    offset += varint.encode.bytes

    messages.Open.encode(open, buf, offset)
    offset += messages.Open.encode.bytes

    this.stream._encode.push(buf)
    this.stream._keepAlive = 0

    if (this._firstMessage) {
      this._parse(this._firstMessage, 0)
      this._firstMessage = null
    }
  }

  Channel.prototype._encrypt = function (buf) {
    buf = encryption.encrypt(buf, this._nonce, this.key)
    if (this._receivedHandshake) increment(this._nonce)
    return buf
  }

  Channel.prototype._decrypt = function (buf) {
    buf = encryption.decrypt(buf, this._remoteNonce, this.key)
    if (!buf) return null
    if (this._receivedHandshake) increment(this._remoteNonce)
    return buf
  }

  Channel.prototype._parse = function (buf, offset) {
    if (!this.key) {
      if (this._firstMessage) {
        return this.stream.destroy(new Error('Remote send a message before waiting for handshake'))
      }
      this._firstMessage = buf.slice(offset)
      return
    }

    if (this._encrypted) {
      buf = this._decrypt(buf.slice(offset))
      offset = 0
      if (!buf) return this.stream.destroy(new Error('Could not decrypt message'))
    }

    var type = buf[offset++]
    if (type > 127) return this.stream.destroy(new Error('Only single byte bytes currently supported'))

    if (!this._receivedHandshake && type !== 0) {
      return this.stream.destroy(new Error('First message received should be a handshake'))
    }

    if (type >= 64) return this._onextension(type - 64, buf.slice(offset))

    var enc = ENCODERS[type]

    try {
      var message = enc && enc.decode(buf, offset)
    } catch (err) {
      this.stream.destroy(err)
      return
    }

    switch (type) {
      case 0: return this._onhandshake(message)
      case 1: return this.close()
      case 2: return this._onpause()
      case 3: return this._onresume()
      case 4: return this.emit('have', message)
      case 5: return this.emit('want', message)
      case 6: return this.emit('request', message)
      case 7: return this.emit('response', message)
      case 8: return this.emit('cancel', message)
    }
  }

  Channel.prototype._onextension = function (type, buf) {
    var ext = type < this.stream._remoteExtensions.length ? this.stream._remoteExtensions[type] : -1
    if (ext > -1) this.emit(extensions[ext], buf)
  }

  Channel.prototype._onpause = function () {
    if (this.remotePaused) return
    this.remotePaused = true
    this.emit('pause')
  }

  Channel.prototype._onresume = function () {
    if (!this.remotePaused) return
    this.remotePaused = false
    this.emit('resume')
  }

  Channel.prototype._onhandshake = function (handshake) {
    if (!this.stream.remoteId) this.stream._onhandshake(handshake)

    var nonce = this._nonce
    var remoteNonce = this._remoteNonce

    this._receivedHandshake = true
    this._nonce = createNonce(nonce, remoteNonce)
    this._remoteNonce = createNonce(remoteNonce, nonce)
    if (equals(this._nonce, this._remoteNonce)) return this.stream.destroy(new Error('Remote nonce is invalid'))

    this.remotePaused = handshake.paused
    this.emit('handshake', handshake)
  }

  Channel.prototype._send = function (type, message) {
    if (this.closed && type !== 1) return
    if (!this._receivedHandshake && type !== 0) throw new Error('Wait for remote handshake')

    var enc = type < ENCODERS.length ? ENCODERS[type] : null
    var tmp = Buffer(1 + (enc ? enc.encodingLength(message) : (message ? message.length : 0)))

    tmp[0] = type
    if (enc) enc.encode(message, tmp, 1)
    else if (message) message.copy(tmp, 1)

    if (this._encrypted) tmp = this._encrypt(tmp)

    var len = varint.encodingLength(this._local) + tmp.length
    var buf = Buffer(varint.encodingLength(len) + len)
    var offset = 0

    varint.encode(len, buf, offset)
    offset += varint.encode.bytes

    varint.encode(this._local, buf, offset)
    offset += varint.encode.bytes

    tmp.copy(buf, offset)

    this.stream._encode.push(buf)
    this.stream._keepAlive = 0
  }

  Channel.prototype._onopen = function (message, remote) {
    this._remote = remote
    this.stream._remote[remote] = this
    this._remoteNonce = message.nonce
    this.emit('open')
  }

  extensions.forEach(function (name, id) {
    if (name === 'error' || !/^[a-z][_a-z0-9]+$/i.test(name) || Channel.prototype[name]) {
      throw new Error('Invalid extension name: ' + name)
    }

    Channel.prototype[name] = function (buf) {
      this._send(id + 64, buf)
    }
  })

  function Protocol (opts, onopen) {
    if (!(this instanceof Protocol)) return new Protocol(opts, onopen)
    if (!opts) opts = {}
    if (typeof opts === 'function') {
      onopen = opts
      opts = {}
    }

    duplexify.call(this)

    var self = this

    this.id = opts.id || crypto.randomBytes(32)
    this.remoteId = null
    this.encrypted = opts.encrypt !== false

    this._channels = {}
    this._local = []
    this._remote = []
    this._onopen = onopen || opts.open || noop

    this._keepAlive = 0
    this._remoteKeepAlive = 0
    this._interval = null

    this._remoteExtensions = new Array(extensions.length)
    this._localExtensions = new Array(extensions.length)
    for (var i = 0; i < extensions.length; i++) {
      this._remoteExtensions[i] = this._localExtensions[i] = -1
    }

    this._encode = new stream.Readable()
    this._encode._read = noop
    this.setReadable(this._encode)

    this._decode = lpstream.decode({allowEmpty: true, limit: 5 * 1024 * 1024})
    this._decode.on('data', parse)
    this.setWritable(this._decode)

    this.on('end', this.destroy)
    this.on('finish', this.destroy)
    this.on('close', this._close)

    function parse (data) {
      self._parse(data)
    }
  }

  inherits(Protocol, duplexify)

  Protocol.extensions = extensions
  Protocol.use = function (ext) {
    return use(extensions.concat(ext).sort().filter(noDups))
  }

  Protocol.prototype.remoteSupports = function (id) {
    var i = typeof id === 'number' ? id : extensions.indexOf(id)
    return this._localExtensions[i] > -1
  }

  Protocol.prototype.setTimeout = function (ms, ontimeout) {
    if (ontimeout) this.once('timeout', ontimeout)
    var self = this

    this._keepAlive = 0
    this._remoteKeepAlive = 0

    clearInterval(this._interval)
    this._interval = setInterval(kick, (ms / 4) | 0)
    if (this._interval) this._interval.unref()

    function kick () {
      if (self._remoteKeepAlive > 4) {
        clearInterval(self._interval)
        self.emit('timeout')
        return
      }

      self._remoteKeepAlive++
      if (self._keepAlive > 2) {
        self._encode.push(KEEP_ALIVE)
        self._keepAlive = 0
      } else {
        self._keepAlive++
      }
    }
  }

  Protocol.prototype.channel = function (key, publicId) {
    if (!publicId) publicId = crypto.createHmac('sha256', key).update('hypercore').digest()

    var keyHex = publicId.toString('hex')
    var channel = this._channels[keyHex]

    if (!channel) channel = this._channels[keyHex] = new Channel(this, publicId)
    if (channel.key) return channel
    channel._open(key)
    return channel
  }

  Protocol.prototype.keys = function () {
    var keys = Object.keys(this._channels)
    var list = []
    for (var i = 0; i < keys.length; i++) {
      var key = this._channels[keys[i]].key
      if (key) list.push(key)
    }
    return list
  }

  Protocol.prototype._close = function () {
    clearInterval(this._interval)
    var keys = Object.keys(this._channels)
    for (var i = 0; i < keys.length; i++) {
      var ch = this._channels[keys[i]]
      if (ch.key) ch.close()
    }
  }

  Protocol.prototype._parse = function (data) {
    this._remoteKeepAlive = 0
    if (!data.length) return

    var remote = varint.decode(data)
    var offset = varint.decode.bytes

    if (remote === this._remote.length) this._remote.push(null)
    if (remote > this._remote.length) {
      return this.destroy(new Error('Received invalid channel'))
    }

    var channel = this._remote[remote]
    if (channel) {
      return channel._parse(data, offset)
    }

    if (this._remote.indexOf(null) !== remote) {
      return this.destroy(new Error('Received invalid channel'))
    }

    this._open(remote, data, offset)
  }

  Protocol.prototype._onhandshake = function (handshake) {
    // called with the first handshake
    this.remoteId = handshake.peerId || crypto.randomBytes(32)

    // extensions *must* be sorted
    var local = 0
    var remote = 0

    while (local < extensions.length && remote < handshake.extensions.length && remote < 64) {
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

    this.emit('handshake')
  }

  Protocol.prototype._open = function (remote, data, offset) {
    try {
      var open = messages.Open.decode(data, offset)
    } catch (err) {
      return
    }

    if (open.publicId.length !== 32 || open.nonce.length !== 24) return

    var keyHex = open.publicId.toString('hex')
    var channel = this._channels[keyHex]

    if (channel) {
      channel._onopen(open, remote)
      return
    }

    channel = this._channels[keyHex] = new Channel(this, open.publicId)
    channel._onopen(open, remote)
    this._onopen(open.publicId)
  }

  return Protocol
}

function noop () {}

function createNonce (a, b) {
  return crypto.createHash('sha256').update(a).update(b).digest().slice(0, 24)
}

function noDups (name, i, extensions) {
  return extensions.indexOf(name) === i
}
