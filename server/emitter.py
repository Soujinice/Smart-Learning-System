"""Tiny async pub/sub used by bridge.py and demo_device.py so main.py can
treat a real Wokwi connection and the demo generator identically.
"""
import asyncio
import inspect


class AsyncEmitter:
    def __init__(self):
        self._handlers = {}

    def on(self, event, handler):
        self._handlers.setdefault(event, []).append(handler)

    async def emit(self, event, *args):
        for handler in list(self._handlers.get(event, [])):
            result = handler(*args)
            if inspect.isawaitable(result):
                await result
