import json

from deept_agent.tools import run_tool

from .fakes import make_ctx


async def call(ctx, name, args=None):
    return json.loads(await run_tool(ctx, name, args or {}))


async def test_find_price_flat_and_per_page():
    ctx = make_ctx()
    result = await call(ctx, "find_price", {"document": "شناسنامه"})
    assert result["found"] and result["total_toman"] == 171360
    assert result["total_spoken"] == "صد و هفتاد و یک هزار و سیصد و شصت تومان"
    assert result["optional_fees"][0]["label"] == "تمبر دادگستری"

    # سند طلاق: priced per page, plus per line.
    result = await call(ctx, "find_price", {"document": "سند طلاق (دفترچه) (هر صفحه)", "pages": 3, "extra_count": 2})
    assert result["total_toman"] == 550800 * 3 + 20000 * 2


async def test_find_price_uses_office_overrides():
    ctx = make_ctx(price_overrides={"9": {"base": 200000}})
    assert (await call(ctx, "find_price", {"document": "شناسنامه"}))["total_toman"] == 200000


async def test_find_price_asks_when_ambiguous():
    result = await call(make_ctx(), "find_price", {"document": "دانشنامه"})
    assert result.get("ambiguous") and len(result["options"]) >= 2


async def test_order_status_by_caller_id_and_code_only():
    ctx = make_ctx(caller="+98 912 123 4567")
    ctx.caller = "09121234567"
    result = await call(ctx, "order_status")
    assert {o["status"] for o in result["orders"]} == {"آماده تحویل", "در حال انجام"}

    result = await call(make_ctx(caller=None), "order_status")
    assert not result["found"] and "tracking code" in result["instruction"]

    result = await call(make_ctx(caller=None), "order_status", {"tracking_code": "۴۰۳۰۱"})
    assert result["orders"][0]["title"] == "ترجمه سند ازدواج"


async def test_sms_goes_only_to_the_callers_mobile():
    ctx = make_ctx()
    assert (await call(ctx, "send_sms", {"kind": "upload_link"}))["sent"]
    assert ctx.sms.sent[0][0] == "09121234567" and "deept.ir/upload/test" in ctx.sms.sent[0][1]

    landline = make_ctx(caller="02188001234")
    assert not (await call(landline, "send_sms", {"kind": "address"}))["sent"]
    assert landline.sms.sent == []


async def test_transfer_only_when_open():
    ctx = make_ctx()
    assert (await call(ctx, "transfer_to_human", {"reason": "wants a person"}))["transferring"]
    assert ctx.state.transfer_to == "101"

    closed = make_ctx(hours={})
    assert not (await call(closed, "transfer_to_human", {"reason": "x"}))["transferring"]
    assert closed.state.transfer_to is None


async def test_take_message_texts_the_staff():
    ctx = make_ctx()
    await call(ctx, "take_message", {"caller_name": "رضایی", "message": "لطفاً تماس بگیرید"})
    to, body = ctx.sms.sent[0]
    assert to == "09120000000" and "09121234567" in body and "رضایی" in body


async def test_required_documents_and_unknown_tool():
    ctx = make_ctx()
    assert (await call(ctx, "required_documents", {"document": "کارت ملی"}))["found"]
    assert not (await call(ctx, "required_documents", {"document": "سند مالکیت"}))["found"]
    assert "error" in await call(ctx, "no_such_tool")


async def test_end_call_sets_state():
    ctx = make_ctx()
    await call(ctx, "end_call")
    assert ctx.state.end_call
