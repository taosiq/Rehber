"""WhatsApp channel (Meta WhatsApp Cloud API).

Flow for one customer message:
  Meta -> POST /api/whatsapp/webhook (signature checked) -> background task here:
  find the business by the number the message arrived on -> find/create the customer's conversation ->
  mark read + typing indicator -> run the same agent as the website -> send the answer back.

Safety:
- Meta retries webhooks, so every customer message id ("wamid") is handled once (Redis + a unique column).
- Messages from one customer are processed one at a time, in order.
- Per-customer and per-business rate limits protect the free AI quota from floods.
"""

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.core import ratelimit
from app.core.config import get_settings
from app.core.crypto import decrypt
from app.db.session import SessionLocal
from app.models import Conversation, Message, Tenant, WhatsAppAccount
from app.services.agent.runner import run_turn

log = logging.getLogger(__name__)

MAX_TEXT = 4000  # WhatsApp allows 4096 characters per text message
WINDOW = timedelta(hours=24)  # free-form replies are only allowed within 24h of the customer's last message
PER_CUSTOMER = (12, 60)  # messages per minute from one customer that get an AI answer
PER_BUSINESS = (240, 60)


# ---------------------------------------------------------------- Graph API


class WhatsAppError(Exception):
    def __init__(self, message: str, code: int | None = None, status: int | None = None):
        super().__init__(message)
        self.message, self.code, self.status = message, code, status

    @property
    def outside_window(self) -> bool:
        return self.code == 131047  # "Re-engagement message": more than 24h since the customer wrote


def _url(path: str) -> str:
    s = get_settings()
    return f"{s.whatsapp_graph_url.rstrip('/')}/{s.whatsapp_graph_version}/{path.lstrip('/')}"


