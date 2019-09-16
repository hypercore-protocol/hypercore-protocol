const tape = require('tape')
const Protocol = require('./')

const KEY = Buffer.from('01234567890123456789012345678901')
const OTHER_KEY = Buffer.from('12345678901234567890123456789012')

tape('basic', function (t) {
  t.plan(4)

  const a = new Protocol(true)
  const b = new Protocol(false)

  const local = a.open(KEY, {
    ondata (data) {
      t.same(data.index, 42)
      t.same(data.value, Buffer.from('value'))
      t.end()
    }
  })

  const remote = b.open(KEY, {
    onopen () {
      t.pass('opened')
    },
    onrequest (request) {
      t.same(request.index, 42)
      remote.data({
        index: request.index,
        value: Buffer.from('value')
      })
    }
  })

  local.request({
    index: 42
  })

  a.pipe(b).pipe(a)
})

tape('send messages', function (t) {
  t.plan(10)

  const a = new Protocol(true, {
    ondiscoverykey (discoveryKey) {
      t.same(discoveryKey, other.discoveryKey)
    }
  })
  const b = new Protocol(false)

  const ch1 = a.open(KEY, {
    onopen () {
      ch1.data({ index: 42, value: Buffer.from('hi') })
      ch1.request({ index: 10 })
      ch1.cancel({ index: 100 })
    },
    onwant (want) {
      t.same(want, { start: 10, length: 100 })
    },
    onstatus (status) {
      t.same(status, { uploading: false, downloading: true })
    },
    onunwant (unwant) {
      t.same(unwant, { start: 11, length: 100 })
    },
    onunhave (unhave) {
      t.same(unhave, { start: 18, length: 100 })
    },
    onhave (have) {
      t.same(have, { start: 10, length: 10, bitfield: null, ack: false })
    }
  })

  const ch2 = b.open(KEY, {
    onopen () {
      ch2.want({ start: 10, length: 100 })
      ch2.status({ uploading: false, downloading: true })
      ch2.unwant({ start: 11, length: 100 })
      ch2.unhave({ start: 18, length: 100 })
      ch2.have({ start: 10, length: 10 })
    },
    onrequest (request) {
      t.same(request, { index: 10, hash: false, bytes: 0, nodes: 0 })
    },
    ondata (data) {
      t.same(data, { index: 42, signature: null, value: Buffer.from('hi'), nodes: [] })
    },
    oncancel (cancel) {
      t.same(cancel, { index: 100, hash: false, bytes: 0 })
    }
  })

  const other = b.open(OTHER_KEY)

  a.on('discovery-key', function (discoveryKey) {
    t.same(discoveryKey, other.discoveryKey)
  })

  a.pipe(b).pipe(a)
})

tape('destroy', function (t) {
  const a = new Protocol(true)

  a.open(KEY, {
    onclose () {
      t.pass('closed')
      t.end()
    }
  })

  a.destroy()
})

tape('send messages (with ack)', function (t) {
  t.plan(10)

  const a = new Protocol(true, {
    ondiscoverykey (discoveryKey) {
      t.same(discoveryKey, other.discoveryKey)
    }
  })
  const b = new Protocol(false)

  const ch1 = a.open(KEY, {
    onopen () {
      ch1.data({ index: 42, value: Buffer.from('hi') })
      ch1.request({ index: 10 })
      ch1.cancel({ index: 100 })
    },
    onwant (want) {
      t.same(want, { start: 10, length: 100 })
    },
    onstatus (status) {
      t.same(status, { uploading: false, downloading: true })
    },
    onunwant (unwant) {
      t.same(unwant, { start: 11, length: 100 })
    },
    onunhave (unhave) {
      t.same(unhave, { start: 18, length: 100 })
    },
    onhave (have) {
      t.same(have, { start: 10, length: 10, bitfield: null, ack: true })
    }
  })

  const ch2 = b.open(KEY, {
    onopen () {
      ch2.want({ start: 10, length: 100 })
      ch2.status({ uploading: false, downloading: true })
      ch2.unwant({ start: 11, length: 100 })
      ch2.unhave({ start: 18, length: 100 })
      ch2.have({ start: 10, length: 10, ack: true })
    },
    onrequest (request) {
      t.same(request, { index: 10, hash: false, bytes: 0, nodes: 0 })
    },
    ondata (data) {
      t.same(data, { index: 42, signature: null, value: Buffer.from('hi'), nodes: [] })
    },
    oncancel (cancel) {
      t.same(cancel, { index: 100, hash: false, bytes: 0 })
    }
  })

  const other = b.open(OTHER_KEY)

  a.on('discovery-key', function (discoveryKey) {
    t.same(discoveryKey, other.discoveryKey)
  })

  a.pipe(b).pipe(a)
})

tape('multiple feeds', function (t) {
  const a = new Protocol(true)
  const b = new Protocol(false)

  a.open(KEY)
  b.open(KEY)

  const ch1 = a.open(OTHER_KEY, {
    onopen () {
      ch1.have({ start: 10, length: 100 })
    }
  })

  b.open(OTHER_KEY, {
    onhave () {
      t.pass('got message on second channel')
      t.end()
    }
  })

  a.pipe(b).pipe(a)
})

