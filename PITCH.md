# Dubhashi: talk in your language, they hear theirs

**Live app:** https://dubhashi.onrender.com · **Demo video:** _add link_ · **Code:** https://github.com/crypticsaiyan/dubhashi

## The problem

India has 45 crore internal migrants (Census 2011), and only about 1 in 10 Indians can speak English. In a 2026 survey of 1,824 interstate migrant workers in South India, 81% reported communication difficulties with landlords, employers and offices (IIMAD). In hospitals it is dangerous: 53% of emergency clinicians in an Indian study had seen a critical incident in one year where poor communication played a part (Int J Emerg Med, 2021).

## The solution

Dubhashi is a live interpreter for two people who share no language. Each person opens one link on their own phone, picks their language, and holds a button to talk. The other person hears it in their language, **in the speaker's own cloned voice**, in about 2 seconds. No app to install, 10 Indian languages.

## How it uses Gnani AI

| Gnani model | Role |
| --- | --- |
| **Prisma v3.0** (realtime STT) | One streaming socket per button press; transcript returns about 0.5 s after release |
| **Timbre v3.0** (TTS) | Streams the translation so audio starts in about 0.3 s |
| **Voice cloning** (vachana-vc-v1) | A 15 second sample, recorded with consent, lets a Hindi speaker's voice speak Kannada or Tamil |

An open-weights LLM (Gemma 4 31B) translates between them.

## What makes it more than a translator

- **Respect-aware.** You choose who you are talking to (doctor, elder, employer or landlord, friend), and the translation uses the right level of politeness in each direction.
- **Numbers are protected.** Plain code, not AI, compares every number across scripts. If money, a dose or a date is involved, the speaker confirms the read-back before the other person hears anything.
- **You see what they heard.** A separate back-translation shows the speaker what actually arrived.
- **A summary for each side**, in each person's own language, on screen and spoken.
- **Built for real phones:** type instead of talking, video call with live captions (relayed through the server when mobile networks block direct links), rejoin after a reload.

## Built to work, and tested

- Designed around the real API limits: hold-to-talk because Prisma has no partial transcripts, and a per-key queue because free keys allow one request at a time.
- Live test across all 10 languages, spoken and typed, both voices, four relationships: **20/20 passed, median 1.7 s** from release to first audio.
- 68 automated tests, plus browser tests of 30 screen layouts and the failure paths.

**Built by:** Rahul Joshi
