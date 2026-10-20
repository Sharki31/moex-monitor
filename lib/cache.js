'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '..', 'cache');

let diskOk = true;
try {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch {
  diskOk = false;
}

const memory = new Map();

function safeName(key) {
  return key.replace(/[^A-Za-z0-9_-]/g, '_') + '.json';
}

function readDisk(file) {
  if (!diskOk) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'));
  } catch {
    return null;
  }
}

function writeDisk(file, entry) {
  if (!diskOk) return;
  const p = path.join(CACHE_DIR, file);
  const tmp = p + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(entry));
    fs.renameSync(tmp, p);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function set(key, value) {
  const entry = { t: Date.now(), v: value };
  memory.set(key, entry);
  writeDisk(safeName(key), entry);
}

function get(key, ttlMs) {
  let entry = memory.get(key);
  if (!entry) {
    entry = readDisk(safeName(key));
    if (entry) memory.set(key, entry);
  }
  if (!entry) return null;
  if (Date.now() - entry.t > ttlMs) return null;
  return entry.v;
}

function getStale(key) {
  let entry = memory.get(key);
  if (!entry) entry = readDisk(safeName(key));
  return entry ? entry.v : null;
}

function age(key) {
  const entry = memory.get(key) || readDisk(safeName(key));
  return entry ? Date.now() - entry.t : null;
}

module.exports = { get, set, getStale, age };
