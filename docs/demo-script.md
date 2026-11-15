# Dubhashi demo video script

**Story:** you have just moved to Bengaluru. You speak Hindi and English. The people around you speak Kannada. Phone A is yours; phone B plays the other person and is set to Kannada. You never speak or read Kannada; the app does that.

**Length:** about 2:40, which suits the submission (the Gnani team said 2 to 3 minutes is best). The 60 second cut for the post is at the end.

**Stat images:** `docs/stats/stat-1.png` to `stat-4.png`, and `stats-16x9.png`.

---

## Scene 1. Hook (0:00 to 0:06)

**Shot:** medium close-up of you, phone in hand, a plain wall or window behind you. Natural light from the front.

**You (Hindi, to camera, slight pause before the last word):**
> "नए शहर में सबसे मुश्किल काम क्या है? किराया नहीं, नौकरी नहीं... **बात करना।**"

**Subtitle:** *What's the hardest part of moving to a new city? Not rent. Not work. Talking.*

**Edit:** hard cut on "बात करना" to Scene 2. No music yet.

---

## Scene 2. The problem (0:06 to 0:30)

**Shot:** each stat card on screen for about 5 seconds, with a slow push-in. If you have B-roll (a railway station, a bus stop, a construction site, a shop counter), lay it at 30% opacity behind the cards, or cut to 1 second of it between cards.

**Music:** starts here. Soft, low, royalty-free (YouTube Audio Library). Keep it 20 dB under your voice.

**You (English voiceover):**

| Card | Voiceover |
| --- | --- |
| `stat-1.png` (45 crore) | "Forty-five crore Indians have moved away from where they were born." |
| `stat-2.png` (1 in 10) | "Only one in ten of us can speak English." |
| `stat-3.png` (81%) | "In a 2026 survey of migrant workers in South India, 81% said communication is their struggle: with landlords, with employers, with offices." |
| `stat-4.png` (53%) | "And sometimes it's dangerous. Half the emergency clinicians in one Indian study had seen a critical incident in a single year where poor communication played a part." |

**Edit:** end on `stats-16x9.png` showing all four numbers, for 2 seconds.

---

## Scene 3. The solution (0:30 to 0:40)

**Shot:** top-down view of both phones on a table, the Dubhashi start screen on phone A ("Talk in your language. They hear theirs.").

**You (Hindi, then English, to camera or as voiceover):**
> "इसलिए मैंने बनाया **Dubhashi**।"
> "A live interpreter for two people who share no language. You speak yours. They hear theirs. In your own voice."

**On screen:** the Dubhashi logo and "10 Indian languages · No app to install".

---

## Scene 4. Setup (0:40 to 0:55)

**Shot:** screen recording of phone A, sped up 2x where marked, with a small "2x" label in the corner.

**Phone A:**
1. Name: your name.
2. **I speak:** हिन्दी Hindi.
3. **Talking to:** Employer or landlord.
4. Turn on **Speak in my own voice**. Read the prompt aloud (about 15 seconds, sped up 2x). Tap **Finish**.
5. **Start call** → **Share link**.

**Phone B:** opens the link, **I speak:** ಕನ್ನಡ Kannada, **Join call**. Both phones show **Connected**.

**You (voiceover):**
> "No app, no sign-up. I record fifteen seconds of my voice, share one link, and the other person picks their own language."

**On screen during step 4:** "My own voice, recorded with my consent."

---

## Scene 5. Call 1: Hindi to Kannada, with a landlord (0:55 to 1:30)

**Shot:** top-down view of both phones, filmed with a third phone so the translated voice is heard in the room. Cut to a screen recording for the close-ups.

### Turn 1: the rent

**You (hold the button and speak):**
> "नमस्ते भैया, मैं कमरा देखने आया हूँ। किराया 8,000 रुपये महीना है ना?"

**Subtitle:** *Hello, I've come to see the room. The rent is 8,000 rupees a month, right?*

1. Phone A shows the steps **Hear → Translate → Speak**, then the **Is this correct?** card with "8,000" read back. Tap **Yes**.
   **On screen:** "Numbers are read back before the other person hears them."
2. Phone B speaks it in Kannada, **in your voice**.
   **Subtitle on the Kannada:** take it from the **They heard** line on phone A (see Scene 5 checks).
