var tape = require('tape')
var protocol = require('./')
var lpm = require('length-prefixed-message')

var key = Buffer('12345678123456781234567812345678')
var otherKey = Buffer('02345678123456781234567812345678')

tape('parse discovery key', function (t) {
  t.plan(1)

  var stream = protocol()
  var channel = stream.open(key)
  lpm.read(stream, function (buf) {
    var parsed = protocol.parseDiscoveryKey(buf)
    t.deepEqual(parsed, channel.discoveryKey)
  })
})

tape('open channel', function (t) {
  t.plan(3)

  var stream1 = protocol()
  var stream2 = protocol()

  var channel1 = stream1.open(key)
  var channel2 = stream2.open(key)

  channel1.request({
    block: 10
  })

  channel1.once('data', function (message) {
    t.same(message.block, 10, 'same block')
    t.same(message.value, Buffer('hello world'), 'same value')
  })

  channel2.once('request', function (message) {
    t.same(message.block, 10, 'same block')
    channel2.data({block: 10, value: Buffer('hello world')})
  })

  stream1.pipe(stream2).pipe(stream1)
})

tape('async open', function (t) {
  t.plan(3)

  var stream1 = protocol()
  var stream2 = protocol(function () {
    setTimeout(function () {
      var channel2 = stream2.open(key)
      channel2.once('request', function (message) {
        t.same(message.block, 10, 'same block')
        channel2.data({block: 10, value: Buffer('hello world')})
      })
    }, 100)
  })

  var channel1 = stream1.open(key)

  channel1.request({
    block: 10
  })

  channel1.once('data', function (message) {
    t.same(message.block, 10, 'same block')
    t.same(message.value, Buffer('hello world'), 'same value')
  })

  stream1.pipe(stream2).pipe(stream1)
})

tape('empty messages work', function (t) {
  t.plan(2)

  var stream1 = protocol()
  var stream2 = protocol()

  var channel1 = stream1.open(key)
  var channel2 = stream2.open(key)

  channel1.pause()

  channel1.once('resume', function (message) {
    t.pass('resumed')
  })

  channel2.once('pause', function (message) {
    t.pass('paused')
    channel2.resume()
  })

  stream1.pipe(stream2).pipe(stream1)
})

tape('is encrypted', function (t) {
  var stream1 = protocol()
  var stream2 = protocol()

  var channel1 = stream1.open(key)
  var channel2 = stream2.open(key)

  channel1.on('data', function (message) {
    t.same(message.block, 10, 'same block')
    t.same(message.value, Buffer('hello world'), 'same value')
    t.end()
  })

  stream2.on('data', function (data) {
    t.ok(data.toString().indexOf('hello world') === -1, 'is encrypted')
  })

  stream1.pipe(stream2).pipe(stream1)

  channel2.data({block: 10, value: Buffer('hello world')})
})

tape('can disable encryption', function (t) {
  var stream1 = protocol({private: false})
  var stream2 = protocol({private: false})

  var foundHello = false
  var channel1 = stream1.open(key)
  var channel2 = stream2.open(key)

  channel1.on('data', function (message) {
    t.same(message.block, 10, 'same block')
    t.same(message.value, Buffer('hello world'), 'same value')
    t.ok(foundHello, 'sent in plain text')
    t.end()
  })

  stream2.on('data', function (data) {
    if (!foundHello) foundHello = data.toString().indexOf('hello world') > -1
  })

  stream1.pipe(stream2).pipe(stream1)

  channel2.data({block: 10, value: Buffer('hello world')})
})

tape('end channel', function (t) {
  t.plan(3)

  var stream1 = protocol()
  var stream2 = protocol()

  var c1 = stream1.open(key)
  var c2 = stream2.open(key)

  c2.on('request', function () {
    t.pass('received request')
  })

  c2.on('end', function () {
    t.pass('channel ended')
  })

  c1.on('end', function () {
    t.pass('channel ended')
  })

  c1.on('open', function () {
    c1.request({block: 10})
    c1.end()
  })

  stream1.pipe(stream2).pipe(stream1)
})

tape('destroy ends all channels', function (t) {
  t.plan(3)

  var stream1 = protocol()
  var stream2 = protocol()

  var c1 = stream1.open(key)
  var other = stream1.open(otherKey)
  var c2 = stream2.open(key)

  other.on('end', function () {
    t.pass('channel ended')
  })

  c1.on('end', function () {
    t.pass('channel ended')
  })

  c2.on('end', function () {
    t.pass('channel ended')
  })

  stream1.pipe(stream2).pipe(stream1)

  setTimeout(function () {
    stream1.finalize()
  }, 100)
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

tape('extension', function (t) {
  t.plan(4)

  var protocol1 = protocol.use('test')
  var p1 = protocol1()
  var p2 = protocol1()

  var ch1 = p1.open(key)
  var ch2 = p2.open(key)

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

  var protocol1 = protocol.use({test: 1, bar: 1})
  var protocol2 = protocol.use({foo: 1, test: 1})
  var p1 = protocol1()
  var p2 = protocol2()

  var ch1 = p1.open(key)
  var ch2 = p2.open(key)

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

  var protocol2 = protocol.use({test: 1, bar: 1})
  var p1 = protocol()
  var p2 = protocol2()

  var ch1 = p1.open(key)
  var ch2 = p2.open(key)

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
