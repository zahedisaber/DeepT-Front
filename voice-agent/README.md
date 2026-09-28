# DeepT voice receptionist (prototype)

An AI receptionist that answers a translation office's phone calls in Persian:
it quotes official tariff prices, checks order status, explains what documents
to bring, texts upload links, takes messages, and transfers to a person.

One server answers for many offices. The dialed number picks the office, and
each office has its own prices, hours, staff line and FAQ.

```
Caller ─► office line ─► FXO gateway ─► Asterisk ──AudioSocket──► phone server
                                          ▲  │                       │
                          transfer ◄──────┘  └─ rings staff first    ├─ speech-to-text (OpenAI)
                                                                     ├─ Claude + tools ─► price-catalog.js, orders, SMS
                                                                     └─ text-to-speech (OpenAI)
```

## What's in here

| Path | What it does |
|---|---|
| `deept_agent/catalog.py` | Reads the official tariff straight from `../price-catalog.js`, fuzzy search in Persian |
| `deept_agent/office.py` | Office settings from `offices/*.yaml`: numbers, hours (Tehran time), price overrides |
| `deept_agent/tools.py` | The agent's tools: `find_price`, `order_status`, `office_info`, `required_documents`, `send_sms`, `transfer_to_human`, `take_message`, `end_call` |
| `deept_agent/prompt.py` | Receptionist instructions (tone, brevity, never guess prices, AI-disclosure rules) |
| `deept_agent/brain.py` | Claude conversation loop; streams replies sentence by sentence |
| `deept_agent/persian.py` | Persian normalization, numbers → words for speech |
| `deept_agent/speech.py` | Speech-to-text / text-to-speech (OpenAI), 8 kHz phone audio helpers |
| `deept_agent/phone/` | Asterisk AudioSocket server: voice detection, barge-in, keypad codes, transfer |
| `deept_agent/console.py` | Type to the agent, to test its answers without a phone |
| `asterisk/` | Sample Asterisk config: softphone test, "ring staff first, then the agent" |
| `offices/` | Sample office and sample orders |

## 1. Try the agent by typing (5 minutes)

Needs Python 3.11+ and a Claude API key.

```bash
cd voice-agent
pip install -r requirements-dev.txt
export ANTHROPIC_API_KEY=sk-ant-...
python -m deept_agent.console --show-speech
```

Try: «قیمت ترجمه شناسنامه چنده؟», «سفارشم آماده‌ست؟», «آدرستون کجاست؟»,
«شما آدمید یا ربات؟», «می‌خوام با یه نفر صحبت کنم».
`--caller ''` simulates a hidden caller ID; `--caller 02188001234` a landline (no SMS).

## 2. Take real phone calls

1. **Asterisk 18+** on a small office PC or an Iranian VPS (Issabel/FreePBX work
   too), with `app_audiosocket` and `func_curl` loaded. Merge
   `asterisk/pjsip.conf` and `asterisk/extensions.conf`, and change the passwords.
2. **The phone server** on the same machine, or reachable over a VPN (WireGuard):
   ```bash
   export ANTHROPIC_API_KEY=... OPENAI_API_KEY=...
   python -m deept_agent.phone.server
   ```
   It listens for AudioSocket on `:9092` and for the dialplan on `127.0.0.1:8090`.
3. **Test with a softphone:** install Zoiper on your mobile, register as `1001`,
   and dial `5000` (the sample office's test number). With `HUMAN_RING_SECONDS=0`
   the agent answers straight away. Register a second softphone as `101` to
   receive transfers.
4. **Real lines:** connect an FXO gateway (Grandstream GXW410x/HT813, Yeastar,
   Dinstar) to the office's landlines. Point it at Asterisk (the commented
   `fxo-gateway` block in `pjsip.conf`) and have it send the office number as
   the called number. Mobile numbers: set call forwarding (busy / no answer /
   unreachable) to the office landline.

During a call:
- **Barge-in:** if the caller talks over the agent, it stops speaking.
- **Keypad entry:** callers can type a tracking code on the keypad and press `#`.
- **Idle timeout:** after 25 s of silence the agent says goodbye and hangs up.
- **Transfer:** the agent hangs up its side and Asterisk dials the staff extension.

## Adding an office

Copy `offices/sample.yaml`, then change:
- `id` and `phone_numbers`
- `hours`
- `human_extension` and `staff_mobile`
- `required_documents` (the sample text there is only an example)
- `price_overrides`, using the same catalog ids as «نرخنامه من».

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Claude |
| `DEEPT_AGENT_MODEL` | `claude-haiku-4-5` | Fast and cheap for live calls; try `claude-sonnet-5` for harder conversations |
| `OPENAI_API_KEY` | | Speech-to-text and text-to-speech |
| `DEEPT_STT_MODEL` / `DEEPT_TTS_MODEL` / `DEEPT_TTS_VOICE` | `gpt-4o-mini-transcribe` / `gpt-4o-mini-tts` / `coral` | |
| `DEEPT_OFFICES_DIR` | `offices/` | |
| `DEEPT_ORDERS_FILE` | `offices/orders.json` | Sample orders until DeepT-Core has an agent endpoint |
| `DEEPT_DEFAULT_OFFICE` | | Office used when the dialed number matches none |
| `KAVENEGAR_API_KEY` + `KAVENEGAR_SENDER` | | Real SMS; without them, SMS are only logged |
| `AUDIOSOCKET_HOST/PORT`, `CONTROL_HOST/PORT` | `0.0.0.0:9092`, `127.0.0.1:8090` | Keep the control port private; it has no authentication |

## Tests

```bash
python -m pytest
```

The tests run offline, using stand-ins for Claude and the speech services. One
of them is a full simulated call over AudioSocket: greeting, caller speech,
tool call, reply, transfer.

## Not done yet (prototype limits)

- **Order status reads `offices/orders.json`.** DeepT-Core needs an endpoint the agent can call
  (look up by tracking code, or by the caller's phone number) to replace `JsonOrders`.
- **Kavenegar SMS** is written against their public API but has not been tried with a live account.
- **Voice detection is energy-based.** It is fine on a quiet line. A model-based detector (e.g. Silero)
  would handle noisy offices and line echo better.
- **Each sentence is synthesized in one piece.** Streaming TTS would cut about 0.3–0.5 s from each reply.
- **Persian speech quality needs testing on real 8 kHz calls,** both recognition and the TTS voice.
  Try other providers through the `SpeechToText` / `TextToSpeech` interfaces in `speech.py`.
- **Not built yet:** Telegram bot and userbot, and WhatsApp.
- **Before going live:** tell callers they may be recorded (if you store audio or transcripts), and
  check that your AI provider's terms allow how the greeting presents the agent.
