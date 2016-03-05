var tape = require('tape')
var protocol = require('./')

var key = Buffer('12345678123456781234567812345678')
var otherKey = Buffer('01234567012345670123456701234567')

tape('join emits channel', function (t) {
  var p = protocol()

  p.on('channel', function (k, channel) {
    process.nextTick(function () { // channel is emitted in same tick
      t.same(k.toString('hex'), key.toString('hex'), 'same key')
      t.ok(ch === channel, 'same channel instance')
      t.end()
    })
  })

  var ch = p.join(key)
})

tape('join two channels', function (t) {
  var p = protocol()
  var expected = [key, otherKey]

  p.on('channel', function (k) {
    t.same(k, expected.shift(), 'expected channel key')
  })

  p.join(key)
  p.join(otherKey)
  t.same(p.list(), [key, otherKey], 'joined both channels')
  t.same(expected.length, 0, 'fired both events')
  t.end()
})

tape('join and leave', function (t) {
  var p = protocol()

  t.same(p.list(), [], 'not in any channel')
  p.join(key)
  t.same(p.list(), [key], 'joined channel')
  p.leave(otherKey)
  t.same(p.list(), [key], 'joined channel')
  p.leave(key)
  t.same(p.list(), [], 'not in any channel')
  t.end()
})

tape('encrypts messages', function (t) {
  var p = protocol()
  var buf = []

  p.on('data', function (data) {
    buf.push(data)
  })

  p.on('end', function () {
    buf = Buffer.concat(buf)
    t.ok(buf.length > 32 + 20 + 25, 'sending some data') // ~ hmac + nonce + data
    t.same(buf.toString().indexOf('hello i should be encrypted'), -1, 'does not contain plaintext')
    t.end()
  })

  var ch = p.join(key)
  ch.response(0, Buffer('hello i should be encrypted.'))
  p.end()
})

tape('remote joins', function (t) {
  var p1 = protocol()
  var p2 = protocol()
  var remoteJoined = 2

  var ch1 = p1.join(key)

  ch1.once('open', function () {
    t.pass('remote joined')
    remoteJoined--
  })

  ch1.on('request', function (block) {
    t.same(block, 42, 'received request')
    ch1.response(42, Buffer('some data'))
  })

  var ch2 = p2.join(key)

  ch2.request(42)

  ch2.on('response', function (block, data, proof) {
    t.same(block, 42, 'received response')
    t.same(data, Buffer('some data'), 'expected data')
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
  var p2 = protocol({
    join: function (id, cb) {
      cb(null, key)
    }
  })

  p2.on('channel', function (k, channel) {
    channel.on('close', function () {
      remoteClose = true
      t.ok(localClose, 'local closed')
      t.ok(remoteClose, 'remote closed')
      t.end()
    })
  })

  var ch1 = p1.join(key)

  ch1.on('close', function () {
    localClose = true
  })

  ch1.close()
  p1.pipe(p2).pipe(p1)
})
