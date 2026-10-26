import { getSettings, hostOf, isSkipped, sendToApp } from "./shared.js";

const $ = (id) => document.getElementById(id);

async function save(patch) {
  await chrome.storage.local.set(patch);
}

async function init() {
  const s = await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const site = /^https?:/.test(tab?.url ?? "") ? hostOf(tab.url) : "";

  $("catch").checked = s.catchDownloads;
  $("catchNote").hidden = !s.catchDownloads;
  $("minSize").value = String(s.minSizeMb);
  if (site) {
    $("siteRow").hidden = false;
    $("site").textContent = site;
    $("siteCatch").checked = !isSkipped(site, s.skipHosts);
    $("siteCatch").disabled = !s.catchDownloads;
  }

  $("catch").addEventListener("change", async (e) => {
    await save({ catchDownloads: e.target.checked });
    $("siteCatch").disabled = !e.target.checked;
    // Explain what catching can't carry over as soon as it's turned on.
    $("catchNote").hidden = !e.target.checked;
  });
  $("siteCatch").addEventListener("change", async (e) => {
    const { skipHosts } = await getSettings();
    const rest = skipHosts.filter((h) => h !== site && !site.endsWith("." + h));
    await save({ skipHosts: e.target.checked ? rest : [...rest, site] });
  });
  $("minSize").addEventListener("change", async (e) => {
    const v = Math.max(0, Math.min(10000, Math.round(Number(e.target.value) || 0)));
    e.target.value = String(v);
    await save({ minSizeMb: v });
  });

  const { lastProblem } = await chrome.storage.session.get("lastProblem");
  if (lastProblem) {
    $("problem").textContent = lastProblem.message;
    $("problem").hidden = false;
  }
  chrome.action.setBadgeText({ text: "" });

  const status = $("status");
  try {
    const r = await sendToApp({ type: "ping" });
    status.textContent = `Connected · ${r.version}`;
    status.className = "status is-ok";
    if (lastProblem) await chrome.storage.session.set({ lastProblem: null });
  } catch (e) {
    status.textContent = "Not connected";
    status.className = "status is-error";
    $("problem").textContent = e.message;
    $("problem").hidden = false;
  }
}

init();
