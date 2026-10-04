/**
 * Cloudflare Worker: принимает бриф с сайта и пересылает в Telegram-бота.
 * Токен бота хранится в секретах Cloudflare и в код сайта не попадает.
 *
 * Переменные окружения (Settings → Variables and Secrets):
 *   BOT_TOKEN       (Secret)  токен от @BotFather
 *   CHAT_ID         (Text)    ваш chat_id (число)
 *   ALLOWED_ORIGIN  (Text)    адрес сайта без пути, напр. https://dasdsgn.github.io
 *                             несколько адресов через запятую
 */

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TG_LIMIT = 3900; // запас до лимита Telegram в 4096 символов

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
    const originOk = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": originOk && origin ? origin : (allowed[0] || "*"),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
    if (!originOk) return json({ ok: false, error: "origin" }, 403);
    if (!env.BOT_TOKEN || !env.CHAT_ID) return json({ ok: false, error: "worker not configured" }, 500);

    let form;
    try { form = await request.formData(); } catch { return json({ ok: false, error: "bad body" }, 400); }

    let data;
    try { data = JSON.parse(form.get("data") || ""); } catch { return json({ ok: false, error: "bad data" }, 400); }

    const files = form.getAll("files").filter(f => typeof f === "object" && f.size > 0);
    if (files.length > MAX_FILES) return json({ ok: false, error: "too many files" }, 400);
    if (files.some(f => f.size > MAX_FILE_BYTES)) return json({ ok: false, error: "file too large" }, 400);

    const api = (method, body) =>
      fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: "POST", body })
        .then(r => r.json());

    const jsonBody = obj => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(obj)) fd.append(k, v);
      return fd;
    };

    try {
      const messages = buildMessages(data);
      for (const text of messages) {
        const r = await api("sendMessage", jsonBody({
          chat_id: env.CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: "true",
        }));
        if (!r.ok) return json({ ok: false, error: "telegram: " + r.description }, 502);
      }
      for (const f of files) {
        const fd = new FormData();
        fd.append("chat_id", env.CHAT_ID);
        fd.append("caption", "📎 " + String(data.name || "").slice(0, 100));
        fd.append("document", f, f.name);
        const r = await api("sendDocument", fd);
        if (!r.ok) return json({ ok: false, error: "telegram file: " + r.description }, 502);
      }
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: "server" }, 500);
    }
  },
};

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s, n) => String(s ?? "").slice(0, n);

function buildMessages(d) {
  const head =
    `🆕 <b>Новый бриф</b>\n` +
    `👤 <b>${esc(clip(d.name, 120))}</b>\n` +
    (d.company ? `🏢 ${esc(clip(d.company, 160))}\n` : "") +
    `📞 ${esc(clip(d.contact, 160))}\n`;

  const blocks = [head];
  for (const s of (Array.isArray(d.sections) ? d.sections : []).slice(0, 12)) {
    blocks.push(`\n<b>━━ ${esc(clip(s.n, 4))} · ${esc(clip(s.title, 80))}</b>\n`);
    for (const it of (Array.isArray(s.items) ? s.items : []).slice(0, 20)) {
      let a = clip(it.a, 3000);
      blocks.push(`\n<b>${esc(clip(it.q, 200))}</b>\n${esc(a)}\n`);
    }
  }
  const meta = d.meta || {};
  blocks.push(`\n<i>стиль: ${esc(clip(meta.theme, 4))} · ${esc(clip(meta.tz, 40))}</i>`);

  // склеиваем блоки в сообщения не длиннее лимита
  const out = [];
  let cur = "";
  for (const b of blocks) {
    if ((cur + b).length > TG_LIMIT) { if (cur) out.push(cur); cur = b; }
    else cur += b;
  }
  if (cur) out.push(cur);
  return out;
}
