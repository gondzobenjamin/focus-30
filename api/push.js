const webpush = require('web-push');
const { put, list, del } = require('@vercel/blob');

webpush.setVapidDetails(
  'mailto:benjamin.daniel0605@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const SUBS = 'focus30-subs';
const META = 'focus30-meta';

async function loadJson(prefix, dflt) {
  const { blobs } = await list({ prefix });
  if (!blobs.length) return dflt;
  const latest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  const r = await fetch(latest.url);
  return r.ok ? r.json() : dflt;
}

async function saveJson(prefix, data) {
  const { blobs } = await list({ prefix });
  await put(`${prefix}.json`, JSON.stringify(data), { access: 'public', addRandomSuffix: true });
  if (blobs.length) await del(blobs.map(b => b.url));
}

const fmt = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + (m % 60 ? '30' : '00');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.subscription && body.subscription.endpoint) {
      let subs = await loadJson(SUBS, []);
      subs = subs.filter(s => s.subscription.endpoint !== body.subscription.endpoint);
      subs.push({
        subscription: body.subscription,
        start: typeof body.start === 'number' ? body.start : 7,
        end: typeof body.end === 'number' ? body.end : 23.5
      });
      await saveJson(SUBS, subs);
      return res.json({ ok: true, count: subs.length });
    }
    if (body.unsubscribe) {
      let subs = await loadJson(SUBS, []);
      subs = subs.filter(s => s.subscription.endpoint !== body.unsubscribe);
      await saveJson(SUBS, subs);
      return res.json({ ok: true, count: subs.length });
    }
    return res.status(400).json({ error: 'bad request' });
  }

  if (req.method === 'GET') {
    if (req.query.key !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // demi-heure courante, heure de Paris
    const paris = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const bmod = paris.getHours() * 60 + (paris.getMinutes() >= 30 ? 30 : 0); // frontière écoulée (min du jour)
    const h = bmod / 60;
    const key = `${paris.getFullYear()}-${paris.getMonth() + 1}-${paris.getDate()} ${fmt(bmod)}`;
    const blockStart = fmt((bmod - 30 + 1440) % 1440);
    const blockEnd = bmod === 0 ? '00:00' : fmt(bmod);

    // déduplication : un seul envoi par demi-heure, même si le cron appelle plusieurs fois
    const meta = await loadJson(META, {});
    if (meta.lastKey === key) {
      return res.json({ ok: true, dedup: true, key });
    }

    const subs = await loadJson(SUBS, []);
    let sent = 0, removed = 0;
    const keep = [];
    for (const s of subs) {
      const inWindow = s.start <= s.end ? (h >= s.start && h <= s.end) : (h >= s.start || h <= s.end);
      if (!inWindow) { keep.push(s); continue; }
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({
          title: `Focus 30 · ${blockStart} → ${blockEnd}`,
          body: `Qu'as-tu fait de ${blockStart} à ${blockEnd} ? ✍️`
        }));
        sent++;
        keep.push(s);
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) removed++;
        else keep.push(s);
      }
    }
    if (removed) await saveJson(SUBS, keep);
    await saveJson(META, { lastKey: key });
    return res.json({ ok: true, total: subs.length, sent, removed, key, block: `${blockStart}–${blockEnd}` });
  }

  return res.status(405).end();
};
