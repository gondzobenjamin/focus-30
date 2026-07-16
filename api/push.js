const webpush = require('web-push');
const { put, list, del } = require('@vercel/blob');

webpush.setVapidDetails(
  'mailto:benjamin.daniel0605@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const PREFIX = 'focus30-subs';

async function loadSubs() {
  const { blobs } = await list({ prefix: PREFIX });
  if (!blobs.length) return [];
  const latest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  const r = await fetch(latest.url);
  return r.ok ? r.json() : [];
}

async function saveSubs(subs) {
  const { blobs } = await list({ prefix: PREFIX });
  await put(`${PREFIX}.json`, JSON.stringify(subs), { access: 'public', addRandomSuffix: true });
  if (blobs.length) await del(blobs.map(b => b.url));
}

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.subscription && body.subscription.endpoint) {
      let subs = await loadSubs();
      subs = subs.filter(s => s.subscription.endpoint !== body.subscription.endpoint);
      subs.push({
        subscription: body.subscription,
        start: typeof body.start === 'number' ? body.start : 7,
        end: typeof body.end === 'number' ? body.end : 23.5
      });
      await saveSubs(subs);
      return res.json({ ok: true, count: subs.length });
    }
    if (body.unsubscribe) {
      let subs = await loadSubs();
      subs = subs.filter(s => s.subscription.endpoint !== body.unsubscribe);
      await saveSubs(subs);
      return res.json({ ok: true, count: subs.length });
    }
    return res.status(400).json({ error: 'bad request' });
  }

  if (req.method === 'GET') {
    if (req.query.key !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const subs = await loadSubs();
    const paris = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const h = paris.getHours() + (paris.getMinutes() >= 30 ? 0.5 : 0);
    let sent = 0, removed = 0;
    const keep = [];
    for (const s of subs) {
      const inWindow = s.start <= s.end ? (h >= s.start && h <= s.end) : (h >= s.start || h <= s.end);
      if (!inWindow) { keep.push(s); continue; }
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({
          title: 'Focus 30',
          body: 'Note ta dernière demi-heure ✍️'
        }));
        sent++;
        keep.push(s);
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) removed++;
        else keep.push(s);
      }
    }
    if (removed) await saveSubs(keep);
    return res.json({ ok: true, total: subs.length, sent, removed, hourParis: h });
  }

  return res.status(405).end();
};
