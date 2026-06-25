const { safeStorage } = require('electron');

function canUseSafeStorage() {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

function encryptSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (!canUseSafeStorage()) return '';
  return safeStorage.encryptString(text).toString('base64');
}

function decryptSecret(base64) {
  const value = String(base64 || '');
  if (!value || !canUseSafeStorage()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch {
    return '';
  }
}

function getStoredApiKey(settings = {}) {
  if (settings.apiKeyEncrypted) {
    const decrypted = decryptSecret(settings.apiKeyEncrypted);
    if (decrypted) return decrypted;
  }
  return String(settings.apiKey || '');
}

function setStoredApiKey(settings, key) {
  const cleanKey = String(key || '').trim();
  delete settings.apiKey;
  delete settings.apiKeyEncrypted;
  settings.apiKeyStorage = 'none';

  if (!cleanKey) return settings;

  if (canUseSafeStorage()) {
    const encrypted = encryptSecret(cleanKey);
    if (encrypted) {
      settings.apiKeyEncrypted = encrypted;
      settings.apiKeyStorage = 'safeStorage';
      return settings;
    }
  }

  // safeStorage 不可用时才回退到明文，保证旧系统仍可使用。
  settings.apiKey = cleanKey;
  settings.apiKeyStorage = 'plain';
  return settings;
}

function removeStoredApiKey(settings) {
  delete settings.apiKey;
  delete settings.apiKeyEncrypted;
  settings.apiKeyStorage = 'none';
  return settings;
}

module.exports = {
  canUseSafeStorage,
  getStoredApiKey,
  setStoredApiKey,
  removeStoredApiKey
};
