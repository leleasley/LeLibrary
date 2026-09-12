'use strict';
module.exports = { ...require('./generic'), id: 'nuvio', label: 'Nuvio', status: 'supported', manifestMode: 'nuvio', capabilities: { ...require('./generic').capabilities, nativeFolderPush: true } };
