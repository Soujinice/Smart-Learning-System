// Smart Learning Center - central server data store.
// Flat JSON-file persistence under server/data/<collection>.json, seeded
// once from data/seed.json on first run. No database server required.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

let seedCache = null;
function loadSeed() {
  if (!seedCache) {
    seedCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'seed.json'), 'utf-8'));
  }
  return seedCache;
}

function filePath(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

const cache = {};

function get(collection) {
  if (cache[collection] !== undefined) return cache[collection];
  const fp = filePath(collection);
  if (fs.existsSync(fp)) {
    cache[collection] = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } else {
    const seed = loadSeed();
    cache[collection] = seed[collection] !== undefined ? JSON.parse(JSON.stringify(seed[collection])) : [];
    save(collection);
  }
  return cache[collection];
}

function save(collection) {
  const fp = filePath(collection);
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache[collection], null, 2));
  fs.renameSync(tmp, fp);
}

function set(collection, data) {
  cache[collection] = data;
  save(collection);
  return cache[collection];
}

function push(collection, item, maxLength = 2000) {
  const arr = get(collection);
  arr.push(item);
  if (arr.length > maxLength) arr.splice(0, arr.length - maxLength);
  save(collection);
  return item;
}

function update(collection, predicate, updater) {
  const arr = get(collection);
  let changed = false;
  for (let i = 0; i < arr.length; i++) {
    if (predicate(arr[i])) {
      arr[i] = updater(arr[i]);
      changed = true;
    }
  }
  if (changed) save(collection);
  return changed;
}

function find(collection, predicate) {
  return get(collection).find(predicate);
}

export default { get, set, push, update, find };
