# Routing the office landline (تلفن ثابت) to the منشی هوشمند

How a call to a translation office's ordinary Iranian landline reaches a
realtime AI voice agent, and back to a human when needed. Companion to
`receptionist.js` (front end: settings, call log, request inbox), whose
header defines the API contract the telephony side must implement.

> Status: design. Nothing here is deployed. Items marked **verify** are
> facts that change by city, exchange or provider. Confirm them with
> مخابرات and the chosen vendor before building on them.

---

## 1. The problem in one picture

```
 Caller ──PSTN──▶ office landline (TCI/مخابرات, analog)
                        │
                        ▼            ← the missing piece: get the call into SIP
                 SIP / RTP (Asterisk or Issabel)
                        │
                        ▼
          AI bridge  ◀─audio─▶  STT (fa) → agent logic → TTS (fa)
                        │
                        └──▶ POST /receptionist/calls → DeepT-Core → «تماس‌ها» / «درخواست‌ها»
```

Office landlines in Iran are almost always analog lines from مخابرات,
often behind a small analog سانترال (key system, e.g. Panasonic KX-TES/TEM).
Neither speaks SIP, so step one is always a way to turn the call into SIP.
There are three ways to do that.

---

## 2. Getting the call into SIP: three options

### Option A: FXO gateway at the office (recommended first step)

