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
var channel = p.open(Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))

channel.request({block: 42})
channel.on('data', function (message) {
  console.log(message) // contains message.block and message.value
})

stream.pipe(anotherStream).pipe(stream)
```

## API

#### `var k = protocol.parseDiscoveryKey(buf)`

Parse the discovery key encoded in `buf` which is the first varint message taken from a hypercore feed stream.

#### `var p = protocol([options], [onopen])`

Create a new protocol instance. The returned object is a duplex stream
that you should pipe to another protocol instance over a stream based transport

If the remote peer joins a channel you haven't opened, hypercore will call an optional `onopen`
method if you specify it with the discovery key for that channel.

``` js
var p = protocol(function (discoveryKey) {
  // remote peer joined discoveryKey but you haven't
  // you can open the channel now if you want to join the channel

  // open with corresponding key to join
  var channel = p.open(Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))
})
```

See below for more information about channels, keys, and discovery keys.
Other options include:

``` js
{
  id: optionalPeerId, // you can use this to detect if you connect to yourself
  encrypt: true // set to false to disable encryption for debugging purposes
}
```

If you don't specify a peer id a random 32 byte will be used.
You can access the peer id using `p.id` and the remote peer id using `p.remoteId`.

#### `var channel = p.open(key, [options])`

Open a stream channel. A channel uses the [sodium](https://github.com/mafintosh/sodium-prebuilt) module to encrypt all messages using the key you specify. The discovery key for the channel is send unencrypted together with a random 24 byte nonce. If you do not specify a discovery key in the options map, an HMAC of the string `hypercore` using the key as the password will be used.

#### `p.on('handshake')`

Emitted when a protocol handshake has been received. Afterwards you can check `.remoteId` to get the remote peer id.

#### `p.setTimeout(ms, [ontimeout])`

Will call the timeout function if the remote peer hasn't send any messages within `ms`. Will also send a heartbeat message to the other peer if you've been inactive for `ms / 2`

## Channel API

#### `channel.end()`

Signal the remote that you want to gracefully end the channel.

#### `channel.on('end')`

Emitted when an end signal is received.

#### `channel.close()`

Force closes a channel

#### `channel.on('close')`

Emitted when a channel is closed, either by you or the remote peer.
No other events will be emitted after this.

#### `channel.request(message)`

Send a request message. See the protobuf schema or more information

#### `channel.on('request', message)`

Emitted when a request message is received

#### `channel.data(message)`

Send a data message. See the protobuf schema or more information

#### `channel.on('data', message)`

Emitted when a data message is received

#### `channel.cancel(message)`

Send a cancel message. See the protobuf schema or more information

#### `channel.on('cancel', message)`

Emitted when a cancel message is received

#### `channel.have(message)`

Send a have message. See the protobuf schema or more information

#### `channel.on('have', message)`

Emitted when a have message is received

#### `channel.want(message)`

Send a want message. See the protobuf schema or more information

#### `channel.on('want', message)`

Emitted when a want message is received

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

#### `protocol = protocol.use(extensionName)`

Use an extension specified by the string name you pass in. Returns a new prototype

Will create a new method on all your channel objects that has the same name as the extension and emit an event with the same name when an extension message is received

``` js
protocol = protocol.use('ping')

var p = protocol()
var channel = p.open(someKey)

channel.on('handshake', function () {
  channel.on('ping', function (message) {
    console.log('received ping message', message)
  })

  channel.ping(Buffer('this is a ping message!'))
})
```

Per default all messages are buffers. If you want to encode/decode your messages you can specify an [abstract-encoding](https://github.com/mafintosh/abstract-encoding) compliant encoder as well

``` js
protocol = protocol.use({
  ping: someEncoder
})
```

#### `var bool = p.remoteSupports(extensionName)`

After the protocol instance emits `handshake` you can call this method to check
if the remote peer also supports one of your extensions.

## License

MIT
