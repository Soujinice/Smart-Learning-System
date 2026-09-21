// Smart Learning Center - RFC2217 bridge to the Wokwi-simulated ESP32.
//
// Wokwi exposes the simulated ESP32's UART0 as a Telnet/RFC2217 server on
// localhost:4000 (see firmware/wokwi.toml). This module connects to it as
// a plain TCP client, strips the Telnet/RFC2217 IAC negotiation bytes out
// of the stream (including IAC IAC escaping and IAC SB ... IAC SE
// subnegotiation blocks), reassembles newline-terminated lines, and hands
// each line to the caller. Lines prefixed with "@@" are protocol JSON
// (see PROTOCOL.md); anything else is treated as free-text debug output.
//
// Commands are sent back as plain "CMD {json}\n" lines - Wokwi's RFC2217
// server passes bytes through to the firmware's UART RX, so no telnet
// framing is required on the way out for ordinary ASCII/JSON text.
import net from 'net';
import { EventEmitter } from 'events';

const IAC = 255, SB = 250, SE = 240, WILL = 251, WONT = 252, DO = 253, DONT = 254;

class TelnetFilter {
  constructor(onClean) {
    this.state = 'DATA';
    this.onClean = onClean;
    this.buf = [];
  }

  push(chunk) {
    for (const byte of chunk) {
      switch (this.state) {
        case 'DATA':
          if (byte === IAC) this.state = 'IAC';
          else this.buf.push(byte);
          break;
        case 'IAC':
          if (byte === IAC) { this.buf.push(IAC); this.state = 'DATA'; }
          else if (byte === SB) this.state = 'SB';
          else if (byte === WILL || byte === WONT || byte === DO || byte === DONT) this.state = 'OPTION';
          else this.state = 'DATA'; // other 2-byte IAC commands (NOP, GA, ...)
          break;
        case 'OPTION':
          this.state = 'DATA'; // consume the option byte; we never reply to negotiation
          break;
        case 'SB':
          if (byte === IAC) this.state = 'SB_IAC';
          break; // discard subnegotiation payload bytes
        case 'SB_IAC':
          if (byte === SE) this.state = 'DATA';
          else this.state = 'SB'; // escaped IAC inside SB, or unexpected byte
          break;
      }
    }
    if (this.buf.length) {
      const out = Buffer.from(this.buf);
      this.buf = [];
      this.onClean(out);
    }
  }
}

export default class Bridge extends EventEmitter {
  constructor({ host, port }) {
    super();
    this.host = host;
    this.port = port;
    this.socket = null;
    this.lineBuffer = '';
    this.backoffMs = 1000;
    this.connected = false;
    this.wanted = true;
    this.filter = new TelnetFilter((clean) => this._onCleanBytes(clean));
  }

  start() {
    this.wanted = true;
    this._connect();
  }

  stop() {
    this.wanted = false;
    if (this.socket) this.socket.destroy();
  }

  isConnected() {
    return this.connected;
  }

  send(line) {
    if (!this.connected || !this.socket) return false;
    this.socket.write(line.endsWith('\n') ? line : line + '\n');
    return true;
  }

  _connect() {
    if (!this.wanted) return;
    this.socket = net.createConnection({ host: this.host, port: this.port });

    this.socket.on('connect', () => {
      this.connected = true;
      this.backoffMs = 1000;
      this.emit('connected');
    });

    this.socket.on('data', (chunk) => this.filter.push(chunk));

    this.socket.on('error', () => {
      // 'close' fires right after; reconnect is scheduled there.
    });

    this.socket.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) this.emit('disconnected');
      if (!this.wanted) return;
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, 15000);
      setTimeout(() => this._connect(), delay);
    });
  }

  _onCleanBytes(buf) {
    this.lineBuffer += buf.toString('utf-8');
    let idx;
    while ((idx = this.lineBuffer.indexOf('\n')) >= 0) {
      const rawLine = this.lineBuffer.slice(0, idx).replace(/\r$/, '');
      this.lineBuffer = this.lineBuffer.slice(idx + 1);
      if (rawLine.length === 0) continue;
      this._onLine(rawLine);
    }
  }

  _onLine(line) {
    if (line.startsWith('@@')) {
      try {
        const msg = JSON.parse(line.slice(2));
        this.emit('message', msg);
      } catch (err) {
        this.emit('raw', `[malformed @@ line] ${line}`);
      }
    } else {
      this.emit('raw', line);
    }
  }
}
