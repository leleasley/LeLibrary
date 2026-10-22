// @ts-nocheck
'use strict';
module.exports = { ...require('./generic.ts'), id: 'stremio', label: 'Stremio', status: 'supported', deepLinkScheme: 'stremio', manifestMode: 'stremio' };

export interface StremioAdapter { [key: string]: any };
