// ── State ──────────────────────────────────────────────────────────────────
const history = [];
let isListening  = false;
let isSpeaking   = false;
let recognition  = null;
let speechSynth  = window.speechSynthesis;
let voices       = [];

// ── Elements ───────────────────────────────────────────────────────────────
const orb        = document.getElementById("orb");
const orbStatus  = document.getElementById("orbStatus");
const waveBars   = document.getElementById("waveBars");
const chat       = document.getElementById("chat");
const micBtn     = document.getElementById("micBtn");
const textInput  = document.getElementById("textInput");
const sendBtn    = document.getElementById("sendBtn");
const clearBtn   = document.getElementById("clearBtn");

// ── Load voices ────────────────────────────────────────────────────────────
function loadVoices() {
  voices = speechSynth.getVoices();
}
loadVoices();
speechSynth.onvoiceschanged = loadVoices;

// ── Language detection (Devanagari unicode range) ──────────────────────────
function isNepali(text) {
  return /[ऀ-ॿ]/.test(text);
}

function pickVoice(nepali) {
  if (nepali) {
    // Try Hindi voices as fallback since Nepali TTS is rarely available
    const hi = voices.find(v => v.lang.startsWith("hi") || v.lang === "ne-NP" || v.lang.startsWith("ne"));
    return hi || null;
  }
  const en = voices.find(v => v.lang.startsWith("en"));
  return en || null;
}

// ── Orb state ──────────────────────────────────────────────────────────────
function setOrbState(state) {
  orb.className = state ? `${state}` : "";
  waveBars.className = (state === "listening" || state === "speaking") ? "wave-bars active" : "wave-bars";

  const labels = {
    idle:      "Tap to speak &nbsp;/&nbsp; बोल्न थिच्नुहोस्",
    listening: "Listening… &nbsp;/&nbsp; सुन्दैछु…",
    thinking:  "Processing… &nbsp;/&nbsp; सोच्दैछु…",
    speaking:  "Speaking… &nbsp;/&nbsp; बोल्दैछु…",
  };
  orbStatus.innerHTML = labels[state] || labels.idle;
}

// ── Append a chat bubble ───────────────────────────────────────────────────
function appendMessage(role, text) {
  const nepali = isNepali(text);
  const div = document.createElement("div");
  div.className = `msg ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = role === "jarvis" ? "J" : "YOU";

  const bubble = document.createElement("div");
  bubble.className = `msg-bubble${nepali ? " nepali" : ""}`;
  bubble.textContent = text;

  div.appendChild(avatar);
  div.appendChild(bubble);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "msg jarvis";
  div.id = "typing";

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = "J";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;

  div.appendChild(avatar);
  div.appendChild(bubble);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById("typing");
  if (el) el.remove();
}

// ── Speak text with TTS ────────────────────────────────────────────────────
function speak(text) {
  speechSynth.cancel();
  const nepali  = isNepali(text);
  const utterance = new SpeechSynthesisUtterance(text);
  const voice   = pickVoice(nepali);
  if (voice) utterance.voice = voice;
  utterance.lang  = nepali ? "hi-IN" : "en-US";
  utterance.rate  = 0.92;
  utterance.pitch = 0.9;

  isSpeaking = true;
  setOrbState("speaking");

  utterance.onend = () => {
    isSpeaking = false;
    setOrbState("idle");
  };
  utterance.onerror = () => {
    isSpeaking = false;
    setOrbState("idle");
  };

  speechSynth.speak(utterance);
}

// ── Send message to server ─────────────────────────────────────────────────
async function sendMessage(userText) {
  const trimmed = userText.trim();
  if (!trimmed) return;

  if (isSpeaking) speechSynth.cancel();

  appendMessage("user", trimmed);
  history.push({ role: "user", content: trimmed });

  setOrbState("thinking");
  showTyping();
  textInput.value = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });

    const data = await res.json();
    removeTyping();

    if (!res.ok || data.error) {
      const errText = data.error || "An error occurred.";
      appendMessage("jarvis", errText);
      setOrbState("idle");
      return;
    }

    const reply = data.reply;
    history.push({ role: "assistant", content: reply });
    appendMessage("jarvis", reply);
    speak(reply);

  } catch (err) {
    removeTyping();
    appendMessage("jarvis", "Connection error. Please check the server.");
    setOrbState("idle");
  }
}

// ── Speech Recognition ─────────────────────────────────────────────────────
function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const rec = new SpeechRecognition();
  rec.continuous      = false;
  rec.interimResults  = false;
  // Try to recognise both languages; browser will auto-detect
  rec.lang            = "hi-IN"; // covers Devanagari (Hindi/Nepali); en-US handled by fallback

  rec.onstart = () => {
    isListening = true;
    micBtn.classList.add("recording");
    setOrbState("listening");
  };

  rec.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    sendMessage(transcript);
  };

  rec.onerror = (e) => {
    if (e.error !== "no-speech") {
      appendMessage("jarvis", "Microphone error: " + e.error);
    }
    stopListening();
  };

  rec.onend = () => {
    stopListening();
  };

  return rec;
}

function stopListening() {
  isListening = false;
  micBtn.classList.remove("recording");
  if (!isSpeaking) setOrbState("idle");
}

function toggleMic() {
  if (isListening) {
    recognition && recognition.stop();
    return;
  }
  if (!recognition) {
    recognition = setupRecognition();
  }
  if (!recognition) {
    alert("Speech recognition is not supported in this browser.\nPlease use Chrome or Edge.\n\nस्पीच रिकग्निशन यस ब्राउजरमा उपलब्ध छैन। Chrome वा Edge प्रयोग गर्नुहोस्।");
    return;
  }
  try {
    recognition.start();
  } catch (e) {
    // already started
  }
}

// ── Event listeners ────────────────────────────────────────────────────────
micBtn.addEventListener("click", toggleMic);
orb.addEventListener("click", toggleMic);

sendBtn.addEventListener("click", () => sendMessage(textInput.value));
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(textInput.value);
  }
});

clearBtn.addEventListener("click", () => {
  history.length = 0;
  chat.innerHTML = "";
  speechSynth.cancel();
  setOrbState("idle");
});

// ── Greeting on load ───────────────────────────────────────────────────────
window.addEventListener("load", () => {
  // Small delay for voices to load
  setTimeout(() => {
    const greeting = "Good day! I am JARVIS, your AI guide at the BYC Conference on Reshaping Municipal Governance in the Age of AI. You may speak or type in English or Nepali. How may I assist you?";
    history.push({ role: "assistant", content: greeting });
    appendMessage("jarvis", greeting);
    speak(greeting);
  }, 800);
});

// ── Bind recognition on load ───────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  recognition = setupRecognition();
});
