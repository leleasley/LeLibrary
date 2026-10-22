// Runtime barrel for the setup core. Types are imported from the module that
// owns them, so this file only re-exports values.
import type { KeysApi } from './keys.ts';
import type { SealApi } from './seal.ts';
import type { PasswordApi } from './password.ts';
import type { TokenApi } from './token.ts';
import type { RateLimitApi } from './rate-limit.ts';
import type { EditSessionsApi } from './edit-sessions.ts';
import type { ConfigStoreApi } from './config-store.ts';

const keys = require('./keys.ts') as KeysApi;
const seal = require('./seal.ts') as SealApi;
const password = require('./password.ts') as PasswordApi;
const token = require('./token.ts') as TokenApi;
const limiter = require('./rate-limit.ts') as RateLimitApi;
const editSessions = require('./edit-sessions.ts') as EditSessionsApi;
const configStore = require('./config-store.ts') as ConfigStoreApi;

module.exports = { ...keys, ...seal, ...password, ...token, ...limiter, ...editSessions, ...configStore };
