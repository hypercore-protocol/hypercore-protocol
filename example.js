var protocol = require('./').use('ping')

var p1 = protocol({
  id: Buffer('mathias')
})

var p2 = protocol({
  id: Buffer('max'),
  join: function (id, cb) {
    cb(null, Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))
  }
})

p1.on('handshake', function () {
  console.log('local: got handshake, remote peer:', p1.remoteId)
})

p2.on('handshake', function () {
  console.log('remote: got handshake, local peer:', p2.remoteId)
})

p1.on('channel', function (channel) {
  channel.on('ping', function () {
    console.log('local: got ping, closing channel ...')
    channel.close()
  })

  channel.on('close', function () {
    console.log('local: channel closed')
  })
})

p2.on('channel', function (channel) {
  channel.on('close', function () {
    console.log('remote: channel closed')
  })

  channel.ping()
})

p1.pipe(p2).pipe(p1)
p1.join(Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))
