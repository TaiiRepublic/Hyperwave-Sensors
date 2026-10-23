/* Hyperwave Sensors Lite — shared detection code, built from the PC app source. */
(function () {
const defs = {}, cache = {};
function req(n) { if (cache[n]) return cache[n].exports; const m = cache[n] = { exports: {} }; defs[n](m, m.exports, req); return m.exports; }
defs["./store"] = function (module, exports, require) {
'use strict';
// Browser stand-in for src/store.js: the shared detection modules only need readJson/writeJson.
// Saved in this phone's browser storage; large files are skipped so storage never fills up.
const PREFIX = 'hws-lite-file:';
module.exports = {
  readJson(file, fallback) {
    try { const v = localStorage.getItem(PREFIX + file); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  writeJson(file, obj) {
    try { const s = JSON.stringify(obj); if (s.length < 900000) localStorage.setItem(PREFIX + file, s); } catch { /* full or blocked */ }
  }
};

};
defs["./detect"] = function (module, exports, require) {
'use strict';
// Bot / spam detection. Scores each chatter from several signals; nothing is ever
// banned automatically — anything at or above the threshold lands in the review list.

const SPAM_PATTERNS = [
  { re: /\b(best|cheap|cheapest|buy|get|real)\s+(viewers|followers|views|primes?|subs)\b/i, w: 60, why: 'Selling viewers/followers' },
  { re: /\bviewers?\s*(,|and|&|\+)\s*followers?\b|\bfollowers?\s*(,|and|&|\+)\s*(primes?|viewers?)\b/i, w: 60, why: 'Selling viewers/followers' },
  { re: /(dogehype|streamboo|bigfollows|streamrise|twitchboost|viewerlabs|kickbooster)/i, w: 70, why: 'Known promo-spam service' },
  { re: /remove\s+(the\s+)?spaces?|\(\s*dot\s*\)|\[\s*dot\s*\]/i, w: 45, why: 'Obfuscated link ("remove the space")' },
  { re: /\bbecome\s+(famous|a\s+partner)\b/i, w: 45, why: 'Growth-scam phrasing' },
  { re: /\b(i|we)\s+(can|will)\s+(help\s+you\s+)?(grow|boost|promote)\s+(your|ur)\s+(stream|channel)/i, w: 45, why: 'Growth-scam phrasing' },
  { re: /\b(promote|promotion)\s+(your|ur)\s+(stream|channel)\b/i, w: 40, why: 'Growth-scam phrasing' },
  { re: /\b(i'?m|i\s+am)\s+an?\s+(graphic\s+)?(designer|artist)\b.*\b(overlays?|emotes?|logos?|panels?|banners?)\b/i, w: 50, why: '"Emote artist" cold-pitch spam' },
  { re: /\b(only\s?fans|0nly\s?fans|nudes|18\+\s*(pics|content))\b/i, w: 70, why: 'Adult spam' },
  { re: /\b(crypto|bitcoin|btc|eth|nft)\s+(giveaway|airdrop|investment|signals?)\b/i, w: 60, why: 'Crypto scam phrasing' },
  { re: /\bcheck\s+(out\s+)?(my|our)\s+(bio|profile)\b/i, w: 25, why: '"Check my bio" bait' }
];
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\s?\.\s?(com|net|org|io|xyz|ru|shop|store|live|site|top|click|link|pro|cc|me)\b)/i;
const SAFE_LINK_RE = /(twitch\.tv|youtube\.com|youtu\.be|kick\.com|tiktok\.com|clips\.twitch|discord\.gg|streamelements\.com)/i;
const MIXED_SCRIPT_RE = /[A-Za-z][Ѐ-ӿͰ-Ͽ]|[Ѐ-ӿͰ-Ͽ][A-Za-z]/;
const FANCY_TEXT_RE = /[\u{1D400}-\u{1D7FF}]/u;

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

class Detector {
  constructor(getConfig, platform, channel) {
    this.getConfig = getConfig;
    this.platform = platform;
    this.channel = String(channel).toLowerCase();
    this.users = new Map();   // userKey -> record
    this.dup = new Map();     // normalized text -> { users:Set, first }
  }

  isAllowlisted(name) {
    const n = String(name || '').toLowerCase().replace(/^@/, '');
    if (!n) return false;
    if (n === this.channel.replace(/^@/, '')) return true;
    return this.getConfig().allowlist.some(a => a.toLowerCase() === n);
  }

  record(msg) {
    const k = msg.userId || msg.user;
    let r = this.users.get(k);
    if (!r) {
      r = { key: k, userId: msg.userId, user: msg.user, display: msg.display || msg.user, firstSeen: msg.ts,
            msgs: [], msgIds: [], count: 0, signals: new Map(), score: 0, flagged: false, status: 'open', accountCreated: null, sample: '' };
      this.users.set(k, r);
    }
    return r;
  }

  addSignal(r, id, weight, why) {
    if (r.signals.has(id)) return;
    r.signals.set(id, { weight, why });
    this.rescore(r);
  }

  rescore(r) {
    let s = 0;
    for (const v of r.signals.values()) s += v.weight;
    r.score = Math.min(100, s);
    const cfg = this.getConfig().detection;
    if (!r.flagged && r.score >= cfg.flagThreshold && (r.status === 'open' || r.status === 'watching')) {
      r.flagged = true;
      r.flaggedAt = Date.now();
    }
  }

  // Returns the user record (flagged or not). Protected users return null.
  onMessage(msg) {
    if (msg.isMod || msg.isOwner || msg.isVip || msg.isSub) return null;
    if (this.isAllowlisted(msg.user) || this.isAllowlisted(msg.display)) return null;
    const cfg = this.getConfig().detection;
    const r = this.record(msg);
    if (['ignored', 'banned', 'allowed'].includes(r.status)) return r;
    r.count++;
    r.lastSeen = msg.ts;
    r.msgs.push(msg.ts);
    if (msg.msgId) { r.msgIds.push(msg.msgId); if (r.msgIds.length > 50) r.msgIds.shift(); }
    while (r.msgs.length && msg.ts - r.msgs[0] > 20000) r.msgs.shift();
    if (!r.sample || r.signals.size === 0 || r.sample[0] === '(') r.sample = String(msg.text).slice(0, 200);
    if (r.kind === 'lurker') r.kind = 'chat'; // stopped lurking

    const text = String(msg.text || '');
    for (const p of SPAM_PATTERNS) {
      if (p.re.test(text)) { this.addSignal(r, 'spam:' + p.why, p.w, p.why); r.sample = text.slice(0, 200); }
    }
    if (LINK_RE.test(text) && !SAFE_LINK_RE.test(text)) {
      const first = msg.firstMsg || r.count === 1;
      this.addSignal(r, 'link', first ? 35 : 15, first ? 'Link in their first message' : 'Posted an outside link');
      r.sample = text.slice(0, 200);
    }
    if (MIXED_SCRIPT_RE.test(text)) this.addSignal(r, 'mixed', 30, 'Look-alike letters (mixed alphabets) to dodge filters');
    if (FANCY_TEXT_RE.test(text)) this.addSignal(r, 'fancy', 20, 'Styled "fancy" letters to dodge filters');
    if (r.msgs.length > 8) this.addSignal(r, 'rapid', 20, 'More than 8 messages in 20 seconds');

    // copy-paste waves across different accounts
    const norm = normalize(text);
    if (norm.length >= 20 && !/^\s*!/.test(text)) { // skip short hype lines and !commands
      const now = msg.ts;
      let d = this.dup.get(norm);
      if (!d || now - d.first > cfg.dupWindowSec * 1000) { d = { users: new Map(), first: now }; this.dup.set(norm, d); }
      d.users.set(r.key, r);
      if (d.users.size >= cfg.dupMinUsers) {
        for (const ur of d.users.values()) {
          this.addSignal(ur, 'dup', 35, `Copy-paste wave: same message from ${cfg.dupMinUsers}+ accounts within ${cfg.dupWindowSec}s`);
        }
      }
      if (this.dup.size > 2000) for (const [k2, v] of this.dup) { if (now - v.first > cfg.dupWindowSec * 1000) this.dup.delete(k2); }
    }
    return r;
  }

  // Supporting signal only — a new account alone never reaches the flag threshold.
  setAccountAge(userKey, createdIso) {
    const r = this.users.get(userKey);
    if (!r || !createdIso) return;
    r.accountCreated = createdIso;
    const days = (Date.now() - Date.parse(createdIso)) / 86400000;
    const cfg = this.getConfig().detection;
    if (days < 1) this.addSignal(r, 'age', 40, 'Account created less than a day ago');
    else if (days < cfg.newAccountDays) this.addSignal(r, 'age', 25, `Account is ${Math.floor(days)} day(s) old`);
  }

  // Known viewer-list bot sitting in the chatter list (Twitch lurker bots).
  flagLurker(user, userId, channels) {
    if (this.isAllowlisted(user)) return null;
    const r = this.record({ user, userId, display: user, ts: Date.now() });
    if (r.status !== 'open') return r;
    r.kind = 'lurker';
    r.sample = '(silent lurker — never chatted)';
    this.addSignal(r, 'lurker', 85, `Known viewer-list bot, sitting in ${channels.toLocaleString()} channels at once`);
    return r;
  }

  // Viewbot signals on a silent lurker. Keyed by user id when known so it merges with chat records.
  flagPresence(p, signals) {
    if (this.isAllowlisted(p.login) || this.isAllowlisted(p.display)) return null;
    if (p.id && this.users.has(p.login) && !this.users.has(p.id)) { // first seen by name, now we know the id
      const old = this.users.get(p.login); this.users.delete(p.login); old.key = p.id; old.userId = p.id; this.users.set(p.id, old);
    }
    const r = this.record({ user: p.login, userId: p.id || null, display: p.display || p.login, ts: Date.now() });
    if (r.status !== 'open' && r.status !== 'watching') return r;
    if (!r.count) { r.kind = 'lurker'; r.sample = `(silent lurker — in chat ${Math.max(1, Math.round((Date.now() - p.since) / 60000))} min, never typed)`; }
    for (const sg of signals) this.addSignal(r, sg.id, sg.w, sg.why);
    return r;
  }

  flagFollower(user, userId, createdIso, burstSize) {
    if (this.isAllowlisted(user)) return null;
    const r = this.record({ user, userId, display: user, ts: Date.now() });
    if (r.status !== 'open') return r;
    r.kind = 'follow';
    r.sample = '(followed during a follow burst)';
    this.addSignal(r, 'burst', 35, `Followed during a burst of ${burstSize} follows`);
    if (createdIso) this.setAccountAge(r.key, createdIso);
    return r;
  }

  flagged() {
    const out = [];
    for (const r of this.users.values()) {
      if (r.flagged && ['open', 'working', 'error', 'watching'].includes(r.status)) {
        out.push({
          key: r.key, userId: r.userId, user: r.user, display: r.display, score: r.score, kind: r.kind || 'chat',
          reasons: [...r.signals.values()].sort((a, b) => b.weight - a.weight).map(s => s.why),
          sample: r.sample, count: r.count, flaggedAt: r.flaggedAt, accountCreated: r.accountCreated,
          status: r.status, error: r.error || null, msgCount: r.msgIds.length, lastAction: r.lastAction || null
        });
      }
    }
    const rank = s => (s === 'watching' ? 1 : 0);
    return out.sort((a, b) => rank(a.status) - rank(b.status) || b.score - a.score || b.flaggedAt - a.flaggedAt);
  }

  handled() {
    const out = [];
    for (const r of this.users.values()) {
      if (r.flagged && ['banned', 'blocked', 'ignored', 'allowed'].includes(r.status)) {
        out.push({ key: r.key, user: r.user, display: r.display, status: r.status, lastAction: r.lastAction, score: r.score });
      }
    }
    return out.slice(-25).reverse();
  }

  setStatus(key, status, error) {
    const r = this.users.get(key);
    if (r) { r.status = status; r.error = error || null; }
    return r;
  }
}

module.exports = { Detector, SPAM_PATTERNS, normalize };

};
defs["./presence"] = function (module, exports, require) {
'use strict';
// Lurker / presence tracking — who is sitting in chat without typing, and which of them look
// like viewbot accounts.
//  • Twitch, your channel or one you mod: the full chatter list every minute (authoritative).
//  • Twitch, any other channel: chat JOIN/PART/NAMES (Twitch sends these for chats under ~1,000).
//  • TikTok: viewers as they join the LIVE (through TikFinity) — no "left" events.
//  • Kick / YouTube: not possible — neither platform shares who is watching.
const store = require('./store');

const DAY = 86400000;

class Presence {
  constructor(key, platform, channel) {
    this.platform = platform;
    this.channel = String(channel).toLowerCase().replace(/^@/, '');
    this.file = `viewers_${key}.json`;
    this.known = new Map(Object.entries(store.readJson(this.file, {}))); // login -> { first, last, streams, minutes }
    this.dirty = false;
    this.present = new Map();   // login -> { login, id, display, since, last }
    this.chatted = new Map();   // login -> first chat ts (this stream)
    this.converted = new Set(); // lurked for a while, then started chatting
    this.info = new Map();      // login -> { id, display, created, defaultAvatar, emptyBio } | null
    this.pending = new Set();
    this.joins = [];            // [{ t, login }] for join-wave detection
    this.waveMembers = new Map(); // login -> wave size
    this.mode = platform === 'twitch' ? 'irc' : platform === 'tiktok' ? 'joins' : null;
    this.streamStart = null;
    this.seenThisStream = new Set();
  }

  supported() { return this.mode !== null; }

  startStream(start) { this.streamStart = start; this.seenThisStream = new Set(this.present.keys()); this.chatted.clear(); this.converted.clear(); }
  endStream() {
    for (const login of this.seenThisStream) { const k = this.known.get(login); if (k) k.streams = (k.streams || 0) + 1; }
    this.dirty = true; this.save();
    this.streamStart = null; this.seenThisStream = new Set();
  }

  add(login, id, display, now = Date.now()) {
    login = String(login || '').toLowerCase();
    if (!login || /^justinfan\d+$/.test(login)) return false;
    let p = this.present.get(login);
    const isNew = !p;
    if (!p) { p = { login, id: id || null, display: display || login, since: now, last: now }; this.present.set(login, p); }
    p.last = now; if (id) p.id = id; if (display) p.display = display;
    if (this.streamStart) this.seenThisStream.add(login);
    if (!this.info.has(login) && this.platform === 'twitch') this.pending.add(login);
    const k = this.known.get(login);
    if (!k) { this.known.set(login, { first: now, last: now, streams: 0, minutes: 0 }); this.dirty = true; }
    return isNew;
  }

  // Full list from the mod-only chatters endpoint: replaces whatever IRC said.
  setAll(list) {
    this.mode = 'list';
    const now = Date.now();
    const keep = new Set();
    for (const u of list) { this.add(u.login, u.id, u.display, now); keep.add(String(u.login).toLowerCase()); }
    for (const login of [...this.present.keys()]) if (!keep.has(login)) this.present.delete(login);
  }

  // On (re)connect Twitch replays everyone already in chat as NAMES/JOINs, so joins only count
  // toward join waves after a 2-minute warm-up.
  warm() { this.warmUntil = Date.now() + ((typeof process !== 'undefined' && process.argv && process.argv.includes('--demo')) ? 20000 : 120000); }
  join(logins, now = Date.now(), initial = false) {
    const counts = !initial && this.streamStart && now > (this.warmUntil || 0);
    for (const l of logins) {
      if (this.add(l, null, null, now) && counts) this.joins.push({ t: now, login: String(l).toLowerCase() });
    }
  }
  part(logins) { if (this.mode === 'list') return; for (const l of logins) this.present.delete(String(l).toLowerCase()); }

  onChat(login, id, display, ts = Date.now()) {
    login = String(login || '').toLowerCase();
    if (!login) return;
    const p = this.present.get(login);
    if (!this.chatted.has(login)) {
      this.chatted.set(login, ts);
      if (p && ts - p.since > 5 * 60000) this.converted.add(login); // lurked 5+ min, then spoke
    }
    if (this.mode !== 'joins') this.add(login, id, display, ts); // chatting proves they're in chat
  }

  // TikTok has no "left" events — treat anyone not heard from in 30 min as gone.
  expire() {
    if (this.mode !== 'joins') return;
    const cutoff = Date.now() - 30 * 60000;
    for (const [l, p] of this.present) if (p.last < cutoff && !this.chatted.has(l)) this.present.delete(l);
  }

  tick(intervalMs) {
    const mins = intervalMs / 60000;
    const now = Date.now();
    for (const login of this.present.keys()) {
      const k = this.known.get(login);
      if (k) { k.minutes = (k.minutes || 0) + mins; k.last = now; }
    }
    this.dirty = true;
    this.expire();
  }

  // Twitch user lookups (100 per call) for account age / avatar / bio.
  async enrich(adapter) {
    if (!this.pending.size || !adapter.userInfo) return;
    const batch = [...this.pending].slice(0, 100);
    batch.forEach(l => this.pending.delete(l));
    try {
      const got = await adapter.userInfo(batch);
      for (const l of batch) this.info.set(l, got.get(l) || null);
      for (const [l, inf] of got) { const p = this.present.get(l); if (p && inf.id) { p.id = inf.id; p.display = inf.display || p.display; } }
    } catch { for (const l of batch) this.pending.add(l); }
  }

  lurkers(allowed) {
    const out = [];
    for (const p of this.present.values()) {
      if (this.chatted.has(p.login) || p.login === this.channel || allowed(p.login)) continue;
      out.push(p);
    }
    return out;
  }

  // Viewbot signals for current lurkers; calls flag(login, id, signals[]) for anyone with a signal.
  analyze({ allowed, knownBots, cfg, recentRaid, flag, alert }) {
    const now = Date.now();
    const lurk = this.lurkers(allowed);

    // join waves (only on the IRC/joins feed — the mod list has no join times)
    this.joins = this.joins.filter(j => now - j.t < cfg.joinWaveWindowSec * 1000 * 3);
    if (!recentRaid) {
      const win = this.joins.filter(j => now - j.t <= cfg.joinWaveWindowSec * 1000);
      if (win.length >= cfg.joinWaveCount && !this.waveAlerted) {
        this.waveAlerted = now;
        for (const j of win) this.waveMembers.set(j.login, win.length);
        alert('wave', `Join wave: ${win.length} accounts entered chat within ${cfg.joinWaveWindowSec}s with no raid.`);
      }
    }
    if (this.waveAlerted && now - this.waveAlerted > 300000) this.waveAlerted = 0;

    // same-day account clusters among lurkers
    const byDay = new Map();
    for (const p of lurk) {
      const inf = this.info.get(p.login);
      if (!inf || !inf.created) continue;
      const day = String(inf.created).slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(p.login);
    }
    const cluster = new Map();
    for (const [day, list] of byDay) if (list.length >= cfg.clusterMin) for (const l of list) cluster.set(l, { size: list.length, day });

    this.clusterOf = cluster;
    let flagged = 0;
    for (const p of lurk) {
      const sig = [];
      const ch = knownBots ? knownBots.get(p.login) || 0 : 0;
      if (ch >= cfg.lurkerMinChannels) sig.push({ id: 'lurker', w: 85, why: `Known viewer-list bot, sitting in ${ch.toLocaleString()} channels at once` });
      const inf = this.info.get(p.login);
      if (inf) {
        const days = inf.created ? (now - Date.parse(inf.created)) / DAY : null;
        if (days != null && days < 1) sig.push({ id: 'age', w: 40, why: 'Account created less than a day ago' });
        else if (days != null && days < cfg.newAccountDays) sig.push({ id: 'age', w: 25, why: `Account is ${Math.floor(days)} day(s) old` });
        if (inf.defaultAvatar && inf.emptyBio) sig.push({ id: 'blank', w: 15, why: 'Default avatar and empty bio' });
      }
      const c = cluster.get(p.login);
      if (c) sig.push({ id: 'cluster', w: 35, why: `One of ${c.size} lurkers whose accounts were all created on ${c.day}` });
      const wv = this.waveMembers.get(p.login);
      if (wv) sig.push({ id: 'wave', w: 20, why: `Arrived in a join wave of ${wv} accounts (no raid)` });
      if (sig.length) { const r = flag(p, sig); if (r && r.flagged) flagged++; }
    }
    return { flagged, clusters: [...byDay.entries()].filter(([, l]) => l.length >= cfg.clusterMin).map(([day, l]) => ({ day, count: l.length })) };
  }

  snapshot({ allowed, knownBots, cfg, viewers, flaggedKeys }) {
    if (!this.supported()) return { supported: false };
    const now = Date.now();
    let helpers = 0, bots = 0;
    for (const p of this.present.values()) {
      if (p.login === this.channel) continue;
      if (allowed(p.login)) helpers++;
      else if (knownBots && (knownBots.get(p.login) || 0) >= cfg.lurkerMinChannels) bots++;
    }
    const lurk = this.lurkers(allowed);
    const inChat = [...this.present.values()].filter(p => p.login !== this.channel && !allowed(p.login)).length;
    const chatting = inChat - lurk.length;
    let returning = 0;
    const list = lurk.map(p => {
      const k = this.known.get(p.login);
      const ret = !!(k && this.streamStart && k.first < this.streamStart - 60000) || !!(k && k.streams > 0);
      if (ret) returning++;
      const inf = this.info.get(p.login);
      const tags = [];
      const ch = knownBots ? knownBots.get(p.login) || 0 : 0;
      if (ch >= cfg.lurkerMinChannels) tags.push('Viewer-list bot');
      if (inf && inf.created && now - Date.parse(inf.created) < cfg.newAccountDays * DAY) tags.push('New account');
      if (inf && inf.defaultAvatar && inf.emptyBio) tags.push('Blank profile');
      if (this.clusterOf && this.clusterOf.has(p.login)) tags.push('Same-day cluster');
      if (this.waveMembers.has(p.login)) tags.push('Join wave');
      const key = p.id || p.login;
      return {
        login: p.login, display: p.display || p.login, watchedMin: Math.round((now - p.since) / 60000), returning: ret,
        pastStreams: k ? k.streams || 0 : 0, ageDays: inf && inf.created ? Math.floor((now - Date.parse(inf.created)) / DAY) : null, created: inf && inf.created || null,
        tags, flagged: flaggedKeys.has(key) || flaggedKeys.has(p.login)
      };
    }).sort((a, b) => (b.flagged - a.flagged) || b.watchedMin - a.watchedMin);
    const unlisted = this.mode === 'joins' || viewers == null ? null : Math.max(0, viewers - inChat - helpers);
    return {
      supported: true, mode: this.mode,
      inChat, chatting, lurking: lurk.length, helpers, knownBots: bots,
      unlisted, returningLurkers: returning, newLurkers: lurk.length - returning, converted: this.converted.size,
      flaggedLurkers: list.filter(x => x.flagged).length,
      list: list.slice(0, 150), total: list.length
    };
  }

  save() {
    if (!this.dirty) return;
    if (this.known.size > 40000) this.known = new Map([...this.known.entries()].sort((a, b) => b[1].last - a[1].last).slice(0, 30000));
    store.writeJson(this.file, Object.fromEntries(this.known));
    this.dirty = false;
  }
}

module.exports = { Presence };

};
window.HWS = { Detector: req('./detect').Detector, Presence: req('./presence').Presence };
})();
