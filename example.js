var protocol = require('./').use('ping')

var p1 = protocol({
  id: Buffer('max'),
  join: function (id, cb) {
    cb(null, Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))
  }
})

var p2 = protocol({
  id: Buffer('mathias'),
  join: function (id, cb) {
    cb(null, Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))
  }
})

p1.on('handshake', function () {
  console.log('got handshake, remote peer:', p1.remoteId)
})

p1.on('channel', function (key, channel) {
  channel.on('ping', function () {
    console.log('got ping')
    channel.close()
  })
  channel.on('close', function () {
    console.log('closing shop')
  })
  channel.on('request', function (block) {
    console.log('remote requests:', block)
    channel.response(block, Buffer('hello'))
  })
})

p2.on('channel', function (key, channel) {
  channel.on('close', function () {
    console.log('closing')
  })
  channel.request(1)
  channel.request(2)
  channel.ping()
  channel.on('response', function (block, data, proof) {
    console.log('got response:', block, data, proof)
  })
})

p1.pipe(p2).pipe(p1)

var ch = p1.join(Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))

ch.on('open', function () {
  console.log('remote opened...')
})
