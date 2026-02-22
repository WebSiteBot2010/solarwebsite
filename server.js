const express = require("express");
const session = require("express-session");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

const app = express();

// In-memory store candidature (niente DB)
const candidatureStore = [];
let nextId = 1;

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "solar-secret",
  resave: false,
  saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, "public")));

// Middleware: check login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Non autenticato" });
  next();
}

// Middleware: check admin
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Non autenticato" });
  if (!ADMIN_IDS.includes(req.session.user.id)) {
    return res.status(403).json({ error: "Non autorizzato" });
  }
  next();
}

// Login con Discord
app.get("/login", (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify"
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

// Callback OAuth2
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/");

  try {
    const data = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
      scope: "identify"
    });

    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      data,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });

    req.session.user = {
      id: userRes.data.id,
      username: userRes.data.username,
      discriminator: userRes.data.discriminator,
      avatar: userRes.data.avatar
    };

    res.redirect("/");
  } catch (err) {
    console.error("OAuth error:", err.response?.data || err.message);
    res.redirect("/");
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// Info sessione per frontend
app.get("/session", (req, res) => {
  if (req.session.user) {
    return res.json({
      logged: true,
      id: req.session.user.id,
      username: `${req.session.user.username}#${req.session.user.discriminator}`
    });
  }
  res.json({ logged: false });
});

// Invio candidatura
app.post("/candidature", async (req, res) => {
  const { username, eta, disponibilita, motivazione, scenario } = req.body;

  const candidatura = {
    id: nextId++,
    username,
    eta,
    disponibilita,
    motivazione,
    scenario,
    status: "in_review", // in_review | accepted | rejected
    createdAt: new Date()
  };

  candidatureStore.push(candidatura);

  const embed = {
    username: "Solar • Candidature",
    embeds: [
      {
        title: "📨 Nuova candidatura ricevuta",
        color: 16763904,
        fields: [
          { name: "👤 Utente", value: username || "Non specificato", inline: true },
          { name: "🎂 Età", value: eta || "Non specificato", inline: true },
          { name: "🕒 Disponibilità", value: disponibilita || "Non specificato" },
          { name: "✨ Motivazione", value: motivazione || "Non specificato" },
          { name: "⚠️ Scenario pratico", value: scenario || "Non specificato" }
        ],
        footer: { text: "Solar Staff System" },
        timestamp: candidatura.createdAt.toISOString()
      }
    ]
  };

  try {
    if (process.env.WEBHOOK_URL) {
      await axios.post(process.env.WEBHOOK_URL, embed);
    }
  } catch (err) {
    console.error("Errore invio webhook:", err.response?.data || err.message);
  }

  res.redirect("/candidature.html?ok=1");
});

// API: lista candidature (solo admin)
app.get("/api/candidature", requireAdmin, (req, res) => {
  res.json(candidatureStore);
});

// API: cambia stato candidatura (solo admin)
app.post("/api/candidature/:id/status", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body; // accepted | rejected | in_review

  const valid = ["accepted", "rejected", "in_review"];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: "Stato non valido" });
  }

  const c = candidatureStore.find(x => x.id === id);
  if (!c) return res.status(404).json({ error: "Candidatura non trovata" });

  c.status = status;
  res.json({ ok: true, candidatura: c });
});

// Pannello admin (pagina)
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Solar site online su porta ${PORT}`));
