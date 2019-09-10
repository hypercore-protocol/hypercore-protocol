const Protocol = require('./')

const a = new Protocol(true)
const b = new Protocol(false)

a.pipe(b).pipe(a)

a.on('end', () => console.log('a ended'))
b.on('end', () => console.log('b ended'))

const key = Buffer.from('This is a 32 byte key, 012345678')
let missing = 5

const channel = a.open(key, {
  onhave (have) {
    console.log('channel.onhave()', have)

    for (var i = 0; i < 5; i++) {
      channel.request({
        index: i
      })
    }
  },
  ondata (data) {
    console.log('channel.ondata()', data)

    if (!--missing) {
      channel.status({
        uploading: false,
        download: false
      })
    }
  }
})

const remoteChannel = b.open(key, {
  onrequest (request) {
    console.log('remoteChannel.onrequest()', request)
    remoteChannel.data({
      index: request.index,
      value: 'sup'
    })
  },
  onwant (want) {
    console.log('remoteChannel.onwant()', want)
    remoteChannel.have({
      start: 0,
      length: 1000
    })
  },
  onstatus (status) {
    console.log('remoteChannel.onstatus', status)
    b.finalize()
  }
})

channel.want({
  start: 0,
  length: 1000
})
