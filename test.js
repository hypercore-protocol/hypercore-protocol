const tape = require('tape')
const Protocol = require('./')

tape('basic', function (t) {
  t.plan(4)

  const a = new Protocol(true)
  const b = new Protocol(false)

  const key = Buffer.alloc(32)

  const local = a.open(key, {
    ondata (data) {
      t.same(data.index, 42)
      t.same(data.value, Buffer.from('value'))
      t.end()
    }
  })

  const remote = b.open(key, {
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
