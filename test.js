var tape = require('tape')
var protocol = require('./')

var key = Buffer('12345678123456781234567812345678')
var otherKey = Buffer('01234567012345670123456701234567')

tape('join channel', function (t) {
  var p = protocol()
  var ch = p.channel(key)

  t.same(ch.key.toString('hex'), key.toString('hex'), 'same key')
  t.end()
})

tape('join two channels', function (t) {
  var p = protocol()

  var channel = p.channel(key)
  var otherChannel = p.channel(otherKey)

  t.same(channel.key, key, 'expected channel key')
  t.same(otherChannel.key, otherKey, 'expected channel key')
  t.same(p.keys(), [key, otherKey], 'joined both channels')
  t.end()
})

tape('join and leave', function (t) {
  var p = protocol()

  t.same(p.keys(), [], 'not in any channel')
  var ch = p.channel(key)
  t.same(p.keys(), [key], 'joined channel')
  ch.close()
  t.same(p.keys(), [], 'not in any channel')
  ch.close()
  t.same(p.keys(), [], 'not in any channel')
  t.end()
})

tape('encrypts messages', function (t) {
  var p1 = protocol()
  var p2 = protocol()
  var buf = []

  p1.on('data', function (data) {
    buf.push(data)
  })

  p1.on('finish', function () {
    buf = Buffer.concat(buf)
    t.ok(buf.length > 32 + 20 + 25, 'sending some data') // ~ hmac + nonce + data
    t.same(buf.toString().indexOf('hello i should be encrypted'), -1, 'does not contain plaintext')
    t.end()
  })

  var ch1 = p1.channel(key)
  var ch2 = p2.channel(key)

  ch1.handshake()
  ch2.handshake()

  ch1.on('handshake', function () {
    t.pass('received handshake')
    ch1.response({block: 0, data: Buffer('hello i should be encrypted.')})
    p1.end()
  })

  p1.pipe(p2).pipe(p1)
})

tape('does not encrypt messages if encrypt === false', function (t) {
  var p1 = protocol({encrypt: false})
  var p2 = protocol({encrypt: false})
  var buf = []

  p1.on('data', function (data) {
    buf.push(data)
  })

  p1.on('finish', function () {
    buf = Buffer.concat(buf)
    t.ok(buf.length > 32 + 20 + 25, 'sending some data') // ~ hmac + nonce + data
    t.ok(buf.toString().indexOf('hello i should not be encrypted') > -1, 'does contain plaintext')
    t.end()
  })

  var ch1 = p1.channel(key)
  var ch2 = p2.channel(key)

  ch1.handshake()
  ch2.handshake()

  ch1.on('handshake', function () {
    t.pass('received handshake')
    ch1.response({block: 0, data: Buffer('hello i should not be encrypted.')})
    p1.end()
  })

  p1.pipe(p2).pipe(p1)
})

tape('one side encryption returns error', function (t) {
  var p1 = protocol({encrypt: false})
  var p2 = protocol()

  var ch1 = p1.channel(key)
  var ch2 = p2.channel(key)

  ch1.handshake()
  ch2.handshake()

  ch1.on('handshake', function () {
    t.fail('received handshake')
  })

  p1.on('error', function () {
    // there might be an error here as well
  })

  p2.on('error', function (err) {
    t.ok(err, 'had error')
    t.end()
  })

  p1.pipe(p2).pipe(p1)
})

tape('remote joins', function (t) {
  var p1 = protocol()
  var p2 = protocol()
  var remoteJoined = 2

  var ch1 = p1.channel(key)

  ch1.handshake()

  ch1.once('open', function () {
    t.pass('remote joined')
    remoteJoined--
  })

  ch1.on('request', function (request) {
    t.same(request.block, 42, 'received request')
    ch1.response({block: 42, data: Buffer('some data')})
  })

  var ch2 = p2.channel(key)

  ch2.handshake()

  p1.on('handshake', function () {
    ch2.request({block: 42})
  })

  ch2.on('response', function (response) {
    t.same(response.block, 42, 'received response')
    t.same(response.data, Buffer('some data'), 'expected data')
    t.same(remoteJoined, 0, 'both emitted open')
    t.end()
  })

  ch2.once('open', function () {
    t.pass('remote joined')
    remoteJoined--
  })

  p1.pipe(p2).pipe(p1)
})

tape('remote joins and closes', function (t) {
  var localClose = false
  var remoteClose = false

  var p1 = protocol()
  var p2 = protocol(function (publicId) {
    var channel = p2.channel(key)

    channel.handshake()
    channel.on('close', function () {
      remoteClose = true
      t.ok(localClose, 'local closed')
      t.ok(remoteClose, 'remote closed')
      t.end()
    })
  })

  var channel = p1.channel(key)

  channel.on('close', function () {
    localClose = true
  })

  channel.on('handshake', function () {
    channel.close()
  })

  channel.handshake()

  p1.pipe(p2).pipe(p1)
})

