# Dubhashi

A live interpreter for two people who share no language. Each person talks in their own language and the other hears it in theirs, in up to ten languages, optionally in the speaker's own cloned voice.

Built for the Great Indian AI Internship Challenge on Gnani AI's speech models.

## How a turn works

```
Hold to talk
  Browser mic, 16 kHz PCM, over WebSocket
  Prisma v3.0 realtime STT, closed on release with a commit frame
  Open-weights LLM: translate, keep register, extract critical facts
  Number guard and confirmation, when a dose or amount is at stake
  Timbre v3.0 or a cloned voice, streamed over SSE
  Listener's browser, while a back-translation returns to the speaker
```

## What it does beyond translating

| Feature | Why it matters |
| --- | --- |
| Respect-aware translation | "Talking to" sets the register for each direction, so a patient and a doctor are not addressed the same way |
| Conversation memory | The last turns go to the translator, so pronouns resolve correctly |
| Critical-fact check | Doses, amounts and dates are read back to the speaker before the listener hears them |
| Number guard | A plain code check compares numbers across scripts, so a changed number is stopped even if the LLM reports nothing |
| Back-translation | The speaker sees what the listener received, translated without access to the original |
| Own voice | A 5 to 30 second sample creates a voice profile, used only with consent |
| Bilingual summary | After the call, each person gets key points and next steps in their language, on screen and spoken |
| Latency panel | STT, LLM and TTS time for every turn |
| Video call | Optional peer-to-peer camera, with the latest translation shown as a caption over the face |
| Type instead | A typed turn takes the same path minus STT, for noisy wards, hearing loss, or a word STT keeps missing |
| Rejoin after reload | Phones often reload a tab after switching apps. The call and transcript come back with one tap |
| Replay | Any turn heard can be played again |
| Phone friendly | Screen stays awake during a call, installable to the home screen, light and dark themes |

## Design decisions

- **Hold to talk, one speaker at a time.** Prisma does not expose partial transcripts, and free tier keys allow one active request. Turn-taking fits both and also prevents echo, because the mic is only sent while held.
- **One STT socket per press.** This avoids the 15 minute session limit and idle timeouts. Audio is buffered until the socket opens, then drained at twice real time.
- **One queue per API key.** Every room shares a serial queue for TTS and voice calls, with backoff on `429`.
- **Providers behind interfaces.** `MOCK_AI=1` swaps in fake speech and translation, so the whole app can be tested without keys. The UI shows a banner in this mode.
- **Video carries no sound.** WebRTC sends only the camera. Voices always go through the interpreter, so nobody hears the original and the translation on top of each other. The server only relays signalling; media goes phone to phone.
- **Open-weights LLM.** Evon v3.3 is not on the API platform, and the Gnani team advised using any open-weights LLM. Any OpenAI-compatible endpoint works. The default is Gemma 4 31B through OpenRouter: in side-by-side runs gpt-oss-120b moved a Malayalam "not on an empty stomach" into the wrong meaning and turned "twice a day" into "day 2", while Gemma kept both.

## Run it

Requires Node 22 or newer and pnpm.

```sh
pnpm install
cp .env.example .env   # add GNANI_API_KEY and LLM_API_KEY
pnpm build
pnpm start             # http://localhost:8787
```

Without keys:

```sh
pnpm build
MOCK_AI=1 pnpm start
```

For development, run `pnpm dev:server` (or `pnpm dev:mock`) with `pnpm dev:web`, then open http://localhost:5173.

Browsers only allow the microphone and camera on `localhost` or HTTPS, so testing with real phones needs an HTTPS deployment or tunnel. Set `ALLOWED_ORIGINS` to your site's origin in production.

## Deploy

The app is one Node process holding calls in memory, so it needs a host with WebSockets and a single always-on instance. `render.yaml` sets this up on Render:

1. In the Render dashboard choose **New > Blueprint** and pick this repository.
2. Enter `GNANI_API_KEY` and `LLM_API_KEY` when asked, then apply.
3. Once it is live, add `ALLOWED_ORIGINS=https://<your-service>.onrender.com` so only your own page can open calls.

The `Dockerfile` works on any other container host. Set `CLIENT_IP_HEADER` to whatever header your proxy fills with the visitor's IP, so rate limits apply per person.

On Render's free plan the service sleeps after 15 idle minutes and takes about a minute to wake.

## Test it

```sh
pnpm typecheck
pnpm test                          # units, fake Prisma socket, two-person call over real WebSockets
MOCK_AI=1 pnpm start               # then, in a second terminal:
pnpm exec tsx scripts/e2e.ts       # full call in two Chrome tabs with a fake microphone

pnpm test:ui                       # 10 languages x 3 screen sizes x light/dark, plus failure paths

pnpm smoke                         # live APIs: STT per language, cross-language cloning, translation
pnpm eval                          # 30 scripted turns, written to eval/results.csv
pnpm test:live                     # every language speaks and listens through the real server
pnpm test:live-browser             # real speech through Chrome's mic into live Prisma
```

| Suite | What it proves | Last result |
| --- | --- | --- |
| `test:ui` | No sideways scroll, clipped or untranslated label in any of 10 languages on 320 px, 390 px and desktop, light and dark. Unknown code, full room, refused mic or camera, peer dropping off, space bar to talk, blank and oversized typed turns | 30/30 layouts, 7/7 failure paths |
| `test:live` | Each language as speaker (spoken) and listener (typed), both genders, all four relationships, a cloned voice. Checks target script, numbers kept, back-translation, summaries and spoken summary. The listener's audio is run back through Prisma to confirm it is intelligible | 20/20 turns, p50 1.7 s release to first audio |
| `test:live-browser` | The browser mic worklet and playback with real Prisma, Timbre and LLM | 3/3, 1.6 to 2.0 s |

Reading the `test:live` output also caught three translation faults that every automatic check passed: a statement turned into a question, an endearment the speaker never said, and an over-familiar pronoun. The prompt now fixes sentence type and forbids added forms of address; `eval/matrix.csv` holds the rerun.

`pnpm eval` uses clean Timbre audio, so it measures latency and number handling, not real microphone accuracy. Naturalness and respect need ratings from native speakers, and the CSV has blank columns for them.

## Limits

- An assistive tool, not a replacement for a trained medical interpreter.
- Interface labels in Indian languages have not been reviewed by native speakers yet.
- Video uses public STUN by default. Some mobile networks block direct connections and need a TURN relay, set through `ICE_SERVERS`. Voice works either way.
- Rooms and voice profiles live in memory, so a restart ends all calls. Recordings are never stored, and voice profiles expire within an hour.
- All demo content must use synthetic data, with consent from anyone whose voice is cloned.
