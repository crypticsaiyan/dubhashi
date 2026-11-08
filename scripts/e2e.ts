/**
 * Drives a full call in two real Chrome tabs with a fake microphone, against a
 * server started with MOCK_AI=1. Covers what the socket tests cannot: the mic
 * worklet, the hold button, the confirm card, playback and the summary screen.
 *
 *   MOCK_AI=1 pnpm start   then   pnpm exec tsx scripts/e2e.ts
 */
import { mkdirSync } from "node:fs";
import { STRINGS } from "../web/src/strings";
import { Tab, frames, launchChrome, sleep, until } from "./cdp";

const bn = STRINGS["bn-IN"];
const ml = STRINGS["ml-IN"];

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
mkdirSync("tmp", { recursive: true });
const chrome = await launchChrome();

let failed = false;
try {

  const patient = await Tab.open(BASE);
  await patient.waitFor("Talk in your language");
  await patient.shot("1-start");
  await patient.set('form input:not([type="radio"], [type="checkbox"])', "Asha", "input");
  await patient.pick(".languages", "Bengali");
  await patient.eval(`document.querySelector('.toggle input').click()`);
  await patient.clickText("Start call");
  await patient.waitFor("Speak in your own voice");
  const locked = await patient.eval<boolean>(
    `[...document.querySelectorAll("button")].find((b) => b.innerText === "Record").disabled`,
  );
  if (!locked) throw new Error("Recording allowed without consent");
  await patient.eval(`document.querySelector('.check input').click()`);
  await patient.clickText("Record");
  for (let i = 0; i < 100; i++) {
    const shown = await patient.eval<string>('document.querySelector(".recorder-center strong")?.innerText ?? ""');
    if (parseInt(shown) >= 6) break;
    await sleep(100);
  }
  await patient.shot("1b-voice");
  await patient.clickText("Finish");
  await patient.waitFor(bn.waiting);
  console.log("voice enrolled with consent");
  await sleep(300);
  const code = (await patient.eval<string>('document.querySelector(".room-code").getAttribute("aria-label")')).trim();
  console.log("room", code);
  await patient.shot("2-waiting");

  const doctor = await Tab.open(`${BASE}/?code=${code}`);
  await doctor.waitFor("Call code");
  await doctor.set('form label:nth-of-type(2) input', "Dr Nair", "input");
  await doctor.pick(".languages", "Malayalam");
  await doctor.clickText("Join call");
  await doctor.waitFor("Asha");
  await patient.waitFor("Dr Nair");
  await patient.waitFor("কথা বলতে চেপে ধরুন");
  await doctor.waitFor("സംസാരിക്കാൻ അമർത്തിപ്പിടിക്കുക");
  console.log("both in call, labels localized");
  await patient.shot("2b-call-empty");

  await doctor.hold(1200);
  await doctor.waitFor("ഇത് ശരിയാണോ?");
  await doctor.waitFor("500");
  console.log("mic reached server, confirm card shown to speaker");
  await doctor.shot("3-confirm");
  const before = await patient.text();
  if (before.includes("500")) throw new Error("Listener got the dose before confirmation");

  await doctor.clickText("അതെ");
  await patient.waitFor("[Bengali]");
  await doctor.waitFor("അവർ കേട്ടത്");
  console.log("translation delivered, back-translation shown");

  // The talk button only frees up after the browser plays the audio and reports it.
  await patient.waitFor(bn.hold);
  await patient.clickText(bn.replay);
  await patient.waitFor(bn.playing);
  console.log("replay plays the heard turn again");
  await patient.waitFor(bn.replay, 8000);
  const played = await patient.eval<boolean>('!document.querySelector(".talk").disabled');
  if (!played) throw new Error("Talk button still locked after playback");
  console.log("playback finished, button released");
  await patient.shot("4-listener");
  await doctor.shot("5-speaker");

  await patient.hold(900);
  await patient.waitFor("এটা কি ঠিক?");
  await patient.clickText("আবার বলুন");
  await patient.waitFor("কথা বলতে চেপে ধরুন");
  console.log("say again cancels the turn");

  await patient.eval(`document.querySelector(".camera").click()`);
  await until(patient, frames(".stage .self"), "patient self view");
  await until(doctor, frames(".stage .remote"), "doctor sees patient video");
  await doctor.eval(`document.querySelector(".camera").click()`);
  await until(patient, frames(".stage .remote"), "patient sees doctor video");
  const caption = await patient.eval<string>('document.querySelector(".caption")?.innerText ?? ""');
  if (!caption.includes("[Bengali]")) throw new Error(`Caption missing translation: ${caption}`);
  console.log("video both ways, caption shows translation");
  await patient.shot("5b-video-patient");
  await doctor.shot("5c-video-doctor");
  await patient.eval(`document.querySelector(".camera").click()`);
  await until(doctor, '!!document.querySelector(".stage .remote.off")', "doctor sees camera off");
  console.log("camera off reaches peer");

  await patient.waitFor(bn.hold);
  await patient.eval(`document.querySelector(".talk-row .side").click()`);
  await patient.set(".composer input", "my head hurts", "input");
  await patient.eval(`document.querySelector(".composer .send").click()`);
  await doctor.waitFor("[Malayalam] my head hurts");
  await doctor.waitFor(ml.hold, 8000);
  console.log("typed turn delivered");
  await patient.shot("5d-typed");

  await doctor.eval("location.reload()");
  await doctor.waitFor(ml.rejoin);
  await doctor.shot("5e-rejoin");
  await doctor.clickText(ml.rejoin);
  await doctor.waitFor(ml.hold);
  if (!(await doctor.text()).includes("[Malayalam] my head hurts")) throw new Error("Transcript lost on rejoin");
  await until(patient, '!document.querySelector(".stage")', "stale video cleared after peer reload");
  console.log("reloaded tab rejoins with transcript, stale video cleared");
  await doctor.eval(`document.querySelector(".camera").click()`);
  await until(patient, frames(".stage .remote"), "video reconnects after reload");
  await doctor.eval(`document.querySelector(".camera").click()`);
  console.log("video reconnects after reload");

  await doctor.eval(`document.querySelector(".end").click()`);
  await doctor.waitFor(ml.endConfirm);
  if ((await patient.text()).includes(bn.summaryTitle)) throw new Error("One tap ended the call");
  await doctor.eval(`document.querySelector(".end").click()`);
  await patient.waitFor(bn.summaryTitle);
  await doctor.waitFor(ml.summaryTitle);
  await patient.waitFor("মূল কথা");
  await patient.shot("6-summary");
  await patient.clickText("শুনুন");
  await sleep(300);
  console.log("summary shown to both");

  for (const [name, tab] of [["patient", patient], ["doctor", doctor]] as const) {
    if (await tab.overflow()) throw new Error(`${name} page scrolls sideways`);
    if (tab.errors.length) throw new Error(`${name} console errors: ${tab.errors.join("; ")}`);
  }
  console.log("PASS");
} catch (error) {
  failed = true;
  console.error("FAIL", error);
} finally {
  chrome.kill();
}
process.exit(failed ? 1 : 0);
