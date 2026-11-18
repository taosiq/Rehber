"""HTTP security middleware (pure ASGI so streaming responses are never buffered)."""

from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
]


class SecurityHeaders:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        no_store = scope["path"].startswith("/api/auth")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                existing = {k.lower() for k, _ in headers}
                headers += [(k, v) for k, v in SECURITY_HEADERS if k not in existing]
                if no_store:
                    headers.append((b"cache-control", b"no-store"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


class SplitCORS:
    """Two CORS policies:
    - /api/public/*: any website may call (the API key's origin list is enforced per request),
      but never with cookies.
    - everything else: only the dashboard origins, with cookies.
    """

    def __init__(self, app: ASGIApp, dashboard_origins: list[str]):
        self.public = CORSMiddleware(
            app, allow_origins=["*"], allow_credentials=False,
            allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type", "X-Rehber-Key"], max_age=600,
        )
        self.dashboard = CORSMiddleware(
            app, allow_origins=dashboard_origins, allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allow_headers=["Content-Type", "X-CSRF-Token"], max_age=600,
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].startswith("/api/public/"):
            return await self.public(scope, receive, send)
        return await self.dashboard(scope, receive, send)
