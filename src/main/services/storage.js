const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function dataPath(filename) {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}

function readJson(filename, fallback) {
  try {
    const file = dataPath(filename);
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filename, data) {
  const target = dataPath(filename);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, payload, 'utf-8');
  fs.renameSync(tmp, target);
  return true;
}

function removeJson(filename) {
  const file = dataPath(filename);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
}

module.exports = {
  dataPath,
  readJson,
  writeJson,
  removeJson
};
