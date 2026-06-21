import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { randomBytes, pbkdf2Sync, timingSafeEqual, createHmac } from "node:crypto";

const root = resolve(".");
const publicDir = join(root, "public");
const dataDir = resolve(process.env.DATA_DIR || join(root, "data"));
const storePath = join(dataDir, "store.json");
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const appSecret = process.env.APP_SECRET || (isProduction ? "" : "dev-secret-change-before-production");
const adminEmail = process.env.APP_ADMIN_EMAIL || (isProduction ? "" : "admin@pression.local");
const adminPassword = process.env.APP_ADMIN_PASSWORD || (isProduction ? "" : "ChangeMoi123!");
const sessionMaxAgeSeconds = 60 * 60 * 8;

if (isProduction && (!appSecret || !adminEmail || !adminPassword)) {
  throw new Error("APP_SECRET, APP_ADMIN_EMAIL and APP_ADMIN_PASSWORD are required in production.");
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const attempted = hashPassword(password, salt).split(":")[1];
  return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempted, "hex"));
}

function sign(value) {
  return createHmac("sha256", appSecret).update(value).digest("base64url");
}

function createSession(email) {
  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Date.now() + sessionMaxAgeSeconds * 1000
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
  const token = cookies.pression_session;
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function sessionCookie(value) {
  const secure = isProduction ? "; Secure" : "";
  return `pression_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeSeconds}${secure}`;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    active: user.active !== false,
    createdAt: user.createdAt
  };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function loadStore() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(storePath)) {
    const initialStore = {
      users: [{
        id: randomBytes(12).toString("hex"),
        email: adminEmail.toLowerCase(),
        passwordHash: hashPassword(adminPassword),
        role: "admin",
        active: true,
        createdAt: new Date().toISOString()
      }],
      readings: []
    };
    await writeFile(storePath, JSON.stringify(initialStore, null, 2));
    return initialStore;
  }
  const store = JSON.parse(await readFile(storePath, "utf8"));
  let changed = false;
  store.users = Array.isArray(store.users) ? store.users : [];
  store.readings = Array.isArray(store.readings) ? store.readings : [];
  store.users = store.users.map((user, index) => {
    const upgraded = {
      id: user.id || randomBytes(12).toString("hex"),
      email: normalizeEmail(user.email),
      passwordHash: user.passwordHash,
      role: user.role || (index === 0 ? "admin" : "user"),
      active: user.active !== false,
      createdAt: user.createdAt || new Date().toISOString()
    };
    if (JSON.stringify(user) !== JSON.stringify(upgraded)) changed = true;
    return upgraded;
  });
  if (store.users.length && !store.users.some((user) => user.role === "admin")) {
    store.users[0].role = "admin";
    changed = true;
  }
  const envAdmin = normalizeEmail(adminEmail);
  const matchingAdmin = store.users.find((user) => user.email === envAdmin);
  if (matchingAdmin && matchingAdmin.role !== "admin") {
    matchingAdmin.role = "admin";
    matchingAdmin.active = true;
    changed = true;
  }
  if (changed) await saveStore(store);
  return store;
}

async function saveStore(store) {
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function requireUser(req, res) {
  const session = readSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Connexion requise." });
    return null;
  }
  const store = await loadStore();
  const user = store.users.find((entry) => entry.email === session.email && entry.active !== false);
  if (!user) {
    sendJson(res, 401, { error: "Compte inactif ou introuvable." });
    return null;
  }
  return { session, store, user };
}

async function requireAdmin(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return null;
  if (auth.user.role !== "admin") {
    sendJson(res, 403, { error: "Acces admin requis." });
    return null;
  }
  return auth;
}

function validateReading(input) {
  const systolic = Number(input.systolic);
  const diastolic = Number(input.diastolic);
  const pulse = input.pulse === "" || input.pulse == null ? null : Number(input.pulse);
  const measuredAt = input.measuredAt ? new Date(input.measuredAt) : new Date();
  if (!Number.isInteger(systolic) || systolic < 60 || systolic > 260) return "La pression systolique doit etre entre 60 et 260.";
  if (!Number.isInteger(diastolic) || diastolic < 40 || diastolic > 160) return "La pression diastolique doit etre entre 40 et 160.";
  if (pulse !== null && (!Number.isInteger(pulse) || pulse < 30 || pulse > 220)) return "Le pouls doit etre entre 30 et 220.";
  if (Number.isNaN(measuredAt.getTime())) return "La date est invalide.";
  return null;
}

