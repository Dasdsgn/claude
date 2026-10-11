/**
 * Cloudflare Worker: принимает бриф с сайта и пересылает в Telegram-бота.
 * Переменные окружения: BOT_TOKEN (Secret), CHAT_ID, ALLOWED_ORIGIN
 *
 * Защита: проверка сайта-источника, лимит частоты по IP, минимальное время
 * заполнения, ограничения размера и типов файлов, проверка полей.
 */

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_BODY_BYTES = 28 * 1024 * 1024;
const MAX_DATA_CHARS = 60000;
const MIN_FILL_SECONDS = 20;     // бот-спам заполняет форму за секунды
const COOLDOWN_SECONDS = 30;     // одна отправка с одного IP раз в 30 секунд
const TG_LIMIT = 3900;

const ALLOWED_EXT = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv",
  "odt", "ods", "odp", "key", "pages", "numbers",
  "jpg", "jpeg", "png", "webp", "heic", "gif",
  "zip", "rar", "7z",
]);

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
    const originOk = allowed.length > 0 && allowed.includes(origin);
    const baseHeaders = {
      "Access-Control-Allow-Origin": originOk ? origin : (allowed[0] || "null"),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...baseHeaders, "Content-Type": "application/json; charset=utf-8" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: baseHeaders });
    if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
    if (!originOk) return json({ ok: false, error: "origin" }, 403);
    if (!env.BOT_TOKEN || !env.CHAT_ID) return json({ ok: false, error: "worker not configured" }, 500);

    const len = Number(request.headers.get("Content-Length") || 0);
    if (len > MAX_BODY_BYTES) return json({ ok: false, error: "too large" }, 413);
    const type = request.headers.get("Content-Type") || "";
    if (!type.toLowerCase().startsWith("multipart/form-data")) return json({ ok: false, error: "bad type" }, 415);

    // лимит частоты по IP (кэш Cloudflare в рамках дата-центра)
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rlKey = new Request("https://rate-limit.invalid/" + encodeURIComponent(ip));
    if (await caches.default.match(rlKey)) return json({ ok: false, error: "slow down" }, 429);

    let form;
    try { form = await request.formData(); } catch { return json({ ok: false, error: "bad body" }, 400); }

    const raw = form.get("data");
    if (typeof raw !== "string" || raw.length > MAX_DATA_CHARS) return json({ ok: false, error: "bad data" }, 400);
    let data;
    try { data = JSON.parse(raw); } catch { return json({ ok: false, error: "bad data" }, 400); }
    if (!data || typeof data !== "object") return json({ ok: false, error: "bad data" }, 400);

    // обязательные поля
    const name = str(data.name, 120), contact = str(data.contact, 160);
    if (name.length < 1 || contact.length < 3) return json({ ok: false, error: "missing fields" }, 400);
    if (!Array.isArray(data.sections) || data.sections.length === 0 || data.sections.length > 12) return json({ ok: false, error: "bad data" }, 400);

    // не слишком быстро для человека
    const elapsed = Number(data.meta && data.meta.elapsed);
    if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_SECONDS) return json({ ok: false, error: "too fast" }, 429);

    // файлы
    const files = form.getAll("files").filter(f => f && typeof f === "object" && typeof f.arrayBuffer === "function" && f.size > 0);
    if (files.length > MAX_FILES) return json({ ok: false, error: "too many files" }, 400);
    let total = 0;
    for (const f of files) {
      total += f.size;
      if (f.size > MAX_FILE_BYTES) return json({ ok: false, error: "file too large" }, 400);
      const ext = String(f.name || "").split(".").pop().toLowerCase();
      if (!ALLOWED_EXT.has(ext)) return json({ ok: false, error: "file type not allowed" }, 400);
    }
    if (total > MAX_TOTAL_BYTES) return json({ ok: false, error: "files too large" }, 400);

    const api = (method, body) =>
      fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", body }).then(r => r.json());
    const fields = obj => { const fd = new FormData(); for (const [k, v] of Object.entries(obj)) fd.append(k, v); return fd; };

    try {
      for (const text of buildMessages({ ...data, name, contact })) {
        const r = await api("sendMessage", fields({ chat_id: env.CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: "true" }));
        if (!r.ok) return json({ ok: false, error: "telegram" }, 502);
      }
      for (const f of files) {
        const fd = new FormData();
        fd.append("chat_id", env.CHAT_ID);
        fd.append("caption", "📎 " + name.slice(0, 100));
        fd.append("document", f, safeName(f.name));
        const r = await api("sendDocument", fd);
        if (!r.ok) return json({ ok: false, error: "telegram file" }, 502);
      }
      // успех: включаем паузу для этого IP
      ctx.waitUntil(caches.default.put(rlKey, new Response("1", { headers: { "Cache-Control": `max-age=${COOLDOWN_SECONDS}` } })));
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: "server" }, 500);
    }
  },
};

const str = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, n);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const safeName = n => String(n || "file").replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").slice(0, 120);

function buildMessages(d) {
  const head =
    `🆕 <b>Новый бриф</b>\n` +
    `👤 <b>${esc(str(d.name, 120))}</b>\n` +
    (d.company ? `🏢 ${esc(str(d.company, 160))}\n` : "") +
    `📞 ${esc(str(d.contact, 160))}\n`;

  const blocks = [head];
  for (const s of d.sections.slice(0, 12)) {
    blocks.push(`\n<b>━━ ${esc(str(s && s.n, 4))} · ${esc(str(s && s.title, 80))}</b>\n`);
    for (const it of (Array.isArray(s && s.items) ? s.items : []).slice(0, 20)) {
      blocks.push(`\n<b>${esc(str(it && it.q, 200))}</b>\n${esc(str(it && it.a, 3000))}\n`);
    }
  }

  const out = [];
  let cur = "";
  for (const b of blocks) {
    if ((cur + b).length > TG_LIMIT) { if (cur) out.push(cur); cur = b; }
    else cur += b;
  }
  if (cur) out.push(cur);
  return out;
}
