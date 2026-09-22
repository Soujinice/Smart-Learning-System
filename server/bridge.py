"""Smart Learning Center - RFC2217 bridge to the Wokwi-simulated ESP32.

Wokwi exposes the simulated ESP32's UART0 as a Telnet/RFC2217 server on
localhost:4000 (see firmware/wokwi.toml). This module connects to it as a
plain asyncio TCP client, strips the Telnet/RFC2217 IAC negotiation bytes
out of the stream (including IAC IAC escaping and IAC SB ... IAC SE
subnegotiation blocks), reassembles newline-terminated lines, and emits
each one. Lines prefixed with "@@" are protocol JSON (see PROTOCOL.md);
anything else is treated as free-text debug output.

Commands are sent back as plain "CMD {json}\n" lines - Wokwi's RFC2217
server passes bytes through to the firmware's UART RX, so no telnet
framing is required on the way out for ordinary ASCII/JSON text.
"""
import asyncio
import json

from emitter import AsyncEmitter

IAC, SB, SE, WILL, WONT, DO, DONT = 255, 250, 240, 251, 252, 253, 254


class TelnetFilter:
    def __init__(self, on_clean):
        self.state = "DATA"
        self.on_clean = on_clean
        self.buf = bytearray()

    def push(self, chunk: bytes):
        for byte in chunk:
            if self.state == "DATA":
                if byte == IAC:
                    self.state = "IAC"
                else:
                    self.buf.append(byte)
            elif self.state == "IAC":
                if byte == IAC:
                    self.buf.append(IAC)
                    self.state = "DATA"
                elif byte == SB:
                    self.state = "SB"
                elif byte in (WILL, WONT, DO, DONT):
                    self.state = "OPTION"
                else:
                    self.state = "DATA"  # other 2-byte IAC commands (NOP, GA, ...)
            elif self.state == "OPTION":
                self.state = "DATA"  # consume the option byte; we never reply to negotiation
            elif self.state == "SB":
                if byte == IAC:
                    self.state = "SB_IAC"
                # else: discard subnegotiation payload bytes
            elif self.state == "SB_IAC":
                if byte == SE:
                    self.state = "DATA"
                else:
                    self.state = "SB"  # escaped IAC inside SB, or unexpected byte
        if self.buf:
            out = bytes(self.buf)
            self.buf = bytearray()
            self.on_clean(out)


class Bridge(AsyncEmitter):
    def __init__(self, host: str, port: int):
        super().__init__()
        self.host = host
        self.port = port
        self.writer = None
        self.line_buffer = ""
        self.backoff = 1.0
        self.connected = False
        self.wanted = True
        self._pending_events = []
        self.filter = TelnetFilter(self._on_clean_bytes)
        self._task = None

    def start(self):
        self.wanted = True
        self._task = asyncio.create_task(self._connect_loop())

    def stop(self):
        self.wanted = False
        if self.writer:
            self.writer.close()

    def is_connected(self) -> bool:
        return self.connected

    async def send(self, line: str) -> bool:
        if not self.connected or not self.writer:
            return False
        data = line if line.endswith("\n") else line + "\n"
        self.writer.write(data.encode("utf-8"))
        await self.writer.drain()
        return True

    async def _connect_loop(self):
        while self.wanted:
            try:
                reader, writer = await asyncio.open_connection(self.host, self.port)
                self.writer = writer
                self.connected = True
                self.backoff = 1.0
                await self.emit("connected")
                while True:
                    chunk = await reader.read(4096)
                    if not chunk:
                        break
                    self.filter.push(chunk)
                    await self._drain_pending_events()
            except (ConnectionRefusedError, OSError):
                pass
            finally:
                was_connected = self.connected
                self.connected = False
                self.writer = None
                if was_connected:
                    await self.emit("disconnected")
            if not self.wanted:
                return
            await asyncio.sleep(self.backoff)
            self.backoff = min(self.backoff * 2, 15.0)

    async def _drain_pending_events(self):
        while self._pending_events:
            event, arg = self._pending_events.pop(0)
            await self.emit(event, arg)

    def _on_clean_bytes(self, buf: bytes):
        self.line_buffer += buf.decode("utf-8", errors="replace")
        while "\n" in self.line_buffer:
            idx = self.line_buffer.index("\n")
            raw_line = self.line_buffer[:idx].rstrip("\r")
            self.line_buffer = self.line_buffer[idx + 1:]
            if raw_line:
                self._on_line(raw_line)

    def _on_line(self, line: str):
        if line.startswith("@@"):
            try:
                msg = json.loads(line[2:])
                self._pending_events.append(("message", msg))
            except json.JSONDecodeError:
                self._pending_events.append(("raw", f"[malformed @@ line] {line}"))
        else:
            self._pending_events.append(("raw", line))