async def _graph(method: str, path: str, token: str, json: dict | None = None, params: dict | None = None) -> dict:
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.request(method, _url(path), json=json, params=params,
                                       headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as exc:
        raise WhatsAppError(f"Could not reach Meta ({type(exc).__name__}).") from exc
    try:
        data = res.json()
    except ValueError:
        data = {}
    if res.status_code >= 400 or "error" in data:
        err = data.get("error") or {}
        detail = (err.get("error_data") or {}).get("details") or err.get("message") or f"HTTP {res.status_code}"
        raise WhatsAppError(str(detail)[:300], err.get("code"), res.status_code)
    return data


async def phone_info(phone_number_id: str, token: str) -> dict:
    """Checks the token and number together. Returns display_phone_number and verified_name."""
    return await _graph("GET", phone_number_id, token,
                        params={"fields": "display_phone_number,verified_name,quality_rating"})


async def subscribe_app(waba_id: str, token: str) -> None:
    """Ask Meta to send this WhatsApp Business Account's messages to our app's webhook."""
    await _graph("POST", f"{waba_id}/subscribed_apps", token)


async def send_text(phone_number_id: str, token: str, to: str, text: str) -> list[str]:
    """Send a text, split into several messages if long. Returns Meta's message ids."""
    ids = []
    for part in split_text(text):
        data = await _graph("POST", f"{phone_number_id}/messages", token, json={
            "messaging_product": "whatsapp", "recipient_type": "individual", "to": to,
            "type": "text", "text": {"preview_url": False, "body": part},
        })
        ids += [m["id"] for m in data.get("messages", []) if m.get("id")]
    return ids


async def send_template(phone_number_id: str, token: str, to: str, name: str = "hello_world",
                        language: str = "en_US") -> list[str]:
    """Templates are the only messages a business may send first (used for the connection test)."""
    data = await _graph("POST", f"{phone_number_id}/messages", token, json={
        "messaging_product": "whatsapp", "to": to, "type": "template",
        "template": {"name": name, "language": {"code": language}},
    })
    return [m["id"] for m in data.get("messages", []) if m.get("id")]


async def mark_read(phone_number_id: str, token: str, message_id: str, typing: bool = True) -> None:
    """Blue ticks, plus "typing..." until we answer (Meta clears it after 25 s or on our reply)."""
    body: dict = {"messaging_product": "whatsapp", "status": "read", "message_id": message_id}
    if typing:
        body["typing_indicator"] = {"type": "text"}
    try:
        await _graph("POST", f"{phone_number_id}/messages", token, json=body)
    except WhatsAppError as exc:  # cosmetic: never block the answer
        log.info("WhatsApp mark-read failed: %s", exc.message)


# ---------------------------------------------------------------- formatting

_CITE = re.compile(r"[ \t]?\[\d+(?:\]\[\d+)*(?:\s*,\s*\d+)*\]")
_BOLD = re.compile(r"\*\*(.+?)\*\*", re.S)
_HEADING = re.compile(r"^#{1,6}\s*(.+?)\s*#*$", re.M)
_LINK = re.compile(r"\[([^\]\n]+)\]\((https?://[^)\s]+)\)")


def to_whatsapp(text: str, cited: list[dict] | None = None) -> str:
    """Turn the agent's markdown into WhatsApp formatting.

    Citation markers like [1] mean nothing on a phone, so they are removed; web pages that were cited are
    listed at the end instead, so the customer can still check the source.
    """
    out = _LINK.sub(r"\1 (\2)", text)
    out = _CITE.sub("", out)
    out = _HEADING.sub(r"*\1*", out)
    out = _BOLD.sub(r"*\1*", out)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    links = []
    for s in cited or []:
        url = s.get("url")
        if url and url not in out and url not in [u for _, u in links]:
            links.append((s.get("title") or url, url))
    if links:
        out += "\n\n" + "\n".join(f"🔗 {title}: {url}" for title, url in links[:3])
    return out


def split_text(text: str, limit: int = MAX_TEXT) -> list[str]:
    """Split on paragraph, then line, then word boundaries."""
    text = text.strip()
    if len(text) <= limit:
        return [text] if text else []
    parts, rest = [], text
    while len(rest) > limit:
        cut = max(rest.rfind("\n\n", 0, limit), rest.rfind("\n", 0, limit), rest.rfind(" ", 0, limit))
        if cut < limit // 2:
            cut = limit
        parts.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        parts.append(rest)
    return parts


# Said in the customer's language when the AI can't answer (we never show technical errors to customers).
SORRY = {
    "en": "Sorry, I can't answer right now. Our team will see your message and get back to you.",
    "tr": "Üzgünüz, şu anda yanıt veremiyorum. Ekibimiz mesajınızı görecek ve size dönecek.",
    "ar": "عذرًا، لا يمكنني الرد الآن. سيطّلع فريقنا على رسالتك ويتواصل معك.",
    "de": "Entschuldigung, ich kann gerade nicht antworten. Unser Team sieht Ihre Nachricht und meldet sich.",
    "fr": "Désolé, je ne peux pas répondre pour le moment. Notre équipe verra votre message et vous répondra.",
    "ru": "Извините, сейчас я не могу ответить. Наша команда увидит ваше сообщение и свяжется с вами.",
    "fa": "متأسفیم، الان نمی‌توانم پاسخ دهم. تیم ما پیام شما را می‌بیند و با شما تماس می‌گیرد.",
    "ur": "معذرت، میں ابھی جواب نہیں دے سکتا۔ ہماری ٹیم آپ کا پیغام دیکھ کر آپ سے رابطہ کرے گی۔",
}
TEXT_ONLY = {
    "en": "Sorry, I can only read text messages. Please type your question.",
    "tr": "Üzgünüz, yalnızca yazılı mesajları okuyabiliyorum. Lütfen sorunuzu yazın.",
    "ar": "عذرًا، يمكنني قراءة الرسائل النصية فقط. يُرجى كتابة سؤالك.",
    "de": "Entschuldigung, ich kann nur Textnachrichten lesen. Bitte schreiben Sie Ihre Frage.",
    "fr": "Désolé, je ne peux lire que les messages texte. Veuillez écrire votre question.",
    "ru": "Извините, я могу читать только текстовые сообщения. Пожалуйста, напишите ваш вопрос.",
    "fa": "متأسفیم، فقط می‌توانم پیام‌های متنی را بخوانم. لطفاً سؤال خود را بنویسید.",
    "ur": "معذرت، میں صرف تحریری پیغامات پڑھ سکتا ہوں۔ براہ کرم اپنا سوال لکھیں۔",
}


# ---------------------------------------------------------------- webhook payload


@dataclass
class Inbound:
    phone_number_id: str
    wa_id: str  # the customer's WhatsApp id (their number without "+")
    name: str | None
    message_id: str
    kind: str  # text | button | interactive | image | audio | ...
    text: str | None  # None when the message has no text we can answer (voice note, sticker, ...)


@dataclass
class Status:
    phone_number_id: str
    message_id: str
    status: str  # sent | delivered | read | failed
    error: str | None


IGNORED = {"reaction", "system", "unsupported", "request_welcome", "order", "ephemeral"}


def _text_of(m: dict) -> str | None:
    kind = m.get("type")
    if kind == "text":
        return (m.get("text") or {}).get("body")
    if kind == "button":
        return (m.get("button") or {}).get("text")
    if kind == "interactive":
        i = m.get("interactive") or {}
        reply = i.get("button_reply") or i.get("list_reply") or {}
        return reply.get("title")
    if kind in ("image", "video", "document"):
        return (m.get(kind) or {}).get("caption") or None  # a photo with a question in the caption
    return None


def parse_webhook(payload: dict) -> tuple[list[Inbound], list[Status]]:
    inbound, statuses = [], []
    if payload.get("object") != "whatsapp_business_account":
        return inbound, statuses
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            if change.get("field") != "messages":
                continue
            v = change.get("value") or {}
            pnid = str((v.get("metadata") or {}).get("phone_number_id") or "")
            if not pnid:
                continue
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in v.get("contacts") or []}
            for m in v.get("messages") or []:
                if m.get("type") in IGNORED or not m.get("id") or not m.get("from"):
                    continue
                text = _text_of(m)
                inbound.append(Inbound(pnid, str(m["from"]), names.get(m["from"]), str(m["id"]),
                                       str(m.get("type")), text.strip()[:4000] if text and text.strip() else None))
            for s in v.get("statuses") or []:
                if s.get("id") and s.get("status"):
                    errs = s.get("errors") or []
                    err = errs[0].get("title") or errs[0].get("message") if errs else None
                    statuses.append(Status(pnid, str(s["id"]), str(s["status"]), err))
    return inbound, statuses