async function handleApi(req, res) {
  if (req.url === "/api/session" && req.method === "GET") {
    const session = readSession(req);
    if (!session) return sendJson(res, 200, { authenticated: false, email: null, role: null });
    const store = await loadStore();
    const user = store.users.find((entry) => entry.email === session.email && entry.active !== false);
    return sendJson(res, 200, {
      authenticated: Boolean(user),
      email: user?.email || null,
      role: user?.role || null
    });
  }

  if (req.url === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    const store = await loadStore();
    const user = store.users.find((entry) => entry.email === normalizeEmail(body.email));
    if (!user || user.active === false || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      return sendJson(res, 401, { error: "Courriel ou mot de passe invalide." });
    }
    return sendJson(res, 200, { ok: true, email: user.email, role: user.role }, { "Set-Cookie": sessionCookie(createSession(user.email)) });
  }

  if (req.url === "/api/logout" && req.method === "POST") {
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": "pression_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
  }

  if (req.url === "/api/readings" && req.method === "GET") {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const readings = auth.store.readings
      .filter((entry) => entry.email === auth.user.email)
      .sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt));
    return sendJson(res, 200, { readings });
  }

  if (req.url === "/api/readings" && req.method === "POST") {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const body = await readBody(req);
    const validationError = validateReading(body);
    if (validationError) return sendJson(res, 400, { error: validationError });

    const reading = {
      id: randomBytes(12).toString("hex"),
      email: auth.user.email,
      systolic: Number(body.systolic),
      diastolic: Number(body.diastolic),
      pulse: body.pulse === "" || body.pulse == null ? null : Number(body.pulse),
      note: String(body.note || "").slice(0, 240),
      measuredAt: new Date(body.measuredAt || Date.now()).toISOString(),
      createdAt: new Date().toISOString()
    };
    auth.store.readings.push(reading);
    await saveStore(auth.store);
    return sendJson(res, 201, { reading });
  }

  if (req.url?.startsWith("/api/readings/") && req.method === "DELETE") {
    const auth = await requireUser(req, res);
    if (!auth) return;
    const id = req.url.split("/").pop();
    const before = auth.store.readings.length;
    auth.store.readings = auth.store.readings.filter((entry) => !(entry.id === id && entry.email === auth.user.email));
    await saveStore(auth.store);
    return sendJson(res, before === auth.store.readings.length ? 404 : 200, { ok: before !== auth.store.readings.length });
  }

  if (req.url === "/api/users" && req.method === "GET") {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    return sendJson(res, 200, { users: auth.store.users.map(publicUser) });
  }

  if (req.url === "/api/users" && req.method === "POST") {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const role = body.role === "admin" ? "admin" : "user";
    if (!isValidEmail(email)) return sendJson(res, 400, { error: "Courriel invalide." });
    if (password.length < 8) return sendJson(res, 400, { error: "Le mot de passe doit contenir au moins 8 caracteres." });
    if (auth.store.users.some((user) => user.email === email)) return sendJson(res, 409, { error: "Ce courriel existe deja." });
    const user = {
      id: randomBytes(12).toString("hex"),
      email,
      passwordHash: hashPassword(password),
      role,
      active: true,
      createdAt: new Date().toISOString()
    };
    auth.store.users.push(user);
    await saveStore(auth.store);
    return sendJson(res, 201, { user: publicUser(user) });
  }

  if (req.url?.startsWith("/api/users/") && req.method === "PATCH") {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const id = req.url.split("/").pop();
    const user = auth.store.users.find((entry) => entry.id === id);
    if (!user) return sendJson(res, 404, { error: "Utilisateur introuvable." });
    const body = await readBody(req);
    const nextRole = body.role === "admin" ? "admin" : body.role === "user" ? "user" : user.role;
    const nextActive = typeof body.active === "boolean" ? body.active : user.active !== false;
    const activeAdmins = auth.store.users.filter((entry) => entry.role === "admin" && entry.active !== false);
    if (user.id === auth.user.id && nextActive === false) return sendJson(res, 400, { error: "Tu ne peux pas desactiver ton propre compte." });
    if (user.role === "admin" && (nextRole !== "admin" || nextActive === false) && activeAdmins.length <= 1) {
      return sendJson(res, 400, { error: "Il doit rester au moins un admin actif." });
    }
    user.role = nextRole;
    user.active = nextActive;
    if (body.password) {
      const password = String(body.password);
      if (password.length < 8) return sendJson(res, 400, { error: "Le mot de passe doit contenir au moins 8 caracteres." });
      user.passwordHash = hashPassword(password);
    }
    await saveStore(auth.store);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (req.url?.startsWith("/api/users/") && req.method === "DELETE") {
    const auth = await requireAdmin(req, res);
    if (!auth) return;
    const id = req.url.split("/").pop();
    const user = auth.store.users.find((entry) => entry.id === id);
    if (!user) return sendJson(res, 404, { error: "Utilisateur introuvable." });
    if (user.id === auth.user.id) return sendJson(res, 400, { error: "Tu ne peux pas supprimer ton propre compte." });
    const activeAdmins = auth.store.users.filter((entry) => entry.role === "admin" && entry.active !== false);
    if (user.role === "admin" && activeAdmins.length <= 1) return sendJson(res, 400, { error: "Il doit rester au moins un admin actif." });
    auth.store.users = auth.store.users.filter((entry) => entry.id !== id);
    auth.store.readings = auth.store.readings.filter((entry) => entry.email !== user.email);
    await saveStore(auth.store);
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, { error: "Route introuvable." });
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin"
    });
    res.end(data);
  } catch {
    const html = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/")) return await handleApi(req, res);
    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Erreur serveur." });
  }
});

server.listen(port, () => {
  console.log(`Pression is running at http://localhost:${port}`);
});