3. **You (to camera, smiling):**
   > "मुझे कन्नड़ नहीं आती... पर मेरी आवाज़ को आती है।"

   **Subtitle:** *I don't speak Kannada... but my voice does.*

### Turn 2: the details

**You (hold and speak):**
> "Advance कितना देना होगा? और बिजली का बिल किराए में शामिल है या अलग से?"

**Subtitle:** *How much is the advance? And is electricity included in the rent, or separate?*

**Close-up, screen recording of phone A:**
- The **They heard** line under your bubble.
  **On screen:** "I can see what they actually received."
- The timing line under the turn (Prisma, LLM and Timbre times).
  **On screen:** "About 2 seconds, start to finish."

### Turn 3: typing instead

Tap the keyboard button, type **"धन्यवाद भैया, मैं कल शाम को आऊँगा।"** and tap **Send**. Phone B speaks it in Kannada.

**Subtitle:** *Thank you, I'll come tomorrow evening.*
**On screen:** "Too noisy to talk? Type instead."

### End and summary

Tap **End call** → **Tap again to end**. Both phones show **Call summary**.

**Shot:** both phones side by side: **Key points** and **Next steps** in Hindi on phone A, in Kannada on phone B. Tap **Listen** on phone A and let 3 seconds play.

**You (voiceover):**
> "When the call ends, each of us gets a summary in our own language, to read or to listen to. The rent, the advance, the next visit. Nothing lost."

---

## Scene 6. Call 2: English to Kannada, with a neighbour (1:30 to 1:52)

**Shot:** hard cut. **On screen:** "Same app. English this time."

New call. **Phone A:** **I speak:** English, **Talking to:** Friend or family. **Phone B:** Kannada.

**You (hold and speak):**
> "Hi! I just moved in next door, I'm from Lucknow. Is there a good place to eat nearby?"

Phone B speaks Kannada.

**You (voiceover):**
> "With a friend it stays casual. With a landlord it stays respectful. Dubhashi changes how polite it sounds depending on who you're talking to."

### Video

Tap the camera on phone A. **Shot:** close on phone B: your face, with the Kannada translation of your last line as a caption under it.

**On screen:** "Video call with live captions. Works on mobile data too."

---

## Scene 7. How it's built: Excalidraw walkthrough (1:52 to 2:30)

**File:** `~/Downloads/dubhashi-architecture.excalidraw`. Open it at excalidraw.com (menu, **Open**) and screen-record the browser full screen.

**How to present:**
- Press **K** for Excalidraw's laser pointer and trace each numbered arrow as you say it. The trail fades by itself, so the diagram stays clean.
- Zoom with Ctrl + scroll into each part as you talk about it, then zoom out to the whole picture at the end.
- Go slowly: hold each zoom for at least 2 seconds after you finish the sentence.

| Time | Zoom to | Laser | You say (English) |
| --- | --- | --- | --- |
| 1:52 | Whole diagram | none | "Here's what happens in those two seconds." |
| 1:55 | Person A (green, top left) | arrow **1** | "I hold to talk. My phone streams my voice to our server, sixteen thousand samples a second, over a WebSocket." |
| 2:00 | Gnani Prisma (blue, top right) | arrow **2** | "The server opens a live connection to **Gnani's Prisma**, one per button press. The moment I let go, Prisma sends back the transcript, in about half a second." |
| 2:06 | Open-weights LLM (purple) | arrow **3** | "An open model, Gemma 4, translates it. It also knows who is talking to whom, so a landlord gets respect and a friend gets casual." |
| 2:11 | Number guard (red, middle) | arrow **4** | "Then plain code, not AI, checks every number across both scripts. If money or a date is involved, I confirm it before anyone hears it." |
| 2:16 | Gnani Timbre and voice clone (blue, right) | arrow **5**, then the dashed "voice sample" line | "**Gnani's Timbre** speaks the translation, streaming, so sound starts in about 0.3 seconds. And with **Gnani's voice cloning**, fifteen seconds of my voice becomes a voice profile, which is why I still sound like me, in Kannada." |
| 2:23 | Person B, then back to A | arrows **6** and **7** | "They hear it in my voice, with a caption over the video. And I see what they actually heard, translated back." |
| 2:27 | Bottom row, "One turn, end to end" | sweep left to right | "Release to first sound: 1.7 seconds." |

