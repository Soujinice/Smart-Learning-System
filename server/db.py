"""Smart Learning Center - central server data store.

Flat JSON-file persistence under server/data/<collection>.json, seeded
once from data/seed.json on first run. No database server required.
"""
import copy
import json
import os
import tempfile

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

_seed_cache = None
_cache = {}


def _load_seed():
    global _seed_cache
    if _seed_cache is None:
        with open(os.path.join(DATA_DIR, "seed.json"), "r", encoding="utf-8") as f:
            _seed_cache = json.load(f)
    return _seed_cache


def _file_path(collection):
    return os.path.join(DATA_DIR, f"{collection}.json")


def _save(collection):
    fp = _file_path(collection)
    fd, tmp_path = tempfile.mkstemp(dir=DATA_DIR, prefix=f".{collection}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(_cache[collection], f, indent=2)
        os.replace(tmp_path, fp)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def get(collection):
    if collection in _cache:
        return _cache[collection]
    fp = _file_path(collection)
    if os.path.exists(fp):
        with open(fp, "r", encoding="utf-8") as f:
            _cache[collection] = json.load(f)
    else:
        seed = _load_seed()
        _cache[collection] = copy.deepcopy(seed.get(collection, []))
        _save(collection)
    return _cache[collection]


def set_(collection, data):
    _cache[collection] = data
    _save(collection)
    return _cache[collection]


def push(collection, item, max_length=2000):
    arr = get(collection)
    arr.append(item)
    if len(arr) > max_length:
        del arr[: len(arr) - max_length]
    _save(collection)
    return item


def update(collection, predicate, updater):
    arr = get(collection)
    changed = False
    for i, row in enumerate(arr):
        if predicate(row):
            arr[i] = updater(row)
            changed = True
    if changed:
        _save(collection)
    return changed


def find(collection, predicate):
    for row in get(collection):
        if predicate(row):
            return row
    return None