tape('times out', function (t) {
  var p1 = protocol()
  var p2 = protocol()

  // dummy timeout to keep event loop running
  var timeout = setTimeout(function () {}, 100000)

  p2.setTimeout(10, function () {
    p1.destroy()
    p2.destroy()
    clearTimeout(timeout)
    t.pass('timeout')
    t.end()
  })

  p1.pipe(p2).pipe(p1)
})

tape('timeout is implicit keep alive', function (t) {
  var p1 = protocol()
  var p2 = protocol()

  // dummy timeout to keep event loop running
  setTimeout(function () {
    p1.destroy()
    p2.destroy()
    t.pass('no timeouts')
    t.end()
  }, 500)

  p1.setTimeout(100, function () {
    t.fail('should not timeout')
  })

  p2.setTimeout(100, function () {
    t.fail('should not timeout')
  })

  p1.pipe(p2).pipe(p1)
})

tape('different timeouts', function (t) {
  var p1 = protocol()
  var p2 = protocol()

  // dummy timeout to keep event loop running
  var timeout = setTimeout(function () {}, 100000)

  p1.setTimeout(100, function () {
    clearTimeout(timeout)
    p1.destroy()
    p2.destroy()
    t.pass('should timeout')
    t.end()
  })

  p2.setTimeout(5000, function () {
    t.fail('should not timeout')
  })

  p1.pipe(p2).pipe(p1)
})

tape('leave channels on close', function (t) {
  t.plan(2)

  var p1 = protocol()
  var c1 = p1.channel(key)
  var c2 = p1.channel(otherKey)

  c1.once('close', function () {
    t.pass('first channel closed')
  })

  c2.once('close', function () {
    t.pass('second channel closed')
  })

  p1.destroy()
})

tape('extension', function (t) {
  t.plan(4)

  var protocol1 = protocol.use('test')
  var p1 = protocol1()
  var p2 = protocol1()

  var ch1 = p1.channel(key)
  var ch2 = p2.channel(key)

  ch1.handshake()
  ch2.handshake()

  p1.once('handshake', function () {
    t.ok(p1.remoteSupports('test'), 'protocol supported')
  })

  p2.once('handshake', function () {
    t.ok(p2.remoteSupports('test'), 'protocol supported')
  })

  ch2.on('handshake', function () {
    ch2.test(Buffer('hello world'))
  })

  ch1.once('test', function (buf) {
    t.same(buf, Buffer('hello world'), 'same buffer')
    ch1.test(Buffer('HELLO WORLD'))
  })

  ch2.once('test', function (buf) {
    t.same(buf, Buffer('HELLO WORLD'), 'same buffer')
  })

  p1.pipe(p2).pipe(p1)
})

tape('different extensions', function (t) {
  t.plan(8)

  var protocol1 = protocol.use(['test', 'bar'])
  var protocol2 = protocol.use(['foo', 'test'])
  var p1 = protocol1()
  var p2 = protocol2()

  var ch1 = p1.channel(key)
  var ch2 = p2.channel(key)

  ch1.handshake()
  ch2.handshake()

  p1.once('handshake', function () {
    t.ok(!p1.remoteSupports('foo'), 'protocol not supported')
    t.ok(!p1.remoteSupports('bar'), 'protocol not supported')
    t.ok(p1.remoteSupports('test'), 'protocol supported')
  })

  p2.once('handshake', function () {
    t.ok(!p2.remoteSupports('foo'), 'protocol not supported')
    t.ok(!p2.remoteSupports('bar'), 'protocol not supported')
    t.ok(p2.remoteSupports('test'), 'protocol supported')
  })

  ch1.once('test', function (buf) {
    t.same(buf, Buffer('hello world'), 'same buffer')
    ch1.test(Buffer('HELLO WORLD'))
  })

  ch2.on('handshake', function () {
    ch2.test(Buffer('hello world'))
  })

  ch2.once('test', function (buf) {
    t.same(buf, Buffer('HELLO WORLD'), 'same buffer')
  })

  p1.pipe(p2).pipe(p1)
})

tape('ignore unsupported message', function (t) {
  t.plan(6)

  var protocol2 = protocol.use(['test', 'bar'])
  var p1 = protocol()
  var p2 = protocol2()

  var ch1 = p1.channel(key)
  var ch2 = p2.channel(key)

  ch1.handshake()
  ch2.handshake()

  p1.once('handshake', function () {
    t.ok(!p1.remoteSupports('foo'), 'protocol not supported')
    t.ok(!p1.remoteSupports('bar'), 'protocol not supported')
    t.ok(!p1.remoteSupports('test'), 'protocol not supported')
  })

  p2.once('handshake', function () {
    t.ok(!p2.remoteSupports('foo'), 'protocol not supported')
    t.ok(!p2.remoteSupports('bar'), 'protocol not supported')
    t.ok(!p2.remoteSupports('test'), 'protocol not supported')
  })

  ch1.once('test', function () {
    t.fail('ch1 does not support test')
  })

  ch2.on('handshake', function () {
    ch2.test(Buffer('hello world'))
  })

  ch2.once('test', function (buf) {
    t.fail('ch1 does not support test')
  })

  p1.pipe(p2).pipe(p1)
})
