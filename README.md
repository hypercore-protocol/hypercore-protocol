# hypercore-protocol

Stream that implements the [hypercore](https://github.com/mafintosh/hypercore) protocol

```
npm install hypercore-protocol
```

[![build status](https://travis-ci.org/mafintosh/hypercore-protocol.svg?branch=master)](https://travis-ci.org/mafintosh/hypercore-protocol)

For detailed info on the messages sent on each channel see [simple-hypercore-protocol](https://github.com/mafintosh/simple-hypercore-protocol)

## Usage

``` js
const protocol = require('hypercore-protocol')

// create two streams with hypercore protocol
const streamA = protocol()
const streamB = protocol()

// open two feeds specified by a 32 byte key
const key = Buffer.from('deadbeefdeadbeefdeadbeefdeadbeef')
const feed = streamA.open(key)
const remoteFeed = streamB.open(key, {
  // listen for data in remote feed
  ondata (message) {
    console.log(message.value.toString())
  }
})

// add data to feed
feed.data({ index: 1, value: '{ block: 42 }'})

streamA.pipe(streamB).pipe(streamA)
```

`output => { block: 42 }`

## API

#### `const stream = protocol([options])`

Create a new protocol duplex stream.

Options include:

``` js
{
  encrypt: true, // set to false to disable encryption if you are already piping through a encrypted stream
  timeout: 5000, // stream timeout. set to 0 or false to disable.
  keyPair: { publicKey, secretKey }, // use this keypair for the stream authentication
  onhandshake () { }, // function called when the stream handshake has finished
  onopen (discoveryKey) { } // function called when the remote stream opens a feed you have not
}
```

#### `stream.remotePublicKey`

The remotes public key.

#### `stream.publicKey`

Your public key.

#### `const feed = stream.open(key, handlers)`

Signal the other end that you want to share a hypercore feed.
Also sends a capability that you have the specified key.

#### `stream.destroy([error])`

Destroy the stream. Closes all feeds as well.

#### `stream.finalize()`

Gracefully end the stream. Closes all feeds as well.

#### `feed.options(message)`

Send an `options` message.

#### `feed.handlers.onoptions(message)`

Called when a options message has been received.

#### `feed.status(message)`

Send an `status` message.

#### `feed.handlers.onstatus(message)`

Called when a status message has been received.

#### `feed.have(message)`

Send a `have` message.

#### `feed.handlers.onhave(message)`

Called when a `have` message has been received.

#### `feed.unhave(message)`

Send a `unhave` message.

#### `feed.handlers.onunhave(message)`

Called when a `unhave` message has been received.

#### `feed.want(want)`

Send a `want` message.

#### `feed.handlers.onwant(want)`

Called when a `want` message has been received.

#### `feed.unwant(unwant)`

Send a `unwant` message.

#### `feed.handlers.onunwant(unwant)`

Called when a `unwant` message has been received.

#### `feed.request(request)`

Send a `request` message.

#### `feed.handlers.onrequest(request)`

Called when a `request` message has been received.

#### `feed.cancel(cancel)`

Send a `cancel` message.

#### `feed.handlers.oncancel(cancel)`

Called when a `cancel` message has been received.

#### `feed.data(data)`

Send a `data` message.

#### `feed.handlers.ondata(data)`

Called when a `data` message has been received.

#### `feed.extension(name, message)`

Send an `extension` message. `name` must be in `extensions` list.

#### `feed.handlers.onextension(name, message)`

Called when an `extension` message has been received.

#### `feed.close()`

Close this feed. You only need to call this if you are sharing a lot of feeds and want to garbage collect some old unused ones.

#### `feed.handlers.onclose()`

Called when this feed has been closed. All feeds are automatically closed when the stream ends or is destroyed.

#### `feed.destroy(err)`

An alias to `stream.destroy`.

## Wire protocol

The hypercore protocol consists of two phases.
A handshake phase and a message exchange phage.

For the handshake Noise is used with the XX pattern. Each Noise message is sent with varint framing.
After the handshake a message exchange phased is started.

This uses a basic varint length prefixed format to send messages over the wire.

All messages contains a header indicating the type and feed id, and a protobuf encoded payload.

```
message = header + payload
```

A header is a varint that looks like this

```
header = numeric-feed-id << 4 | numeric-type
```

The feed id is just an incrementing number for every feed shared and the type corresponds to which protobuf schema should be used to decode the payload.

The message is then wrapped in another varint containing the length of the message

```
wire = length(message) + message + length(message2) + message2 + ...
```

## License

MIT