# ---------------------------------------------------------------- handling

_locks: dict[str, asyncio.Lock] = {}


def _lock(key: str) -> asyncio.Lock:
    if len(_locks) > 5000:  # drop idle locks so the dict can't grow forever
        for k in [k for k, lk in _locks.items() if not lk.locked()]:
            _locks.pop(k, None)
    return _locks.setdefault(key, asyncio.Lock())


async def _first_time(message_id: str) -> bool:
    """Quick duplicate check for Meta's retries. The unique DB column is the real guarantee."""
    try:
        return bool(await ratelimit.get_redis().set(f"wa:seen:{message_id}", 1, nx=True, ex=3 * 24 * 3600))
    except Exception:
        return True


async def _record_error(account_id: uuid.UUID, message: str) -> None:
    async with SessionLocal() as db:
        await db.execute(update(WhatsAppAccount).where(WhatsAppAccount.id == account_id)
                         .values(last_error=message[:500], last_error_at=datetime.now(timezone.utc)))
        await db.commit()


async def _customer_conversation(db, tenant: Tenant, msg: Inbound) -> Conversation:
    """One running conversation per customer, like the chat in their WhatsApp app."""
    convo = await db.scalar(
        select(Conversation).where(Conversation.tenant_id == tenant.id, Conversation.channel == "whatsapp",
                                   Conversation.external_user == msg.wa_id)
        .order_by(Conversation.created_at.desc()).limit(1)
    )
    if convo is None:
        convo = Conversation(tenant_id=tenant.id, channel="whatsapp", external_user=msg.wa_id,
                             title=(msg.text or f"WhatsApp {msg.kind}")[:200], customer_contact=f"+{msg.wa_id}")
        db.add(convo)
    if msg.name:
        convo.customer_name = msg.name[:200]
    await db.flush()
    return convo


async def _reply(account: WhatsAppAccount, token: str, to: str, text: str, convo_id: uuid.UUID,
                 tenant_id: uuid.UUID, message_id: uuid.UUID | None = None, language: str | None = None) -> None:
    """Send text and remember Meta's id on our message row (for delivery ticks in the inbox)."""
    async with SessionLocal() as db:
        try:
            ids = await send_text(account.phone_number_id, token, to, text)
            delivery, ext = "sent", (ids[0] if ids else None)
        except WhatsAppError as exc:
            log.warning("WhatsApp send failed: %s", exc.message)
            await _record_error(account.id, f"Sending a reply failed: {exc.message}")
            delivery, ext = "failed", None
        if message_id is None:  # a message the agent didn't write (e.g. "text only, please")
            db.add(Message(tenant_id=tenant_id, conversation_id=convo_id, role="assistant", content=text,
                           language=language, external_id=ext, delivery=delivery))
        else:
            await db.execute(update(Message).where(Message.id == message_id).values(external_id=ext, delivery=delivery))
        await db.commit()


async def handle_inbound(msg: Inbound) -> None:
    async with _lock(f"{msg.phone_number_id}:{msg.wa_id}"):
        try:
            await _handle(msg)
        except Exception:
            log.exception("WhatsApp message %s failed", msg.message_id)


