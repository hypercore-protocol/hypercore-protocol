# hypercore-protocol

Stream that implements the [hypercore](https://github.com/mafintosh/hypercore) protocol

```
npm install hypercore-protocol
```

[![build status](https://travis-ci.org/mafintosh/hypercore-protocol.svg?branch=master)](https://travis-ci.org/mafintosh/hypercore-protocol)

## Usage

``` js
var protocol = require('hypercore-protocol')

someStream.pipe(protocol()).pipe(someStream)
```

(still finishing this up - gonna add api docs + tests soon)

## License

MIT