tape('async feed', function (t) {
  const a = new Protocol(true)
  const b = new Protocol(false, {
    ondiscoverykey () {
      setTimeout(function () {
        t.ok(b.remoteVerified(KEY))
        b.open(KEY, {
          onrequest (request) {
            t.same(request.index, 42)
            t.end()
          }
        })
      }, 100)
    }
  })

  const ch1 = a.open(KEY, {
    onopen () {
      ch1.request({ index: 42 })
    }
  })

  a.pipe(b).pipe(a)
})

tape('stream is encrypted', function (t) {
  const a = new Protocol(true)
  const b = new Protocol(false)
  let gotData = false

  const ch1 = a.open(KEY, {
    onopen () {
      ch1.data({ index: 42, value: Buffer.from('i am secret') })
    }
  })

  b.open(KEY, {
    ondata (data) {
      t.ok(gotData, 'got some data')
      t.same(data.value, Buffer.from('i am secret'))
      t.end()
    }
  })

  a.on('data', function (data) {
    gotData = true
    t.ok(data.toString().indexOf('secret') === -1)
  })

  a.pipe(b).pipe(a)
})

tape('stream can be unencrypted', function (t) {
  const a = new Protocol(true, { encrypted: false })
  const b = new Protocol(false, { encrypted: false })
  let gotData = false
  let sawSecret = false

  const ch1 = a.open(KEY, {
    onopen () {
      ch1.data({ index: 42, value: Buffer.from('i am secret') })
    }
  })

  b.open(KEY, {
    ondata (data) {
      t.ok(sawSecret, 'saw the secret')
      t.ok(gotData, 'got some data')
      t.same(data.value, Buffer.from('i am secret'))
      t.end()
    }
  })

  a.on('data', function (data) {
    gotData = true
    if (data.toString().indexOf('secret') > -1) {
      sawSecret = true
    }
  })

  a.pipe(b).pipe(a)
})

tape('keep alives', function (t) {
  const a = new Protocol(true, { timeout: 100 })
  const b = new Protocol(false, { timeout: 100 })

  const timeout = setTimeout(function () {
    t.pass('should not time out')
    t.end()
  }, 1000)

  b.on('error', function () {
    clearTimeout(timeout)
    t.fail('timed out')
    t.end()
  })

  a.pipe(b).pipe(a)
})

tape('timeouts', function (t) {
  const a = new Protocol(true, { timeout: false })
  const b = new Protocol(false, { timeout: 100 })

  const timeout = setTimeout(function () {
    t.fail('should time out')
  }, 1000)

  a.on('error', () => {})

  b.on('error', function () {
    clearTimeout(timeout)
    t.pass('timed out')
    t.end()
  })

  a.pipe(b).pipe(a)
})

tape('prefinalise hook', function (t) {
  const a = new Protocol(true)
  const b = new Protocol(false, {
    ondiscoverykey (discoveryKey) {
      b.close(discoveryKey)
    }
  })

  let created = 0

  a.resume()
  a.on('end', function () {
    t.same(created, 2, 'created two feeds')
    t.pass('should end')
    t.end()
  })

  created++
  a.prefinalize.wait()
  b.prefinalize.wait()

  const ch = a.open(KEY)
  ch.close()

  setTimeout(function () {
    created++
    const ch = a.open(OTHER_KEY)
    ch.close()
    a.prefinalize.continue()
    b.prefinalize.continue()
  }, 100)

  a.pipe(b).pipe(a)
})

tape('message after ping', function (t) {
  t.plan(2)

  const a = new Protocol(true)
  const b = new Protocol(false)

  const ch1 = a.open(KEY)

  b.open(KEY, {
    onhave () {
      t.pass('got have')
    }
  })

  ch1.have({ start: 1 })
  a.ping()
  ch1.have({ start: 2 })

  a.pipe(b).pipe(a)
})

tape('extension message', function (t) {
  t.plan(6)

  const a = new Protocol(true)
  const b = new Protocol(false)

  const ch1 = a.open(KEY, {
    onopen () {
      ch1.options({
        extensions: ['a', 'b']
      })
    },
    onoptions (options) {
      t.same(options.extensions, ['b', 'c'])
      ch1.extension(1, Buffer.from('hello ch2'))
    },
    onextension (type, message) {
      t.same(type, 0)
      t.same(message, Buffer.from('hello ch1'))
    }
  })

  const ch2 = b.open(KEY, {
    onopen () {
      ch2.options({
        extensions: ['b', 'c']
      })
    },
    onoptions (options) {
      t.same(options.extensions, ['a', 'b'])
      ch2.extension(0, Buffer.from('hello ch1'))
    },
    onextension (type, message) {
      t.same(type, 1)
      t.same(message, Buffer.from('hello ch2'))
    }
  })

  a.pipe(b).pipe(a)
})

tape('feed channel ids are set up correctly', function (t) {
  const a = new Protocol(true)
  const b = new Protocol(false)

  a.open(KEY)
  a.pipe(b).pipe(a)

  b.once('discovery-key', function () {
    const ch2 = b.open(KEY)
    t.ok(ch2.localId > -1)
    t.ok(ch2.remoteId > -1)
    t.end()
  })
})