Plug the existing landline (or the سانترال's trunk port) into an **FXO
gateway**: Grandstream HT813 (1 line) or GXW410x (4/8 lines), OpenVox,
Yeastar TA, or a DAHDI FXO card in a PC. The gateway registers as a SIP
trunk to Asterisk/Issabel (on-premises mini PC, or a VPS in an Iranian
data center).

- ✅ Same number, no paperwork with مخابرات, works today.
- ✅ Caller ID (شماره تماس‌گیرنده) is read by the gateway, so the AI sees who is calling. **Verify** your line has caller ID enabled and set the gateway's CID detection to match.
- ✅ Humans keep answering as before, and the PBX decides when the AI picks up (§3).
- ⚠️ One concurrent call per physical line. Each extra line needs a gateway port.
- ⚠️ Depends on the office internet if the PBX/AI is in the cloud. Run a local Asterisk so a dropped link falls back to ringing the office phones.
- ⚠️ 8 kHz narrowband audio. Choose STT models that cope with telephone audio.

Issabel is widely used by Iranian installers, so local support is easy to
find. Plain Asterisk 18+ also works and is what the AI bridge talks to.

### Option B: forwarding (دایورت / انتقال مکالمه) to a VoIP number

Rent a geographic or virtual number with a SIP trunk from a licensed
Iranian VoIP provider, and forward the landline to it with the TCI
service code:

| Action | Code (tone mode) |
|---|---|
| Forward all calls | `*21*<destination>#` |
| Cancel | `#21#` |

Some guides say the destination needs its area code (`*21*021xxxxxxxx#`).
Conditional forwarding (busy / no answer) codes vary by exchange: **verify** with مخابرات.

- ✅ No hardware at the office. The AI sits fully in the cloud.
- ⚠️ The forwarded leg is billed to the office line.
- ⚠️ Unconditional forwarding means the office phones stop ringing. "Humans first, AI on overflow" then has to happen inside the cloud PBX (it can ring staff mobiles or a softphone first).
- ⚠️ The caller ID that reaches the VoIP number after forwarding may be the office's own number rather than the caller's. **Verify** with a test call before relying on it for lead capture.
- ⚠️ Forwarding codes are a known way to hijack calls. Lock the line with مخابرات's PIN service if available, and check the forwarding state after any technician visit.

### Option C: move the office onto an IP PBX

If the office replaces its analog سانترال with Issabel/Asterisk (IP phones
plus FXO ports for the مخابرات lines, or a SIP trunk from a provider), the
AI is just another extension or queue member. This is the same as option
A with more of the office on IP. It is the right end state for multi-line
offices.

### Which one?

| | A: FXO gateway | B: forwarding | C: IP PBX |
|---|---|---|---|
| Keeps number | yes | yes | yes |
| Office hardware | small box (~1 line/port) | none | PBX + phones |
| Humans ring first | easy | only via cloud ring groups | easy |
| Caller ID to AI | yes | **verify** | yes |
| Per-call cost | none extra | forwarded leg billed | none extra |
| Best for | pilot, 1–4 lines | no on-site access | larger offices |

**Pilot with A** on one office (one HT813 and a local Asterisk box).

---

## 3. Who answers when: the routing policy

The receptionist settings page stores a routing policy (`config.routing`,
sent as `office.routing` to the backend):

| `mode` | Behavior |
|---|---|
| `after_hours` | Ring office phones during office hours. Outside the hours in settings, the AI answers immediately. |
| `no_answer` | Ring office phones for `ring_seconds`. If nobody picks up, or all lines are busy, the AI answers. Outside hours the AI answers immediately. |
| `always` | The AI answers every call and transfers to a human on request. |

`transfer_to` is the extension or mobile the AI dials when the caller asks
for a person («با مترجم صحبت کنم») or when the agent is unsure.

Dialplan sketch (Asterisk, `extensions.conf`). The office hours check is
done by the bridge, which reads the same settings, so there is only one
source of truth:

```ini
[from-landline]
exten => s,1,NoOp(Incoming from ${CALLERID(num)})
 same => n,Set(MODE=${CURL(http://127.0.0.1:8088/route?cid=${CALLERID(num)})})  ; "ai" | "ring"
 same => n,GotoIf($["${MODE}" = "ai"]?ai)
 same => n,Dial(PJSIP/office-phones,${RING_SECONDS})      ; humans first
 same => n,GotoIf($["${DIALSTATUS}" = "ANSWER"]?done)
 same => n(ai),Stasis(deept-receptionist)                 ; hand to the AI bridge
 same => n,GotoIf($["${STASISSTATUS}" = "SUCCESS"]?done)
 same => n,Dial(PJSIP/office-phones,60)                   ; bridge down → never drop the call
 same => n,VoiceMail(100@office)
 same => n(done),Hangup()
```

The two fallback lines matter: if the AI server is unreachable, the call
still rings the office and ends in voicemail. A caller must never hear
dead air.

---

## 4. Realtime media: Asterisk ↔ AI bridge

Use **ARI** (Stasis app) for call control and **ExternalMedia** for audio:
the bridge puts the caller and an ExternalMedia channel in a mixing bridge
and receives/sends raw audio. AudioSocket (Asterisk 18+) is a simpler
alternative over TCP. ExternalMedia/RTP gives lower latency, AudioSocket
crosses NAT more easily. Either is fine for one office.

```
Asterisk ──ARI websocket──▶ bridge (Node or Python)
   ▲  │                        │
   │  └─ExternalMedia RTP/slin─▶ VAD (Silero) ─▶ streaming STT (fa)
   │                              │
   │                       agent: receptionist engine + optional LLM
   │                              │
   └──────── RTP ◀── streaming TTS (fa) ◀──────┘
```

Turn-taking requirements (these decide whether callers think it is good):

- **Latency budget ≈ 1–1.5 s** from end of caller speech to first audio: VAD end-of-turn ~300 ms, final STT ~300 ms, agent ~300–500 ms, first TTS chunk ~200 ms. Stream the TTS sentence by sentence and don't wait for the full reply.
- **Barge-in:** when VAD hears the caller during TTS playback, stop playback at once and listen.
- **Filler on slow turns:** if the agent takes more than ~1.2 s, play a short «یک لحظه…».
- **Audio:** 8 kHz μ-law/slin from the line. Resample to what the STT expects, and back for TTS.
- **DTMF:** accept keypad input as a fallback for the mobile number («شماره را با صفحه‌کلید وارد کنید») when STT confidence on digits is low.

### Agent logic: reuse, don't fork

The local engine in `receptionist.js` (price quotes from نرخنامه, hours,
requirements, intake flow, spoken-number parsing `rcpSpokenDigits`) has
no DOM dependency in its core. It already runs under Node in tests
(load `price-catalog.js` + `receptionist.js` into a `vm` context). The
bridge should run that same engine per call, so phone and chat give
identical prices and capture identical leads. Next refactor: split the
engine into `receptionist-engine.js` (shared) and keep only the UI in
`receptionist.js`.

An LLM, if used, only rephrases and handles free-form questions, with the
engine's computed answer passed as grounding (contract: `POST
/receptionist/reply`). It must never be the source of a price.

Phone-specific behavior on top of chat:

- Shorter spoken replies: give the total, then offer the breakdown («جزئیات را بگویم؟»).
- Read prices as words; TTS engines often misread `۴۷۷٬۳۶۰`.
- Repeat the captured mobile number back digit by digit for confirmation.
- Prefill the phone number from caller ID and just confirm it («با همین شماره‌ای که تماس گرفتید هماهنگ کنیم؟»).
- Transfer: ARI `redirect`/`continue` to `transfer_to` when asked, or after two failed understandings in a row.

---

## 5. Choosing STT / TTS / LLM providers: the Iran constraint

This decides the architecture more than anything else.

- **Many foreign AI APIs do not serve customers in Iran** (sanctions and provider terms). Anthropic, OpenAI, Google Cloud and Azure all restrict it, and the same is likely for foreign Persian-speech vendors (Soniox, Deepgram, Speechmatics, AssemblyAI advertise Persian, but **verify** whether they can contract with an Iran-based customer). Don't design around VPNs or third-party resellers to reach them: that breaches the provider terms, puts the office's call data at risk, and can be cut off at any time.
- **Practical options:**
  1. **Iranian Persian speech providers** (e.g. the ASR/TTS services from Part AI / پارت and similar domestic vendors). **Verify** current streaming APIs, telephone-audio quality, latency and pricing.
  2. **Self-hosted open models** in an Iranian data center or on an office GPU box: a Whisper-family or Persian-fine-tuned streaming ASR (open Persian fine-tunes exist), a Persian TTS trained on open corpora such as ParsVoice (Coqui/Piper-style), and an open-weight LLM served with vLLM. The LLM is optional: the local engine already covers the core receptionist job.
- **Data residency:** callers give names, phone numbers and document details. Keeping STT/TTS/LLM inside Iran also keeps that data inside Iran.

Recommended pilot: domestic or self-hosted STT and TTS + the deterministic
engine, with **no LLM**. Add an LLM later only for free-form questions,
and only if quality falls short.

---

## 6. Compliance and operations

- **Recording / AI disclosure:** say at the start that the caller is talking to an automated assistant, and that the call is recorded if it is («این تماس برای پیگیری سفارش ثبت می‌شود»). Get local legal advice on recording rules.
- **Licensing:** running a PBX on the office's own lines is normal. Reselling telephony or terminating other people's traffic needs a CRA (رگولاتوری) license. Stay on the "own office" side.
- **Retention:** keep transcripts as long as the lead needs them, then delete. Don't keep audio by default.
- **Monitoring:** alert on bridge-down (the dialplan fallback hides outages from callers, so watch the logs), STT error spikes, and transfer rate.

---

## 7. Rollout plan

1. **Lab:** Asterisk + softphone + bridge + chosen STT/TTS. Measure latency and run the scripted calls from the browser test (prices, hours, intake, spoken numbers).
2. **Pilot office, after hours only:** HT813 on one landline, `mode: after_hours`. Staff review every call in «تماس‌ها» the next morning.
3. **Overflow:** switch to `no_answer` (e.g. 20 s). Track answered-by-AI, orders, transfers, hang-ups.
4. **Scale:** more lines, multi-office tenancy in DeepT-Core (each office's settings, نرخنامه and inbox), then option C for offices replacing their سانترال.

## 8. Backend endpoints (DeepT-Core)

Defined in `receptionist.js`:

- `POST /receptionist/reply`: one agent turn (message, history, office settings incl. `routing`, grounding) → `{reply}`.
- `POST /receptionist/calls`: the bridge reports a finished call (`started_at, seconds, caller_number, lead, transcript, transferred_to`).
- `GET /receptionist/calls`: the front end lists line calls next to browser calls.

Needed in addition for the phone line:

- `GET /receptionist/route?cid=…` → `"ai" | "ring"` plus `ring_seconds`, computed from `routing` and office hours (used by the dialplan above).
- Settings and leads stored server-side (today they are in the browser's localStorage), so the bridge reads the same configuration and files leads into the same inbox.
