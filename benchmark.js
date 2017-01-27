var bench = require('nanobench')
var protocol = require('./')

bench('send 1.000.000 messages', function (b) {
  var stream1 = protocol()
  var stream2 = protocol()

  var ch1 = stream1.open(new Buffer('01234567012345670123456701234567'))
  var ch2 = stream2.open(new Buffer('01234567012345670123456701234567'))

  var missing = 1000000
  ch2.on('request', function () {
    if (--missing) return
    b.end()
  })

  for (var i = 0; i < 1000000; i++) {
    ch1.request({
      block: 42
    })
  }

  stream1.pipe(stream2).pipe(stream1)
})

bench('send 1.000.000 messages (no encryption)', function (b) {
  var stream1 = protocol({encrypt: false})
  var stream2 = protocol({encrypt: false})

  var ch1 = stream1.open(new Buffer('01234567012345670123456701234567'))
  var ch2 = stream2.open(new Buffer('01234567012345670123456701234567'))

  var missing = 1000000
  ch2.on('request', function () {
    if (--missing) return
    b.end()
  })

  for (var i = 0; i < 1000000; i++) {
    ch1.request({
      block: 42
    })
  }

  stream1.pipe(stream2).pipe(stream1)
})
