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

// join a channel specified by a 32 byte key
var channel = p.join(Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))

// request block 42
channel.request({block: 42})
channel.on('response', function (message) {
  console.log(message) // contains message.block and message.data
})

stream.pipe().pipe(stream)
```

## API

#### `var p = protocol([options])`

Create a new protocol instance. The returned object is a duplex stream
that you should pipe to another protocol instance over a stream based transport

If the remote peer joins a channel you haven't joined, hypercore will call an optional `join`
method if you specify it in the options map with the public id for that channel and a callback.

``` js
var p = protocol({
  join: function (publicId, cb) {
    // remote peer joined publicId but you haven't
    // call the callback with the corresponding key for publicId
    // if you want to join this channel as well or an error otherwise
    cb(null, Buffer('deadbeefdeadbeefdeadbeefdeadbeef'))
  }
})
```

See below for more information about channels, keys, and public ids.
Other options include:

``` js
{
  id: optionalPeerId, // you can use this to detect if you connect to yourself
  secure: true // set to false to disable encryption for debugging purposes
}
```

If you don't specify a peer id a random 32 byte will be used.
You can access the peer id using `p.id` and the remote peer id using `p.remoteId`.

#### `var channel = p.join(key)`

Join a stream channel. A channel uses the [sodium](https://github.com/mafintosh/sodium-prebuilt) module to encrypt all messages using the key you specify. An HMAC of the string `hypercore` using the key as the password serves as a public id for a channel and is send unencrypted together with a nonce.

#### `p.leave(key)`

Leave a channel. Same as calling `channel.close()`

#### `p.on('handshake')`

Emitted when a protocol handshake has been received. The protocol handshake is sent
over the first encrypted channel you and the remote peer joins.
Afterwards you can check `.remoteId` to get the remote peer id.

#### `p.on('channel', channel)`

Emitted when you join a channel.

#### `var channels = p.list()`

Lists all the channels you have joined

#### `p.setTimeout(ms, [ontimeout])`

Will call the timeout function if the remote peer
hasn't send any messages within `ms`. Will also send a heartbeat
message to the other peer if you've been inactive for `ms / 2`

## Channel API

#### `channel.close()`

Closes a channel

#### `channel.on('close')`

Emitted when a channel is closed, either by you or the remote peer.
No other events will be emitted after this.

#### `channel.on('open')`

Emitted when the channel is fully open (both you and the remote peer joined).
You can send messages to the remote peer before this has been emitted.

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

## Extension API

#### `protocol = protocol.use(extension)`

Use an extension specified by the string name you pass in. Returns a new prototype

Will create a new method on all your channel objects that has the same name as the extension
and emit an event with the same name when an extension message is received

``` js
protocol = protocol.use('ping')

var p = protocol()
var channel = p.join(someKey)

channel.on('ping', function (message) {
  console.log('received ping message')
})

channel.ping(Buffer('this is a ping message!'))
```

#### `var bool = p.remoteSupports(extension)`

After the protocol instance emits `handshake` you can call this method to check
if the remote peer also supports one of your extensions.

## License

MIT
