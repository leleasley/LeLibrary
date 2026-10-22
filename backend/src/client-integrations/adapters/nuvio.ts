// @ts-nocheck
'use strict';
module.exports = { ...require('./generic.ts'), id: 'nuvio', label: 'Nuvio', status: 'supported', manifestMode: 'nuvio', capabilities: { ...require('./generic.ts').capabilities, nativeFolderPush: true } };

export interface NuvioAdapter { [key: string]: any };
