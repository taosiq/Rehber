"""Sending email: password resets, team invitations, hand-off alerts.

Providers:
- console (default): logs the email and keeps it in `OUTBOX` (development and tests)
- brevo: Brevo's transactional HTTPS API (free 300/day; works where SMTP ports are blocked)

Sending never raises into the caller: a failed email is logged and reported as False, so a
mail outage can't break sign-in or chat.
"""

import html
import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)
BREVO_URL = "https://api.brevo.com/v3/smtp/email"


@dataclass
class Email:
    to: str
    subject: str
    text: str
    html: str


OUTBOX: list[Email] = []  # console provider keeps the last emails here (tests read it)


def enabled() -> bool:
    """True when emails really leave the server."""
    s = get_settings()
    return s.email_provider == "brevo" and bool(s.brevo_api_key and s.email_from)


async def send(email: Email) -> bool:
    s = get_settings()
    if s.email_provider != "brevo":
        OUTBOX.append(email)
        del OUTBOX[:-50]
        log.info("EMAIL (console) to=%s subject=%s\n%s", email.to, email.subject, email.text)
        return True
    if not enabled():
        log.error("Email not sent: BREVO_API_KEY or EMAIL_FROM missing")
        return False
    payload = {
        "sender": {"name": s.email_from_name, "email": s.email_from},
        "to": [{"email": email.to}],
        "subject": email.subject,
        "htmlContent": email.html,
        "textContent": email.text,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(BREVO_URL, json=payload, headers={"api-key": s.brevo_api_key, "accept": "application/json"})
        if res.status_code >= 300:
            log.error("Brevo refused the email (%s): %s", res.status_code, res.text[:300])
            return False
        return True
    except httpx.HTTPError as exc:
        log.error("Could not reach Brevo: %s", exc)
        return False


# ---------------------------------------------------------------- templates


def _layout(title: str, paragraphs: list[str], button: tuple[str, str] | None, footer: str) -> str:
    """A simple, email-client-safe layout. Every value passed in is plain text and gets escaped here."""
    body = "".join(f'<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3d3d48">{html.escape(p)}</p>' for p in paragraphs)
    cta = ""
    if button:
        label, url = button
        cta = (f'<p style="margin:22px 0"><a href="{html.escape(url, quote=True)}" '
               'style="display:inline-block;background:#f5b544;color:#111;font-weight:600;text-decoration:none;'
               f'padding:12px 22px;border-radius:10px;font-size:15px">{html.escape(label)}</a></p>'
               f'<p style="margin:0 0 14px;font-size:12px;color:#8b8a9b;word-break:break-all">{html.escape(url)}</p>')
    return (
        '<div style="background:#f6f5f2;padding:32px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">'
        '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">'
        '<p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#111">Rehber</p>'
        f'<h1 style="margin:0 0 16px;font-size:22px;color:#111">{html.escape(title)}</h1>{body}{cta}'
        f'<p style="margin:24px 0 0;font-size:12px;color:#8b8a9b">{html.escape(footer)}</p>'
        "</div></div>"
    )


def _text(title: str, paragraphs: list[str], button: tuple[str, str] | None, footer: str) -> str:
    parts = [title, "", *paragraphs]
    if button:
        parts += ["", f"{button[0]}: {button[1]}"]
    return "\n".join([*parts, "", footer])


def _make(to: str, subject: str, title: str, paragraphs: list[str], button: tuple[str, str] | None, footer: str) -> Email:
    return Email(to=to, subject=subject, text=_text(title, paragraphs, button, footer),
                 html=_layout(title, paragraphs, button, footer))


def password_reset(to: str, name: str, url: str) -> Email:
    return _make(to, "Reset your Rehber password", "Reset your password", [
        f"Hi {name},",
        "Someone (hopefully you) asked to reset the password for your Rehber account. "
        "The link works once and expires in 1 hour.",
    ], ("Choose a new password", url),
        "If you didn't ask for this, you can ignore this email: your password stays the same.")


def invitation(to: str, business: str, inviter: str, role: str, url: str) -> Email:
    return _make(to, f"{inviter} invited you to {business} on Rehber", f"Join {business}", [
        f"{inviter} invited you to join {business} on Rehber as {'an admin' if role == 'admin' else 'a team member'}.",
        "Rehber is an AI support assistant. As part of the team you can read customer conversations and reply "
        "when a customer needs a person.",
        f"Sign up or log in with this email address ({to}). The link works once and expires in 7 days.",
    ], ("Accept invitation", url), "If you weren't expecting this, you can ignore this email.")


def handoff_alert(to: str, business: str, reason: str | None, contact: str | None, url: str) -> Email:
    lines = [f"A customer of {business} asked for a person, or the AI agent couldn't help."]
    if reason:
        lines.append(f"Reason: {reason}")
    if contact:
        lines.append(f"Customer contact: {contact}")
    return _make(to, f"A customer needs a human · {business}", "A customer needs a human", lines,
                 ("Open the conversation", url), "You get this because you're an owner or admin of this business on Rehber.")
