var fs = require('fs')
var protobuf = require('protocol-buffers')

module.exports = protobuf(fs.readFileSync(__dirname + '/schema.proto', 'utf-8'))