**On screen while the Gnani boxes are zoomed in:** a small label "Gnani AI" in the corner, so viewers notice which parts are Gnani.

**Optional, if there is time (adds about 8 seconds):** zoom to the "Per-key serial queue" box:
> "Gnani's free tier allows one request at a time, so every call waits its turn in a queue, and retries politely if the API says slow down."

This shows you designed around the real API limits, which interviewers like.

**One change to the diagram, to match this demo:** arrow 4's label says "500 mg, twice a day?", a doctor example. Change it to **"₹8,000 a month?"** so it matches the landlord call the viewer just watched. Then export a fresh PNG.

---

## Scene 8. Close (2:30 to 2:38)

**Shot:** back to you, to camera, same framing as Scene 1.

**You:**
> "भाषा अब रुकावट नहीं।"
> "Dubhashi. Talk in your language. They hear theirs."

**End card (3 seconds):**
> **Dubhashi**
> Built on Gnani AI: Prisma · Timbre · Vachana voice cloning
> dubhashi.onrender.com
> #GnaniAI #GreatIndianAIInternshipChallenge

**Music:** rises slightly for the end card, then fades out.

---

## 60 second cut (for the post)

| Time | Keep |
| --- | --- |
| 0:00 to 0:05 | Scene 1 hook |
| 0:05 to 0:20 | Scene 2: the 45 crore, 1 in 10 and 81% cards only, 5 seconds each |
| 0:20 to 0:25 | Scene 3: "इसलिए मैंने बनाया Dubhashi।" plus the tagline |
| 0:25 to 0:45 | Scene 5, turn 1: the 8,000 read-back, phone B in your voice, then "मुझे कन्नड़ नहीं आती... पर मेरी आवाज़ को आती है।" |
| 0:45 to 0:52 | Scene 6 video shot: your face with the Kannada caption |
| 0:52 to 1:00 | End card with the Gnani models and hashtags |

---

## Filming notes

### Before you start
- [ ] Open https://dubhashi.onrender.com about 3 minutes early. The free server takes about a minute to wake.
- [ ] Phones on do-not-disturb, volume and brightness at maximum, light theme.
- [ ] Record the voice clone in a quiet room. Read the prompt naturally, not too slowly.
- [ ] Do two full dry runs of Scene 5 before recording.

### Audio
- Phone B's speaker is what the viewer hears, so keep the filming phone within 50 cm of it. A clip-on mic on you helps for your lines.
- Or screen-record phone B with media audio on (Android's screen recorder can do this) and sync it to the top-down shot in the edit.

### Subtitles
- Burn in English subtitles for every Hindi line and every Kannada playback. Most viewers won't speak Kannada, and the moment only works if they can follow it.
- For the Kannada subtitles, use the **They heard** back-translation shown on phone A. It is the Kannada translated back separately, so it shows what was really said.

### Checks on every take you keep
- 8,000 appears as 8,000 in both phones' bubbles.
- The **They heard** line matches what you meant. If not, re-record that turn.
- For a second check, point Google Lens at phone B's Kannada text.

### Rules
- No faking: real speech and real output only, no dubbed audio. Label every speed-up ("2x") and keep cuts honest. The contest bans misleading demos.
- The rent and neighbour lines are made up for the demo. Don't show anyone's real address or phone number.
- Only your own voice is cloned, recorded by you, with consent.

## Sources for the numbers

- 45 crore internal migrants, 37%: Census 2011, via [Takshashila](https://takshashila.org.in/content/publications/assets/States-Migrant-Workers-and-the-Pandemic.pdf)
- 1 in 10 can speak English (10.6%): Census 2011 language tables, via [Wikipedia](https://en.wikipedia.org/wiki/List_of_languages_by_number_of_native_speakers_in_India)
- 81% report communication difficulties: South India Interstate Migration Survey 2026, IIMAD, 1,824 workers, via [The Policy Edge](https://www.policyedge.in/p/south-india-migrant-survey-finds-better-living-standards-amid-weak-worker-protection) and [Down To Earth](https://www.downtoearth.org.in/governance/nearly-three-in-four-migrant-workers-in-southern-india-report-improved-living-standards-survey-finds)
- 53% saw a critical incident: 106 clinicians at 6 Indian sites, [Int J Emerg Med 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8459521/)
