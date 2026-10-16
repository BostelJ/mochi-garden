"""Evaluate JS in a running Mochi Garden page over the WebView2 DevTools port and print the result.

Launch the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333, then:
  uv run --with websocket-client python tools/console.py "<page title>" "<js expression>"
"""
import json
import sys
import urllib.request

import websocket

title, expr = sys.argv[1], sys.argv[2]
pages = json.load(urllib.request.urlopen("http://127.0.0.1:9333/json"))
page = next(p for p in pages if p.get("title") == title)
ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
while True:
    msg = json.loads(ws.recv())
    if msg.get("id") == 1:
        print(json.dumps(msg.get("result"), indent=1)[:4000])
        break
