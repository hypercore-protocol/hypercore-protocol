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

p1.on('channel', function (channel) {
  channel.on('ping', function () {
    console.log('got ping')
    channel.close()
  })

  channel.on('close', function () {
    console.log('closing shop')
  })

  channel.on('request', function (message) {
    console.log('remote requests:', message.block)
    channel.response({block: message.block, data: Buffer('hello')})
  })
})

p2.on('channel', function (channel) {
  channel.on('close', function () {
    console.log('closing')
  })

  channel.request({block: 1})
  channel.request({block: 2})
  channel.ping()

  channel.on('response', function (message) {
    console.log('got response:', message)
  })
})

p1.pipe(p2).pipe(p1)

var ch = p1.join(Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))

ch.on('open', function () {
  console.log('remote opened...')
})
