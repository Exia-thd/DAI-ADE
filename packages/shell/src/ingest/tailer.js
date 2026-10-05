/**
 * JSONL tailer.
 *
 * Three things make this harder than `readFile` on an interval, and all three
 * have bitten this stack before:
 *
 *  1. **Torn lines.** An appending writer and a reading tailer are not
 *     synchronised. Reading while a line is half-written yields a fragment, and
 *     a naive `split('\n')` turns that into a parse error and a lost event.
 *     The remainder is carried into the next read instead.
 *  2. **No inotify on Windows.** fs.watch misses appends from another process.
 *     Polling the size is the only thing that reliably sees them here.
 *  3. **Truncation and rotation.** If the file shrinks, the offset is stale and
 *     reading from it returns garbage. Shrink means start over.
 *
 * Deliberately dependency-free. chokidar would do (1) and (2) for us, but this
 * runs in the Electron main process, which is the one place where every added
 * dependency is also an added native-rebuild risk on Windows.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { validateEvent } = require('../../../shared/src/events.js');

const DEFAULT_INTERVAL = 150;

class JsonlTailer extends EventEmitter {
  /**
   * @param {string} file        path to the .jsonl file
   * @param {object} [options]
   * @param {number} [options.intervalMs] poll period
   * @param {boolean} [options.fromStart] read existing content before following
   */
  constructor(file, options = {}) {
    super();
    this.file = file;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL;
    this.fromStart = options.fromStart !== false;
    this.offset = 0;
    this.remainder = '';
    this.timer = null;
    this.reading = false;
    this.stats = { lines: 0, events: 0, invalid: 0, torn: 0, restarts: 0 };
  }

  start() {
    if (this.timer) return this;
    if (!this.fromStart) {
      try { this.offset = fs.statSync(this.file).size; } catch { this.offset = 0; }
    }
    // Defer the first read. Polling synchronously here would emit everything a
    // pre-existing file already contains before the caller — who only gets the
    // instance back when start() returns — has had a chance to subscribe, so
    // the opening batch would vanish depending on listener registration order.
    // That is precisely the silent-loss failure this module exists to prevent.
    setImmediate(() => this.poll());
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    if (this.timer.unref) this.timer.unref();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this;
  }

  poll() {
    if (this.reading) return;
    let size;
    try {
      size = fs.statSync(this.file).size;
    } catch {
      return; // not created yet; keep polling
    }
    if (size === this.offset) return;
    if (size < this.offset) {
      // Truncated or replaced. Anything we think we know about the position is
      // wrong, so re-read from the top rather than emit garbage.
      this.offset = 0;
      this.remainder = '';
      this.stats.restarts++;
      this.emit('restart');
    }
    this.reading = true;
    try {
      this.readFrom(size);
    } finally {
      this.reading = false;
    }
  }

  readFrom(size) {
    const length = size - this.offset;
    if (length <= 0) return;
    const buffer = Buffer.allocUnsafe(length);
    let fd;
    let read = 0;
    try {
      fd = fs.openSync(this.file, 'r');
      read = fs.readSync(fd, buffer, 0, length, this.offset);
    } catch {
      return;
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
    }
    if (read <= 0) return;
    this.offset += read;

    const chunk = this.remainder + buffer.toString('utf8', 0, read);
    const parts = chunk.split('\n');
    // The last element is whatever follows the final newline: either empty, or
    // a line the writer has not finished yet. Carry it.
    this.remainder = parts.pop() ?? '';
    if (this.remainder) this.stats.torn++;

    for (const line of parts) {
      const text = line.trim();
      if (!text) continue;
      this.stats.lines++;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.stats.invalid++;
        this.emit('invalid', { reason: 'unparseable', line: text.slice(0, 200) });
        continue;
      }
      const result = validateEvent(parsed);
      if (!result.ok) {
        this.stats.invalid++;
        this.emit('invalid', { reason: 'schema', errors: result.errors, line: text.slice(0, 200) });
        continue;
      }
      this.stats.events++;
      this.emit('event', result.event);
    }
  }
}

/**
 * Watch a directory of per-run .jsonl files and tail each one.
 * New runs appear as new files, so the directory itself has to be polled too.
 */
class RunDirectoryTailer extends EventEmitter {
  constructor(dir, options = {}) {
    super();
    this.dir = dir;
    this.options = options;
    this.tailers = new Map();
    this.timer = null;
  }

  start() {
    if (this.timer) return this;
    this.scan();
    this.timer = setInterval(() => this.scan(), this.options.scanIntervalMs ?? 1000);
    if (this.timer.unref) this.timer.unref();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.tailers.values()) t.stop();
    this.tailers.clear();
    return this;
  }

  scan() {
    let names;
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl') || this.tailers.has(name)) continue;
      const tailer = new JsonlTailer(path.join(this.dir, name), this.options);
      tailer.on('event', (e) => this.emit('event', e));
      tailer.on('invalid', (d) => this.emit('invalid', { ...d, file: name }));
      this.tailers.set(name, tailer.start());
      this.emit('run', name.replace(/\.jsonl$/, ''));
    }
  }

  get stats() {
    const total = { lines: 0, events: 0, invalid: 0, torn: 0, restarts: 0, files: this.tailers.size };
    for (const t of this.tailers.values()) {
      for (const k of ['lines', 'events', 'invalid', 'torn', 'restarts']) total[k] += t.stats[k];
    }
    return total;
  }
}

module.exports = { JsonlTailer, RunDirectoryTailer };
