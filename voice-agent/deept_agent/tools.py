"""The receptionist's tools: everything the model says about prices, orders or
the office comes from here, never from its own guesses.
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime

from .catalog import Catalog
from .office import TEHRAN, WEEKDAYS, WEEKDAYS_FA, Office
from .persian import normalize, to_fa_digits, toman_words
from .services import Orders, Sms, is_mobile, normalize_phone

log = logging.getLogger(__name__)

ORDER_STATUS_FA = {"PENDING": "در حال انجام", "DONE": "آماده تحویل", "CANCELLED": "لغو شده"}


@dataclass
class CallState:
    transfer_to: str | None = None  # extension to hand the call to
    end_call: bool = False
    messages_taken: list[dict] = field(default_factory=list)


@dataclass
class CallContext:
    office: Office
    catalog: Catalog
    orders: Orders
    sms: Sms
    caller: str | None = None  # caller ID, normalized; None when withheld
    state: CallState = field(default_factory=CallState)


TOOLS = [
    {
        "name": "find_price",
        "description": (
            "Look up the official translation price of one document type from the office's tariff. "
            "Use for every price question; never state a price from memory. If the result is ambiguous, "
            "ask the caller which of the options they mean. For documents priced per page, pass pages; "
            "for per-line/per-item additions, pass extra_count only if the caller knows it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "document": {"type": "string", "description": "Document name in Persian as the caller said it, e.g. شناسنامه"},
                "pages": {"type": "integer", "minimum": 1, "description": "Number of pages/terms/years, if priced per unit"},
                "extra_count": {"type": "integer", "minimum": 0, "description": "Count of extra lines/items, if known"},
            },
            "required": ["document"],
        },
    },
    {
        "name": "order_status",
        "description": (
            "Check the status of the caller's translation orders. Without tracking_code it looks up orders "
            "registered to the caller's own phone number. Never look up someone else's phone number."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"tracking_code": {"type": "string", "description": "Tracking code, digits only"}},
        },
    },
    {
        "name": "office_info",
        "description": "Office address, opening hours, whether it is open right now, current time, and typical turnaround.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "required_documents",
        "description": "What the customer must bring or prepare (originals, approvals, inquiries) for a given document.",
        "input_schema": {
            "type": "object",
            "properties": {"document": {"type": "string", "description": "Document name in Persian"}},
            "required": ["document"],
        },
    },
    {
        "name": "send_sms",
        "description": (
            "Text the caller (only their own mobile number) an upload link for pre-registration, the office "
            "address, or a short summary of what you told them. Offer this instead of dictating long details."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["upload_link", "address", "summary"]},
                "text": {"type": "string", "description": "For kind=summary: the summary in Persian, under 300 characters"},
            },
            "required": ["kind"],
        },
    },
    {
        "name": "transfer_to_human",
        "description": (
            "Hand the call to a staff member. Use when the caller asks for a person, is upset, or asks something "
            "the tools cannot answer. If it fails (office closed), offer take_message instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"reason": {"type": "string", "description": "One line for the staff member"}},
            "required": ["reason"],
        },
    },
    {
        "name": "take_message",
        "description": "Record a message for the staff to call the customer back.",
        "input_schema": {
            "type": "object",
            "properties": {
                "caller_name": {"type": "string"},
                "message": {"type": "string"},
                "callback_number": {"type": "string", "description": "Only if different from the number they are calling from"},
            },
            "required": ["message"],
        },
    },
    {
        "name": "end_call",
        "description": "Hang up after you have said goodbye and the caller has nothing else to ask.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


async def run_tool(ctx: CallContext, name: str, args: dict) -> str:
    handler = _HANDLERS.get(name)
    if handler is None:
        return _json({"error": f"unknown tool {name}"})
    if not isinstance(args, dict):
        return _json({"error": "tool input must be an object"})
    try:
        return _json(await handler(ctx, args))
    except Exception as exc:  # a failing tool must not end the call
        log.exception("tool %s failed", name)
        return _json({"error": f"{type(exc).__name__}: tool failed; apologise and offer a transfer or a callback"})


def _json(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False)


def _int(value, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(value))
    except (TypeError, ValueError):
        return default


async def _find_price(ctx: CallContext, args: dict) -> dict:
    matches = ctx.catalog.search(str(args.get("document", "")))
    if not matches:
        return {"found": False, "instruction": "No tariff row matches. Ask the caller to describe the document differently, or offer a transfer."}
    document = str(args.get("document", ""))
    best, best_score = matches[0]
    exact = normalize(best.label).replace(" ", "") == ctx.catalog.canonical(document).replace(" ", "")
    # Several rows fit what was said (e.g. «دانشنامه»: Iranian or foreign university) -> ask, don't pick.
    close = [] if exact else [
        item for item, score in matches[1:]
        if not item.addition and (best_score - score < 0.08 or ctx.catalog.contains(item, document))
    ]
    if close:
        return {"found": False, "ambiguous": True, "options": [best.label] + [item.label for item in close[:3]],
                "instruction": "Ask the caller which of these they mean, then call find_price again with the exact name."}

    pages = _int(args.get("pages"), 1, 1)
    extra_count = _int(args.get("extra_count"), 0, 0)
    base, extra = ctx.office.price_of(best)
    base_total = base * pages if best.base_unit else base
    extra_total = (extra or 0) * extra_count
    total = base_total + extra_total

    result = {
        "found": True,
        "document": best.label,
        "total_toman": total,
        "total_spoken": toman_words(total),
    }
    if best.base_unit:
        result["per_unit"] = f"هر {best.base_unit} {toman_words(base)}؛ برای {to_fa_digits(pages)} {best.base_unit} حساب شد"
    if extra:
        counted = f"، {to_fa_digits(extra_count)} مورد حساب شد" if extra_count else "، در قیمت بالا حساب نشده"
        result["extra"] = f"{best.unit}: {toman_words(extra)}{counted}"
    fees = []
    for fee_id in ctx.office.optional_fee_ids:
        fee = ctx.catalog.by_id.get(fee_id)
        if fee:
            fee_base, _ = ctx.office.price_of(fee)
            fees.append({"label": fee.label, "price_spoken": toman_words(fee_base)})
    if fees:
        result["optional_fees"] = fees
    result["note"] = "Official tariff. The exact total is confirmed when the office sees the document."
    return result


async def _order_status(ctx: CallContext, args: dict) -> dict:
    code = str(args.get("tracking_code") or "").strip()
    if code:
        orders = await ctx.orders.find(ctx.office.id, tracking_code=code)
    elif ctx.caller:
        orders = await ctx.orders.find(ctx.office.id, phone=ctx.caller)
    else:
        return {"found": False, "instruction": "Caller ID is hidden. Ask for the tracking code (they can type it on the keypad and press #)."}
    if not orders:
        return {"found": False, "instruction": "No order found. Ask for the tracking code, or offer a transfer."}
    return {"found": True, "orders": [
        {"title": o.get("title"), "status": ORDER_STATUS_FA.get(o.get("status"), o.get("status")), "ready_date": o.get("ready_date")}
        for o in orders[:5]
    ]}


async def _office_info(ctx: CallContext, args: dict) -> dict:
    now = datetime.now(TEHRAN)
    return {
        "name": ctx.office.name,
        "address": ctx.office.address,
        "open_now": ctx.office.is_open(now),
        "now": f"{WEEKDAYS_FA[WEEKDAYS[now.weekday()]]} ساعت {now:%H:%M}",
        "hours": ctx.office.hours_text(),
        "turnaround": ctx.office.turnaround,
        "can_sms_map_link": bool(ctx.office.map_url),
    }


async def _required_documents(ctx: CallContext, args: dict) -> dict:
    query = normalize(str(args.get("document", "")))
    best, best_overlap = None, 0.0
    q_tokens = set(query.split())
    for key, text in ctx.office.required_documents.items():
        key_norm = normalize(key)
        overlap = len(q_tokens & set(key_norm.split())) / max(1, len(q_tokens))
        if key_norm in query or query in key_norm:
            overlap += 1
        if overlap > best_overlap:
            best, best_overlap = (key, text), overlap
    if best and best_overlap >= 0.5:
        return {"found": True, "document": best[0], "requirements": best[1]}
    return {"found": False, "instruction": "This office has no checklist for that document. Do not guess requirements; offer a transfer or a callback."}


async def _send_sms(ctx: CallContext, args: dict) -> dict:
    if not is_mobile(ctx.caller):
        return {"sent": False, "reason": "The caller is not on a mobile number, so SMS is not possible."}
    office = ctx.office
    kind = args.get("kind")
    if kind == "upload_link":
        if not office.upload_url:
            return {"sent": False, "reason": "This office has no upload link configured."}
        text = f"{office.name}\nبرای ثبت سفارش، تصویر مدارک را اینجا بارگذاری کنید:\n{office.upload_url}"
    elif kind == "address":
        text = f"{office.name}\n{office.address}" + (f"\n{office.map_url}" if office.map_url else "")
    elif kind == "summary":
        summary = str(args.get("text") or "").strip()[:300]
        if not summary:
            return {"sent": False, "reason": "Empty summary."}
        text = f"{office.name}\n{summary}"
    else:
        return {"sent": False, "reason": f"Unknown kind {kind!r}."}
    await ctx.sms.send(normalize_phone(ctx.caller), text)
    return {"sent": True}


async def _transfer_to_human(ctx: CallContext, args: dict) -> dict:
    if not ctx.office.human_extension:
        return {"transferring": False, "reason": "No staff line configured. Offer take_message."}
    if not ctx.office.is_open():
        return {"transferring": False, "reason": "The office is closed now. Offer take_message and say when it opens."}
    ctx.state.transfer_to = ctx.office.human_extension
    log.info("transfer requested: %s", args.get("reason"))
    return {"transferring": True, "instruction": "Say one short line that you are connecting them; the call transfers when you finish speaking."}


async def _take_message(ctx: CallContext, args: dict) -> dict:
    message = {
        "caller_name": str(args.get("caller_name") or "").strip(),
        "message": str(args.get("message") or "").strip(),
        "callback_number": normalize_phone(args.get("callback_number")) or ctx.caller,
    }
    ctx.state.messages_taken.append(message)
    if ctx.office.staff_mobile:
        text = f"پیام تماس ({message['callback_number'] or 'شماره نامشخص'})"
        if message["caller_name"]:
            text += f" - {message['caller_name']}"
        await ctx.sms.send(ctx.office.staff_mobile, f"{text}:\n{message['message']}")
    return {"recorded": True, "has_callback_number": bool(message["callback_number"])}


async def _end_call(ctx: CallContext, args: dict) -> dict:
    ctx.state.end_call = True
    return {"ending": True}


_HANDLERS = {
    "find_price": _find_price,
    "order_status": _order_status,
    "office_info": _office_info,
    "required_documents": _required_documents,
    "send_sms": _send_sms,
    "transfer_to_human": _transfer_to_human,
    "take_message": _take_message,
    "end_call": _end_call,
}
