export { getDb, resetDbForTests, type Database, type SqlClient } from './client.js';
export { withAdvisoryLock, AdvisoryLockTimeoutError } from './lock.js';
export {
  encryptPlaintext,
  decryptPlaintext,
  hashPhone,
  DecryptError,
  resetEncryptionCache,
} from './encryption.js';