async def _handle(msg: Inbound) -> None:
    if not await _first_time(msg.message_id):
        return
    async with SessionLocal() as db:
        account = await db.scalar(select(WhatsAppAccount).where(WhatsAppAccount.phone_number_id == msg.phone_number_id))
        if account is None:
            log.info("WhatsApp message for unknown number %s ignored", msg.phone_number_id)
            return
        tenant = await db.get(Tenant, account.tenant_id)
        token = decrypt(account.token_encrypted)
        account.last_inbound_at = datetime.now(timezone.utc)
        await db.commit()
        if token is None:
            await _record_error(account.id, "The saved access token can't be read (was SECRET_KEY changed?). "
                                            "Connect the number again.")
            return

        # Floods: still saved for the team, but the AI doesn't answer each one.
        flooding = False
        try:
            ok_c, _ = await ratelimit.hit(f"wa:cust:{tenant.id}:{msg.wa_id}", *PER_CUSTOMER)
            ok_b, _ = await ratelimit.hit(f"wa:biz:{tenant.id}", *PER_BUSINESS)
            flooding = not (ok_c and ok_b)
        except Exception:
            flooding = True  # fail closed, like the other limits

        convo = await _customer_conversation(db, tenant, msg)
        await db.commit()
        prev_lang = await db.scalar(
            select(Message.language).where(Message.conversation_id == convo.id, Message.role == "user",
                                           Message.language.is_not(None))
            .order_by(Message.created_at.desc()).limit(1)
        )
        lang = prev_lang or tenant.default_language or "en"

        if msg.text is None or flooding:
            note = f"(sent a {msg.kind} message)" if msg.text is None else msg.text
            try:
                db.add(Message(tenant_id=tenant.id, conversation_id=convo.id, role="user", content=note,
                               language=prev_lang, external_id=msg.message_id))
                convo.last_message_at = datetime.now(timezone.utc)
                if convo.status == "resolved":
                    convo.status = "open"
                await db.commit()
            except IntegrityError:
                return  # already handled
            if msg.text is None and not convo.ai_paused:
                await _reply(account, token, msg.wa_id, TEXT_ONLY.get(lang, TEXT_ONLY["en"]), convo.id, tenant.id,
                             language=lang)
            return

        if not convo.ai_paused:
            await mark_read(account.phone_number_id, token, msg.message_id)

        answer, done, failed = [], None, False
        try:
            async for ev in run_turn(db, tenant, msg.text, convo.id, channel="whatsapp", external_id=msg.message_id):
                if ev["event"] == "meta":
                    lang = ev["data"].get("language") or lang
                elif ev["event"] == "token":
                    answer.append(ev["data"]["text"])
                elif ev["event"] == "done":
                    done = ev["data"]
                elif ev["event"] == "error":
                    failed = True
        except IntegrityError:
            return  # Meta delivered the same message twice at the same moment; the other one answers it

        if failed:
            await _reply(account, token, msg.wa_id, SORRY.get(lang, SORRY["en"]), convo.id, tenant.id, language=lang)
            return
        if done is None or done.get("ai_paused") or not done.get("message_id"):
            return  # a team member is handling this chat: they reply from the inbox
        text = to_whatsapp("".join(answer), done.get("cited"))
        if text:
            await _reply(account, token, msg.wa_id, text, convo.id, tenant.id, uuid.UUID(done["message_id"]))


RANK = {"sent": 1, "delivered": 2, "read": 3}


async def handle_statuses(statuses: list[Status]) -> None:
    """Delivery ticks for our outgoing messages; failures are shown on the WhatsApp page."""
    if not statuses:
        return
    async with SessionLocal() as db:
        for s in statuses:
            account = await db.scalar(select(WhatsAppAccount).where(WhatsAppAccount.phone_number_id == s.phone_number_id))
            if account is None:
                continue
            msg = await db.scalar(select(Message).where(Message.tenant_id == account.tenant_id,
                                                        Message.external_id == s.message_id))
            if msg is None:
                continue
            if s.status == "failed":
                msg.delivery = "failed"
                account.last_error = f"A message could not be delivered: {s.error or 'unknown reason'}"[:500]
                account.last_error_at = datetime.now(timezone.utc)
            elif RANK.get(s.status, 0) > RANK.get(msg.delivery or "", 0):
                msg.delivery = s.status  # ticks only move forward (Meta may send them out of order)
        await db.commit()


async def last_customer_message_at(db, conversation_id: uuid.UUID) -> datetime | None:
    return await db.scalar(select(func.max(Message.created_at))
                           .where(Message.conversation_id == conversation_id, Message.role == "user"))
