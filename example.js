var protocol = require('./').use('ping')

var p1 = protocol({id: Buffer('mathias')})

var p2 = protocol({id: Buffer('max')}, function (publicId) {
  var channel = p2.channel(Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))

  channel.on('close', function () {
    console.log('remote: channel closed')
  })

  channel.on('handshake', function () {
    channel.ping()
  })

  channel.handshake()
})

p1.on('handshake', function () {
  console.log('local: got handshake, remote peer:', p1.remoteId)
})

p2.on('handshake', function () {
  console.log('remote: got handshake, local peer:', p2.remoteId)
})

p1.pipe(p2).pipe(p1)

var channel = p1.channel(Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))

channel.on('ping', function () {
  console.log('local: got ping, closing channel ...')
  channel.close()
})

channel.on('close', function () {
  console.log('local: channel closed')
})

channel.handshake()
