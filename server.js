const express = require("express");
const path    = require("path");
const { KB, FALLBACK_NP, FALLBACK_EN, GREETING_NP, GREETING_EN } = require("./knowledge");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Helpers ────────────────────────────────────────────────────────────────

function isNepali(text) {
  return /[ऀ-ॿ]/.test(text);
}

// Transliterated English words spelled in Devanagari (from hi-IN voice recognition)
// Maps Devanagari spelling → English equivalent used in KB keywords
const TRANSLIT = {
  "व्हाट": "what", "व्हट": "what", "ह्वाट": "what",
  "इस": "is", "इज": "is",
  "थिस": "this", "दिस": "this",
  "अबाउट": "about",
  "कॉन्फ्रेंस": "conference", "कान्फ्रेन्स": "conference", "कन्फरेन्स": "conference",
  "एआई": "AI", "ए.आई": "AI", "आर्टिफिशियल": "artificial", "इंटेलिजेंस": "intelligence",
  "गवर्नेंस": "governance", "गभर्नेन्स": "governance",
  "म्युनिसिपल": "municipal", "म्युनिसिपल्टी": "municipality",
  "डेटा": "data", "डाटा": "data",
  "प्राइवेसी": "privacy", "प्राइभेसी": "privacy",
  "साइबर": "cyber", "साइबरसेक्युरिटी": "cybersecurity",
  "सेक्युरिटी": "security", "सिक्योरिटी": "security",
  "चैटजीपीटी": "chatgpt", "च्याटजीपीटी": "chatgpt",
  "वेन्यू": "venue", "भेन्यू": "venue",
  "डिक्लेरेशन": "declaration", "घोषणापत्र": "declaration",
  "रेस्पॉन्सिबल": "responsible", "रेस्पान्सिबल": "responsible",
  "बायस": "bias", "बायास": "bias",
  "स्मार्ट": "smart", "सिटी": "city",
  "मशीन": "machine", "लर्निंग": "learning",
  "जनरेटिव": "generative", "जेनेरेटिव": "generative",
  "ट्रांसपेरेंसी": "transparency", "ट्रान्स्पेरेन्सी": "transparency",
  "पॉलिसी": "policy", "पालिसी": "policy",
  "रेगुलेशन": "regulation",
  "चैलेंज": "challenge", "च्यालेन्ज": "challenge",
  "हाउ": "how", "हाउ": "how",
  "व्हेयर": "where", "व्हेर": "where",
  "हू": "who",
  "व्हाई": "why",
  "कैन": "can", "वुड": "would",
  "टेल": "tell", "मी": "me",
  "हेल्प": "help",
  "यू": "you",
  "एडप्शन": "adoption", "एडाप्सन": "adoption",
  "इम्प्लिमेंट": "implement", "इम्प्लिमेन्टेशन": "implementation",
  "पार्टिसिपेंट": "participant", "पार्टिसिपन्ट": "participant",
  "बीवाईसी": "BYC",
};

// If the input is Devanagari transliteration of English, convert tokens back to English.
// Returns the transliterated string (still marked as "nepali" for response language).
function detranslit(text) {
  if (!isNepali(text)) return text;
  const words = text.split(/\s+/);
  const converted = words.map(w => TRANSLIT[w] || w);
  return converted.join(" ");
}

function normalize(str) {
  return str.toLowerCase()
    .replace(/[?।！？,.،؟]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Score a KB entry against the query
function score(entry, query) {
  const q = normalize(query);
  let best = 0;
  for (const kw of entry.keywords) {
    const k = normalize(kw);
    // Exact substring match — score = phrase word count * 2 (longer = more specific)
    if (q.includes(k)) {
      const s = k.split(" ").length * 2;
      if (s > best) best = s;
    } else {
      // Partial word overlap — score = (matching words / total keyword words) * keyword length
      // This penalises short keywords that partially match unrelated queries
      const kwWords = k.split(" ").filter(w => w.length > 2);
      const qWords  = q.split(" ");
      const matched = kwWords.filter(w => qWords.some(qw => qw === w));
      if (matched.length > 0) {
        const s = (matched.length / kwWords.length) * matched.length;
        if (s > best) best = s;
      }
    }
  }
  return best;
}

function findAnswer(query) {
  let topScore = 0;
  let topEntry = null;

  for (const entry of KB) {
    const s = score(entry, query);
    if (s > topScore) {
      topScore = s;
      topEntry = entry;
    }
  }

  // Require a minimum confidence threshold
  if (topScore < 1 || !topEntry) return null;
  return topEntry;
}

// ── API Route ──────────────────────────────────────────────────────────────

app.post("/api/chat", (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Invalid messages" });
  }

  const lastMsg   = messages[messages.length - 1];
  const userText  = lastMsg.content || "";
  const nepali    = isNepali(userText);

  // Convert Devanagari-transliterated English back to Latin before matching
  const matchText = detranslit(userText);

  // Greeting detection
  const greetWords = ["hello", "hi", "namaste", "नमस्ते", "नमस्कार", "hey", "greetings", "सुप्रभात", "welcome"];
  const normMatch  = normalize(matchText);
  const wordCount  = matchText.trim().split(/\s+/).length;
  const isGreeting = greetWords.some(w => normMatch.split(/\s+/).includes(w)) && wordCount <= 3;

  if (isGreeting) {
    return res.json({ reply: nepali ? GREETING_NP : GREETING_EN });
  }

  const entry = findAnswer(matchText);

  if (!entry) {
    return res.json({ reply: nepali ? FALLBACK_NP : FALLBACK_EN });
  }

  const reply = nepali ? entry.answerNP : entry.answerEN;
  res.json({ reply });
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🤖 JARVIS is online at http://localhost:${PORT}`);
  console.log(`   BYC Conference — Reshaping Municipal Governance in the Age of AI`);
  console.log(`   Running on LOCAL knowledge base (${KB.length} Q&A entries) — no API key required.\n`);
});
