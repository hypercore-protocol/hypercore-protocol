# hypercore-protocol

Stream that implements the [hypercore](https://github.com/mafintosh/hypercore) protocol

```
npm install hypercore-protocol
```

[![build status](https://travis-ci.org/mafintosh/hypercore-protocol.svg?branch=master)](https://travis-ci.org/mafintosh/hypercore-protocol)

## Usage

``` js
var protocol = require('hypercore-protocol')

var p = protocol()

// open a channel specified by a 32 byte key
var channel = p.channel(Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))

// send a handshake
channel.handshake()

channel.on('handshake', function () {
  // request block 42
  channel.request({block: 42})
})

channel.on('response', function (message) {
  console.log(message) // contains message.block and message.data
})

stream.pipe(anotherStream).pipe(stream)
```

## API

#### `var p = protocol([options], [onopen])`

Create a new protocol instance. The returned object is a duplex stream
that you should pipe to another protocol instance over a stream based transport

If the remote peer joins a channel you haven't opened, hypercore will call an optional `onopen`
method if you specify it with the public id for that channel.

``` js
var p = protocol(function (publicId) {
  // remote peer joined publicId but you haven't
  // you can open the channel now if you want to join the channel

  // open with corresponding key to join
  var channel = p.channel(Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))
})
```

See below for more information about channels, keys, and public ids.
Other options include:

``` js
{
  id: optionalPeerId, // you can use this to detect if you connect to yourself
  encrypt: true // set to false to disable encryption for debugging purposes
}
```

If you don't specify a peer id a random 32 byte will be used.
You can access the peer id using `p.id` and the remote peer id using `p.remoteId`.

#### `var channel = p.channel(key, [publicId])`

Open a stream channel. A channel uses the [sodium](https://github.com/mafintosh/sodium-prebuilt) module to encrypt all messages using the key you specify. The public id for the channel is send unencrypted together with a random 24 byte nonce. If you do not specify a public id, an HMAC of the string `hypercore` using the key as the password will be used.

#### `p.on('handshake')`

Emitted when a protocol handshake has been received. Afterwards you can check `.remoteId` to get the remote peer id.

#### `var keys = p.keys()`

Lists the keys of all the channels you have opened

#### `p.setTimeout(ms, [ontimeout])`

Will call the timeout function if the remote peer
hasn't send any messages within `ms`. Will also send a heartbeat
message to the other peer if you've been inactive for `ms / 2`

## Channel API

#### `channel.handshake(message)`

This should be the first message you send. The `peerId` and `extensions` field
will be automatically populated for you. See the protobuf schema or more information.

#### `channel.on('handshake', message)`

Emitted when the other peer sends a handshake. You should wait for this event
to be emitted before sending any messages.

#### `channel.close()`

Closes a channel

#### `channel.on('close')`

Emitted when a channel is closed, either by you or the remote peer.
No other events will be emitted after this.

#### `channel.request(message)`

Send a request message. See the protobuf schema or more information

#### `channel.on('request', message)`

Emitted when a request message is received

#### `channel.response(message)`

Send a response message. See the protobuf schema or more information

#### `channel.on('response', message)`

Emitted when a response message is received

#### `channel.cancel(message)`

Send a cancel message. See the protobuf schema or more information

#### `channel.on('cancel', message)`

Emitted when a cancel message is received

#### `channel.have(message)`

Send a have message. See the protobuf schema or more information

#### `channel.on('have', message)`

Emitted when a have message is received

#### `channel.resume()`

Send a resume signal

#### `channel.on('resume')`

Emitted when a resume signal is received

#### `channel.pause()`

Send a pause signal

#### `channel.on('pause')`

Emitted when a pause signal is received

You can always check the paused state by accessing `.remotePaused` and `.amPaused`
to see wheather or not the remote is pausing us or we are pausing the remote.

## Extension API

#### `protocol = protocol.use(extension)`

Use an extension specified by the string name you pass in. Returns a new prototype

Will create a new method on all your channel objects that has the same name as the extension
and emit an event with the same name when an extension message is received

``` js
protocol = protocol.use('ping')

var p = protocol()
var channel = p.channel(someKey)

channel.on('handshake', function () {
  channel.on('ping', function (message) {
    console.log('received ping message')
  })

  channel.ping(Buffer('this is a ping message!'))
})
```

#### `var bool = p.remoteSupports(extension)`

After the protocol instance emits `handshake` you can call this method to check
if the remote peer also supports one of your extensions.

## License

MIT
