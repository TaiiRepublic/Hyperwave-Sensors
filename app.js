'use strict';
/* Hyperwave Sensors Lite v0.0.13 — runs entirely on your phone. No PC.
   Twitch: chat scan (any channel), stats + lurkers + mod actions after "Log in with Twitch".
   YouTube: stats + chat scan with your API key; ban/delete after "Log in with Google" (optional).
   Everything is saved in this phone's browser only. Chat text comes from strangers: every
   value that reaches innerHTML goes through esc(). */

const VERSION = '0.0.13';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString());
const PLAT = { twitch: 'Twitch', youtube: 'YouTube' };
const SITE = window.HWS_LITE_CONFIG || {};
const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');
const POLL_MS = 60000;

// ------------------------------------------------------------------ saved settings (this phone only)
const KEY = 'hws-lite';
const DEFAULT_ALLOW = ['streamelements', 'nightbot', 'streamlabs', 'moobot', 'fossabot', 'wizebot', 'sery_bot', 'streamerbot', 'soundalerts',
  'kofistreambot', 'pokemoncommunitygame', 'frostytoolsdotcom', 'own3d', 'streamstickers', 'tangiabot', 'lumiastream', 'botrixoficial', 'blerp', 'buttsbot', 'restreambot', 'restream'];
const DEFAULTS = {
  twitch: { clientId: '', token: '', userId: '', login: '', scopes: [] },
  youtube: { apiKey: '', clientId: '', token: '', exp: 0, channelId: '', channelTitle: '' },
  channels: [], keepAwake: true, allowlist: DEFAULT_ALLOW,
  detection: { flagThreshold: 50, lurkerMinChannels: 50, followBurstCount: 8, followBurstWindowSec: 180, newAccountDays: 7, dupMinUsers: 3,
    dupWindowSec: 90, spikeMultiplier: 2.5, spikeMinJump: 25, clusterMin: 5, joinWaveCount: 15, joinWaveWindowSec: 60 }
};
let C = load();
function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* fresh */ }
  return { ...DEFAULTS, ...s, twitch: { ...DEFAULTS.twitch, ...(s.twitch || {}) }, youtube: { ...DEFAULTS.youtube, ...(s.youtube || {}) },
    detection: { ...DEFAULTS.detection, ...(s.detection || {}) }, allowlist: s.allowlist || DEFAULTS.allowlist.slice(), channels: s.channels || [] };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(C)); } catch { toast('This browser blocked saving (private mode?) — settings last until you close it.', true); } }
const getConfig = () => C;
const twitchClientId = () => C.twitch.clientId || SITE.twitchClientId || '';
const googleClientId = () => C.youtube.clientId || SITE.googleClientId || '';

// ------------------------------------------------------------------ helpers
function toast(text, bad) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = text;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), bad ? 7000 : 3500);
}
function ago(t) { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; }
function dur(ms) { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; }
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function request(url, opts = {}) {
  let res;
  try { res = await fetch(url, opts); } catch { throw new ApiError(0, 'No connection — check your internet.'); }
  const text = await res.text(); let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const m = (body && (body.message || (body.error && (body.error.message || body.error)))) || res.statusText;
    throw new ApiError(res.status, `${res.status} ${typeof m === 'string' ? m : JSON.stringify(m)}`);
  }
  return body;
}

// ------------------------------------------------------------------ logins (browser sign-in, no secrets)
const TWITCH_SCOPES = ['moderator:read:chatters', 'moderator:read:followers', 'moderator:manage:banned_users', 'moderator:manage:warnings',
  'moderator:manage:chat_messages', 'user:manage:blocked_users', 'user:read:moderated_channels'];
function randomState() { const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }
function loginTwitch() {
  if (!twitchClientId()) { toast('Add a Twitch Client ID in Settings first (see the steps there).', true); location.hash = '#settings'; return; }
  const st = 'tw.' + randomState(); sessionStorage.setItem('hws-lite-state', st);
  location.href = 'https://id.twitch.tv/oauth2/authorize?' + new URLSearchParams({ response_type: 'token', client_id: twitchClientId(), redirect_uri: REDIRECT, scope: TWITCH_SCOPES.join(' '), state: st, force_verify: 'true' });
}
function loginGoogle() {
  if (!googleClientId()) { toast('Add a Google OAuth Client ID in Settings first.', true); location.hash = '#settings'; return; }
  const st = 'yt.' + randomState(); sessionStorage.setItem('hws-lite-state', st);
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ response_type: 'token', client_id: googleClientId(), redirect_uri: REDIRECT, scope: 'https://www.googleapis.com/auth/youtube.force-ssl', state: st, include_granted_scopes: 'true' });
}
async function finishLogin() {
  if (!location.hash.includes('access_token=') && !location.hash.includes('error=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  const want = sessionStorage.getItem('hws-lite-state'); sessionStorage.removeItem('hws-lite-state');
  history.replaceState(null, '', location.pathname + '#settings');
  if (p.get('error')) { toast('Login cancelled: ' + (p.get('error_description') || p.get('error')).replace(/\+/g, ' '), true); return; }
  if (!want || p.get('state') !== want) { toast('Login link expired — try again.', true); return; }
  if (want.startsWith('tw.')) {
    C.twitch.token = p.get('access_token'); C.twitch.scopes = (p.get('scope') || '').split(/[ +]/);
    try {
      const me = await helix('/users', { user: true });
      C.twitch.userId = me.data[0].id; C.twitch.login = me.data[0].login; save();
      toast(`Twitch connected as ${me.data[0].display_name}  o7`);
      for (const sc of scanners.values()) if (sc.platform === 'twitch') sc.refreshInfo().catch(() => {});
    } catch (e) { toast('Twitch login failed: ' + e.message, true); }
  } else {
    C.youtube.token = p.get('access_token'); C.youtube.exp = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000;
    try {
      const me = await yt('/channels', { part: 'snippet', mine: 'true' }, { user: true });
      const ch = (me.items || [])[0]; C.youtube.channelId = ch ? ch.id : ''; C.youtube.channelTitle = ch ? ch.snippet.title : ''; save();
      toast(`YouTube connected${ch ? ' as ' + ch.snippet.title : ''}  o7`);
    } catch (e) { save(); toast('YouTube login: ' + e.message, true); }
  }
}

async function helix(path, { method = 'GET', body, user = false } = {}) {
  if (!C.twitch.token) throw new ApiError(401, user ? 'Log in with Twitch in Settings first' : 'Log in with Twitch in Settings for viewer counts');
  try {
    return await request('https://api.twitch.tv/helix' + path, { method, headers: { 'Client-Id': twitchClientId(), Authorization: 'Bearer ' + C.twitch.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (e.status === 401) { C.twitch.token = ''; save(); throw new ApiError(401, 'Twitch login expired — log in again in Settings'); }
    throw e;
  }
}
async function yt(path, params = {}, { method = 'GET', body, user = false } = {}) {
  const useTok = user || (C.youtube.token && Date.now() < C.youtube.exp - 60000);
  if (user && !(C.youtube.token && Date.now() < C.youtube.exp - 60000)) throw new ApiError(401, 'Log in with Google in Settings (logins last about an hour)');
  if (!useTok && !C.youtube.apiKey) throw new ApiError(0, 'Add your YouTube API key in Settings');
  const qs = new URLSearchParams(params); if (!useTok) qs.set('key', C.youtube.apiKey);
  return request(`https://www.googleapis.com/youtube/v3${path}?${qs}`, { method, headers: { ...(useTok ? { Authorization: 'Bearer ' + C.youtube.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
}

// known viewer-list bots (community list) — cached a day
let knownBots = null;
async function getKnownBots() {
  if (knownBots) return knownBots;
  try {
    const c = JSON.parse(localStorage.getItem('hws-lite-bots') || 'null');
    if (c && Date.now() - c.at < 86400000) return (knownBots = new Map(c.list));
  } catch { /* ignore */ }
  try {
    const b = await request('https://api.twitchinsights.net/v1/bots/all');
    const rows = Array.isArray(b) ? b : (b && (b.bots || b.data)) || [];
    const list = rows.map(r => Array.isArray(r) ? [String(r[0]).toLowerCase(), Number(r[1]) || 0] : [String(r.name || '').toLowerCase(), Number(r.channels) || 0]).filter(x => x[0]);
    knownBots = new Map(list);
    try { localStorage.setItem('hws-lite-bots', JSON.stringify({ at: Date.now(), list })); } catch { /* too big */ }
  } catch { knownBots = new Map(); }
  return knownBots;
}

// ------------------------------------------------------------------ Twitch
function parseTags(raw) {
  const t = {};
  for (const part of raw.split(';')) { const i = part.indexOf('='); t[i < 0 ? part : part.slice(0, i)] = i < 0 ? '' : part.slice(i + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\'); }
  return t;
}
class TwitchLite {
  constructor(channel, hooks) {
    this.platform = 'twitch';
    this.channel = String(channel).toLowerCase().trim().replace(/^.*twitch\.tv\//, '').replace(/^#/, '').replace(/[/?#].*$/, '');
    this.hooks = hooks; this.info = { id: '', display: this.channel, avatar: '' };
    this.powers = { mod: false }; this.ws = null; this.stopped = false; this.retry = 0;
    this.seenFollowers = null; this.followWindow = [];
  }
  link() { return `https://twitch.tv/${this.channel}`; }
  async start() { this.stopped = false; this.connect(); await this.refreshInfo().catch(e => this.hooks.onNotice(e.message)); }
  async refreshInfo() {
    if (!C.twitch.token) { this.hooks.onNotice('Chat scanning is on. Log in with Twitch (Settings) for viewer counts, lurkers and mod actions.'); return; }
    const u = ((await helix(`/users?login=${encodeURIComponent(this.channel)}`)).data || [])[0];
    if (!u) throw new Error(`Twitch channel "${this.channel}" not found`);
    this.info = { id: u.id, display: u.display_name, avatar: u.profile_image_url };
    this.powers.mod = C.twitch.userId === u.id;
    if (!this.powers.mod) {
      try { let after = ''; for (let i = 0; i < 5 && !this.powers.mod; i++) { const b = await helix(`/moderation/channels?user_id=${C.twitch.userId}&first=100${after ? '&after=' + after : ''}`, { user: true }); if ((b.data || []).some(d => d.broadcaster_id === u.id)) this.powers.mod = true; after = b.pagination && b.pagination.cursor; if (!after) break; } } catch { /* scope missing */ }
    }
  }
  caps() {
    const mod = this.powers.mod, li = !!C.twitch.token;
    return { ban: mod, timeout: mod, warn: mod, del: mod, block: li, why: mod ? '' : li ? 'You are not a mod here — only Block works.' : 'Log in with Twitch (Settings) and be a mod here to take action.' };
  }
  connect() {
    if (this.stopped) return;
    let ws; try { ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'); } catch { return; }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership'); ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`); ws.send(`JOIN #${this.channel}`);
      this.hooks.onChatState(true);
    };
    ws.onmessage = ev => { for (const line of String(ev.data).split('\r\n')) if (line) this.line(line); };
    ws.onclose = () => { this.hooks.onChatState(false); if (!this.stopped) setTimeout(() => this.connect(), Math.min(30000, 1000 * 2 ** this.retry++)); };
    ws.onerror = () => {};
  }
  reconnectIfDead() { if (!this.ws || this.ws.readyState > 1) { this.retry = 0; this.connect(); } }
  line(line) {
    if (line.startsWith('PING')) { this.ws.send('PONG :tmi.twitch.tv'); return; }
    let tags = {}, rest = line;
    if (rest[0] === '@') { const sp = rest.indexOf(' '); tags = parseTags(rest.slice(1, sp)); rest = rest.slice(sp + 1); }
    const names = rest.match(/^:\S+ 353 \S+ [=*@] #\S+ :(.*)$/);
    if (names) { this.hooks.onPresence('names', names[1].split(' ').filter(Boolean)); return; }
    const m = rest.match(/^:(\S+)\s+(\S+)\s+(\S+)(?:\s+:(.*))?$/); if (!m) return;
    const [, prefix, cmd, , trailing] = m;
    if (cmd === 'PRIVMSG') {
      const login = prefix.split('!')[0], badges = tags.badges || '';
      this.hooks.onMessage({ platform: 'twitch', userId: tags['user-id'] || login, user: login, display: tags['display-name'] || login, text: trailing || '', ts: Date.now(),
        firstMsg: tags['first-msg'] === '1', msgId: tags.id, isMod: tags.mod === '1' || /moderator\//.test(badges), isOwner: /broadcaster\//.test(badges), isVip: /vip\//.test(badges), isSub: tags.subscriber === '1' });
    } else if (cmd === 'JOIN' || cmd === 'PART') this.hooks.onPresence(cmd === 'JOIN' ? 'join' : 'part', [prefix.split('!')[0]]);
    else if (cmd === 'USERNOTICE' && tags['msg-id'] === 'raid') this.hooks.onEvent('raid', { from: tags['msg-param-displayName'] || tags.login, viewers: Number(tags['msg-param-viewerCount']) || 0 });
  }
  async poll() {
    if (!C.twitch.token) return null;
    if (!this.info.id) await this.refreshInfo();
    const st = ((await helix(`/streams?user_id=${this.info.id}`)).data || [])[0];
    let followers = null; try { followers = (await helix(`/channels/followers?broadcaster_id=${this.info.id}&first=1`)).total; } catch { /* ignore */ }
    return { live: !!st, viewers: st ? st.viewer_count : 0, title: st ? st.title : '', category: st ? st.game_name : '', startedAt: st ? st.started_at : null, followers, followersLabel: 'Followers' };
  }
  async modScan() {
    if (!this.powers.mod || !this.info.id) return { present: null, burst: null, chatters: null };
    const me = C.twitch.userId, names = []; let after = '', total = null;
    for (let i = 0; i < 10; i++) {
      const b = await helix(`/chat/chatters?broadcaster_id=${this.info.id}&moderator_id=${me}&first=1000${after ? '&after=' + after : ''}`, { user: true });
      total = b.total; for (const d of b.data || []) names.push({ login: d.user_login, id: d.user_id, display: d.user_name });
      after = b.pagination && b.pagination.cursor; if (!after) break;
    }
    let burst = null;
    const list = (await helix(`/channels/followers?broadcaster_id=${this.info.id}&first=100`, { user: true })).data || [];
    if (this.seenFollowers === null) this.seenFollowers = new Set(list.map(x => x.user_id));
    else {
      const det = C.detection;
      for (const x of list.filter(x => !this.seenFollowers.has(x.user_id))) { this.seenFollowers.add(x.user_id); this.followWindow.push({ ...x, t: Date.parse(x.followed_at) || Date.now() }); }
      this.followWindow = this.followWindow.filter(x => x.t >= Date.now() - det.followBurstWindowSec * 1000);
      if (this.followWindow.length >= det.followBurstCount) burst = this.followWindow.map(x => ({ login: x.user_login, id: x.user_id }));
    }
    return { present: names, burst, chatters: total };
  }
  async userInfo(logins) {
    const out = new Map(); if (!C.twitch.token) return out;
    for (let i = 0; i < logins.length; i += 100) {
      const chunk = logins.slice(i, i + 100).filter(l => /^[a-z0-9_]{1,25}$/.test(l)); if (!chunk.length) continue;
      for (const u of (await helix('/users?' + chunk.map(l => 'login=' + encodeURIComponent(l)).join('&'))).data || [])
        out.set(u.login, { id: u.id, display: u.display_name, created: u.created_at, defaultAvatar: /user-default-pictures/.test(u.profile_image_url || ''), emptyBio: !String(u.description || '').trim() });
    }
    return out;
  }
  async accountAges(ids) {
    const out = new Map(); if (!C.twitch.token) return out;
    const n = ids.filter(x => /^\d+$/.test(x)).slice(0, 100); if (!n.length) return out;
    for (const u of (await helix('/users?' + n.map(id => 'id=' + id).join('&'))).data || []) out.set(u.id, u.created_at);
    return out;
  }
  async ban(t, { duration, reason } = {}) {
    const data = { user_id: t.userId, reason: reason || 'Hyperwave Sensors: bot/spam' }; if (duration) data.duration = duration;
    await helix(`/moderation/bans?broadcaster_id=${this.info.id}&moderator_id=${C.twitch.userId}`, { method: 'POST', body: { data }, user: true });
  }
  async warn(t, { reason } = {}) { await helix(`/moderation/warnings?broadcaster_id=${this.info.id}&moderator_id=${C.twitch.userId}`, { method: 'POST', body: { data: { user_id: t.userId, reason: reason || 'Please keep chat spam-free.' } }, user: true }); }
  async deleteMessages(ids) { let n = 0; for (const id of ids) { try { await helix(`/moderation/chat?broadcaster_id=${this.info.id}&moderator_id=${C.twitch.userId}&message_id=${id}`, { method: 'DELETE', user: true }); n++; } catch (e) { if (e.status !== 404) throw e; } } return n; }
  async block(t) { await helix(`/users/blocks?target_user_id=${t.userId}&source_context=chat&reason=spam`, { method: 'PUT', user: true }); }
  stop() { this.stopped = true; try { this.ws && this.ws.close(); } catch { /* ignore */ } }
}

// ------------------------------------------------------------------ YouTube
class YouTubeLite {
  constructor(channel, hooks) {
    this.platform = 'youtube'; this.input = String(channel).trim(); this.hooks = hooks;
    const s = this.input; let m;
    this.parsed = (m = s.match(/(?:v=|youtu\.be\/|\/live\/)([A-Za-z0-9_-]{11})/)) ? { videoId: m[1] } : (m = s.match(/(UC[A-Za-z0-9_-]{22})/)) ? { channelId: m[1] }
      : { handle: '@' + s.replace(/^.*youtube\.com\//, '').replace(/^@/, '').replace(/[/?#].*$/, '') };
    this.channel = (this.parsed.handle || this.parsed.channelId || this.parsed.videoId).toLowerCase();
    this.info = { id: '', display: this.channel, avatar: '' };
    this.videoId = this.parsed.videoId || null; this.liveChatId = null; this.pageToken = null; this.chatTimer = null;
    this.lastSearch = 0; this.subs = null; this.stopped = false;
  }
  link() { return this.info.id ? `https://youtube.com/channel/${this.info.id}` : `https://youtube.com/${this.channel}`; }
  async start() {
    this.stopped = false;
    if (this.parsed.videoId) { const it = ((await yt('/videos', { part: 'snippet', id: this.parsed.videoId })).items || [])[0]; if (!it) throw new Error('YouTube video not found'); this.parsed.channelId = it.snippet.channelId; }
    const params = { part: 'snippet,statistics' }; if (this.parsed.channelId) params.id = this.parsed.channelId; else params.forHandle = this.parsed.handle;
    const ch = ((await yt('/channels', params)).items || [])[0]; if (!ch) throw new Error(`YouTube channel "${this.input}" not found`);
    this.info = { id: ch.id, display: ch.snippet.title, avatar: ch.snippet.thumbnails && ch.snippet.thumbnails.default && ch.snippet.thumbnails.default.url };
    this.subs = ch.statistics.hiddenSubscriberCount ? null : Number(ch.statistics.subscriberCount);
  }
  async refreshInfo() { /* nothing extra */ }
  caps() { const can = !!(C.youtube.token && Date.now() < C.youtube.exp - 60000); return { ban: can, timeout: can, warn: false, del: can, block: false, why: can ? 'YouTube has no Warn or Block in its API.' : 'Log in with Google in Settings to ban, time out or delete (owner or mod of this chat).' }; }
  async poll() {
    if (!this.info.id) await this.start();
    // Finding a live stream costs 100 quota units, so only every 15 minutes; paste a live link to skip the wait.
    if (!this.videoId && Date.now() - this.lastSearch > 900000) {
      this.lastSearch = Date.now();
      const it = ((await yt('/search', { part: 'id', channelId: this.info.id, eventType: 'live', type: 'video', maxResults: '1' })).items || [])[0];
      if (it) this.videoId = it.id.videoId;
    }
    let live = false, viewers = 0, title = '', startedAt = null;
    if (this.videoId) {
      const it = ((await yt('/videos', { part: 'liveStreamingDetails,snippet', id: this.videoId })).items || [])[0];
      const d = it && it.liveStreamingDetails;
      if (it && d && d.actualStartTime && !d.actualEndTime) {
        live = true; viewers = Number(d.concurrentViewers || 0); title = it.snippet.title; startedAt = d.actualStartTime;
        if (d.activeLiveChatId && d.activeLiveChatId !== this.liveChatId) { this.liveChatId = d.activeLiveChatId; this.pageToken = null; this.chat(); }
      } else { this.videoId = null; this.stopChat(); }
    }
    return { live, viewers, title, category: '', startedAt, followers: this.subs, followersLabel: 'Subscribers' };
  }
  chat() {
    this.stopChat();
    const loop = async () => {
      if (this.stopped || !this.liveChatId) return;
      let wait = 15000;
      try {
        const first = !this.pageToken;
        const p = { liveChatId: this.liveChatId, part: 'snippet,authorDetails', maxResults: '200' }; if (this.pageToken) p.pageToken = this.pageToken;
        const b = await yt('/liveChat/messages', p);
        this.pageToken = b.nextPageToken; wait = Math.max(15000, b.pollingIntervalMillis || 0); this.hooks.onChatState(true);
        if (!first) for (const it of b.items || []) {
          const a = it.authorDetails || {}; if (!it.snippet || it.snippet.type !== 'textMessageEvent') continue;
          this.hooks.onMessage({ platform: 'youtube', userId: a.channelId, user: (a.displayName || '').toLowerCase(), display: a.displayName, text: it.snippet.displayMessage || '',
            ts: Date.parse(it.snippet.publishedAt) || Date.now(), msgId: it.id, isMod: !!a.isChatModerator, isOwner: !!a.isChatOwner, isVip: false, isSub: !!a.isChatSponsor });
        }
      } catch (e) { this.hooks.onNotice('YouTube chat: ' + e.message); if (e.status === 403 || e.status === 404) wait = 120000; }
      this.chatTimer = setTimeout(loop, wait);
    };
    loop();
  }
  stopChat() { clearTimeout(this.chatTimer); this.chatTimer = null; this.hooks.onChatState(false); }
  reconnectIfDead() {}
  async modScan() { return { present: null, burst: null, chatters: null }; }
  async userInfo() { return new Map(); }
  async accountAges() { return new Map(); }
  async ban(t, { duration } = {}) {
    if (!this.liveChatId) throw new Error('No active YouTube live chat');
    const snippet = { liveChatId: this.liveChatId, type: duration ? 'temporary' : 'permanent', bannedUserDetails: { channelId: t.userId } }; if (duration) snippet.banDurationSeconds = String(duration);
    await yt('/liveChat/bans', { part: 'snippet' }, { method: 'POST', body: { snippet }, user: true });
  }
  async deleteMessages(ids) { let n = 0; for (const id of ids) { try { await yt('/liveChat/messages', { id }, { method: 'DELETE', user: true }); n++; } catch (e) { if (e.status !== 404) throw e; } } return n; }
  async warn() { throw new Error('YouTube has no Warn option'); }
  async block() { throw new Error('YouTube has no Block option'); }
  stop() { this.stopped = true; this.stopChat(); }
}

// ------------------------------------------------------------------ scanner (one per channel)
const keyFor = (p, c) => `${p}_${String(c).toLowerCase().replace(/[^a-z0-9_@.-]/g, '_')}`;
class Scanner {
  constructor(platform, channel) {
    this.platform = platform;
    const hooks = {
      onMessage: m => this.onMessage(m), onEvent: (t, d) => this.onEvent(t, d), onNotice: t => this.notice(t),
      onChatState: c => { if (c && !this.chat && this.presence) this.presence.warm(); this.chat = c; },
      onPresence: (t, l) => { if (t === 'part') this.presence.part(l); else this.presence.join(l, Date.now(), t === 'names'); }
    };
    this.a = platform === 'twitch' ? new TwitchLite(channel, hooks) : new YouTubeLite(channel, hooks);
    this.channel = this.a.channel; this.id = keyFor(platform, this.channel);
    this.det = new HWS.Detector(getConfig, platform, this.channel);
    this.presence = platform === 'twitch' ? new HWS.Presence(this.id, platform, this.channel) : null;
    this.status = 'starting'; this.error = null; this.notices = []; this.alerts = []; this.stats = null; this.chat = false;
    this.recent = new Map(); this.msgTimes = []; this.lastViewers = []; this.lastRaid = 0; this.lastSpike = 0; this.lastBurst = 0;
    this.session = null; this.offline = 0; this.timers = []; this.lurk = { clusters: [] };
    try { this.samples = JSON.parse(localStorage.getItem('hws-lite-s:' + this.id) || '[]').filter(s => s.t > Date.now() - 12 * 3600000); } catch { this.samples = []; }
  }
  notice(t) { if (this.notices[0] && this.notices[0].text === t) return; this.notices.unshift({ t: Date.now(), text: t }); this.notices.length = Math.min(this.notices.length, 6); }
  alert(type, text) { this.alerts.unshift({ t: Date.now(), type, text }); this.alerts.length = Math.min(this.alerts.length, 20); }
  async start() {
    try { await this.a.start(); this.status = 'ok'; } catch (e) { this.status = 'error'; this.error = e.message; }
    this.tick();
    this.timers.push(setInterval(() => this.tick(), POLL_MS));
    if (this.presence) this.timers.push(setInterval(() => this.presence.enrich(this.a), 5000));
  }
  async tick() { await this.poll(); await this.modScan(); if (this.presence) await this.lurkScan(); render(); }
  stop() { this.timers.forEach(clearInterval); this.a.stop(); if (this.presence) this.presence.save(); }
  onMessage(m) {
    const k = m.userId || m.user; this.recent.set(k, m.ts); this.msgTimes.push(m.ts);
    if (this.presence) this.presence.onChat(m.user, /^\d+$/.test(String(m.userId)) ? m.userId : null, m.display, m.ts);
    if (this.session) { this.session.chatters.add(k); this.session.msgs++; }
    const r = this.det.onMessage(m);
    if (r && r.flagged && !r.notified) { r.notified = true; if (curId === this.id) render(); }
  }
  onEvent(t, d) { if (t === 'raid') { this.lastRaid = Date.now(); this.alert('raid', `Raid from ${d.from} with ${d.viewers} viewers`); } }
  c10() { const cut = Date.now() - 600000; for (const [k, t] of this.recent) if (t < cut) this.recent.delete(k); return this.recent.size; }
  mpm() { const cut = Date.now() - 300000; while (this.msgTimes.length && this.msgTimes[0] < cut) this.msgTimes.shift(); return Math.round(this.msgTimes.length / 5 * 10) / 10; }
  async poll() {
    let st;
    try { st = await this.a.poll(); if (this.status === 'error') { this.status = 'ok'; this.error = null; } } catch (e) { this.status = 'error'; this.error = e.message; return; }
    const c10 = this.c10();
    this.stats = st ? { ...st, chatters10m: c10, msgsPerMin: this.mpm(), engagement: st.viewers ? c10 / st.viewers : null } : { live: null, chatters10m: c10, msgsPerMin: this.mpm() };
    if (!st) return;
    if (st.live) {
      this.offline = 0;
      if (!this.session) { this.session = { start: st.startedAt ? Date.parse(st.startedAt) : Date.now(), n: 0, sum: 0, peak: 0, chatters: new Set(), msgs: 0, f0: st.followers }; if (this.presence) this.presence.startStream(this.session.start); }
      const s = this.session; s.n++; s.sum += st.viewers; s.peak = Math.max(s.peak, st.viewers); s.f1 = st.followers;
      const lurking = this.presence ? this.presence.lurkers(l => this.det.isAllowlisted(l)).length : null;
      this.samples.push({ t: Date.now(), v: st.viewers, c: c10, ...(lurking != null ? { l: lurking } : {}) });
      this.samples = this.samples.filter(x => x.t > Date.now() - 12 * 3600000);
      try { localStorage.setItem('hws-lite-s:' + this.id, JSON.stringify(this.samples)); } catch { /* full */ }
      const prev = this.lastViewers.slice(-10), med = median(prev), d = C.detection;
      if (prev.length >= 5 && Date.now() - this.lastRaid > 600000 && Date.now() - this.lastSpike > 600000 && st.viewers >= Math.max(med * d.spikeMultiplier, med + d.spikeMinJump)) {
        this.lastSpike = Date.now(); this.alert('spike', `Viewer spike: ${Math.round(med)} → ${st.viewers} with no raid, while active chatters stayed at ${c10}.`);
      }
      this.lastViewers.push(st.viewers); if (this.lastViewers.length > 30) this.lastViewers.shift();
    } else if (this.session && ++this.offline >= 3) { if (this.presence) this.presence.endStream(); this.session = null; }
  }
  async modScan() {
    try {
      const r = await this.a.modScan();
      if (r.present && this.presence) this.presence.setAll(r.present);
      if (r.chatters != null) this.chatList = r.chatters;
      if (r.burst && Date.now() - this.lastBurst > 300000) {
        this.lastBurst = Date.now();
        this.alert('burst', `Follow burst: ${r.burst.length} new follows in ${C.detection.followBurstWindowSec / 60} min. Consider Shield Mode or followers-only chat.`);
        const ages = await this.a.accountAges(r.burst.map(b => b.id));
        for (const b of r.burst) this.det.flagFollower(b.login, b.id, ages.get(b.id), r.burst.length);
      }
    } catch (e) { if (e.status === 401 || e.status === 403) this.notice('Mod checks: ' + e.message); }
  }
  async lurkScan() {
    try {
      this.presence.tick(POLL_MS);
      const kb = await getKnownBots();
      this.lurk = this.presence.analyze({ allowed: l => this.det.isAllowlisted(l), knownBots: kb, cfg: C.detection, recentRaid: Date.now() - this.lastRaid < 600000,
        flag: (p, sig) => this.det.flagPresence(p, sig), alert: (t, x) => this.alert(t, x) });
      if (this.lurk.clusters.length && !this.alerts.some(a => a.type === 'cluster' && Date.now() - a.t < 1800000)) {
        const big = this.lurk.clusters.sort((a, b) => b.count - a.count)[0];
        this.alert('cluster', `Viewbot cluster: ${big.count} lurkers have accounts all created on ${big.day}.`);
      }
    } catch (e) { this.notice('Lurker scan: ' + e.message); }
  }
  lurkView() {
    if (!this.presence) return { supported: false };
    const flagged = new Set(this.det.flagged().map(f => String(f.key)));
    const v = this.presence.snapshot({ allowed: l => this.det.isAllowlisted(l), knownBots: knownBots || new Map(), cfg: C.detection, viewers: this.stats && this.stats.live ? this.stats.viewers : null, flaggedKeys: flagged });
    v.clusters = this.lurk.clusters || [];
    return v;
  }
  async act(key, action, opts = {}) {
    const r = this.det.users.get(key); if (!r) throw new Error('That account is no longer in the list');
    const caps = this.a.caps(), need = { ban: 'ban', timeout: 'timeout', warn: 'warn', delete: 'del', block: 'block' }[action];
    if (need && !caps[need]) throw new Error(caps.why || 'Not available here');
    const t = { userId: r.userId, user: r.user }; let label;
    r.status = 'working'; render();
    try {
      if (action === 'ban') { await this.a.ban(t, { reason: opts.reason }); r.status = 'banned'; label = 'Banned'; }
      else if (action === 'timeout') { const s = Number(opts.seconds) || 600; await this.a.ban(t, { duration: s }); r.status = 'watching'; label = `Timed out ${s >= 3600 ? s / 3600 + 'h' : s / 60 + 'm'}`; }
      else if (action === 'warn') { await this.a.warn(t, { reason: opts.reason }); r.status = 'watching'; label = 'Warned'; }
      else if (action === 'delete') { const n = await this.a.deleteMessages(r.msgIds.slice()); r.msgIds = []; r.status = 'watching'; label = `Deleted ${n} message${n === 1 ? '' : 's'}`; }
      else if (action === 'block') { await this.a.block(t); r.status = 'blocked'; label = 'Blocked'; }
      else if (action === 'watch') { r.status = 'watching'; label = 'Keeping watch'; }
      else if (action === 'dismiss') { r.status = 'ignored'; label = 'Marked not a bot'; }
      else if (action === 'allow') { const n = String(r.user || r.display).toLowerCase(); if (n && !C.allowlist.includes(n)) { C.allowlist.push(n); save(); } r.status = 'allowed'; label = 'Always allowed'; }
      r.lastAction = label; return label;
    } catch (e) { r.status = 'error'; r.error = e.message; throw e; } finally { render(); }
  }
}

const scanners = new Map();
function addScanner(platform, channel, persist = true) {
  channel = String(channel || '').trim(); if (!channel) throw new Error('Enter a channel name');
  if (platform === 'youtube' && !C.youtube.apiKey) throw new Error('YouTube needs your API key first — add it in Settings.');
  const sc = new Scanner(platform, channel);
  if (scanners.has(sc.id)) { sc.a.stop(); throw new Error('Already scanning that channel'); }
  scanners.set(sc.id, sc); sc.start();
  if (persist) { C.channels.push({ platform, channel: sc.channel }); save(); }
  return sc;
}
function removeScanner(id) { const sc = scanners.get(id); if (!sc) return; sc.stop(); scanners.delete(id); C.channels = C.channels.filter(c => keyFor(c.platform, c.channel) !== id); save(); }

// ------------------------------------------------------------------ keep scanning while open
let wake = null;
async function keepAwake() {
  if (!C.keepAwake || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || !scanners.size) return;
  try { if (!wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => {
  const note = $('#bgnote');
  if (document.visibilityState === 'visible') {
    if (hiddenAt && Date.now() - hiddenAt > 30000) {
      note.hidden = false; note.textContent = `Sensors was paused for ${dur(Date.now() - hiddenAt)} while the app was in the background — anything said in chat then wasn't scanned.`;
      setTimeout(() => { note.hidden = true; }, 9000);
    }
    hiddenAt = 0;
    for (const sc of scanners.values()) { sc.a.reconnectIfDead(); sc.tick(); }
    keepAwake();
  } else hiddenAt = Date.now();
});
let hiddenAt = 0;

// ------------------------------------------------------------------ UI
let curId = null, curTab = 'overview', platformPick = 'twitch', hold = false;
const view = () => $('#view');
function route() {
  closeMenu();
  const h = location.hash;
  const tab = h.startsWith('#settings') ? 'settings' : h.startsWith('#about') ? 'about' : 'home';
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  curId = h.startsWith('#c/') ? decodeURIComponent(h.slice(3)) : null;
  render(true);
}
window.addEventListener('hashchange', route);
setInterval(() => render(), 4000);

function render(force) {
  if (hold && !force) return;
  if (!$('#menu').hidden || !$('#modal').hidden) return;
  if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !force) return;
  const h = location.hash;
  if (h.startsWith('#settings')) { if (force) renderSettings(); return; }
  if (h.startsWith('#about')) { if (force) renderAbout(); return; }
  if (curId) return renderChannel(force);
  renderHome(force);
}

function setupBanner() {
  if (!twitchClientId()) return `<div class="panel powers limited" style="margin-bottom:14px"><span class="tag watch">Setup</span><span class="muted">Twitch chat scanning works now. For viewer counts, lurkers and ban/timeout, add a Twitch Client ID and log in — <a href="#settings">Settings</a>.</span></div>`;
  if (!C.twitch.token) return `<div class="panel powers limited" style="margin-bottom:14px"><span class="tag watch">Log in</span><span class="muted">Log in with Twitch for viewer counts, lurkers and mod actions.</span><button class="btn small amber" data-login="twitch" style="margin-left:auto">Log in with Twitch</button></div>`;
  return '';
}
function renderHome() {
  const list = [...scanners.values()];
  view().innerHTML = `
    <div class="hero"><div><h1>Sensors Lite</h1><p>Phone-only bot &amp; viewbot sensors. Scans while this app is open on screen.</p></div></div>
    ${setupBanner()}
    <form class="panel scanform" id="scanform" autocomplete="off">
      <div class="seg">${Object.keys(PLAT).map(p => `<button type="button" data-p="${p}" class="${p === platformPick ? 'on' : ''}">${PLAT[p]}</button>`).join('')}</div>
      <input type="text" id="chan" placeholder="${platformPick === 'twitch' ? 'Twitch channel — e.g. taiirepublic' : '@handle or live video link'}">
      <button class="btn primary" type="submit">Scan channel</button>
    </form>
    ${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : `<div class="panel empty"><b>NO CONTACTS ON SENSORS</b>Pick Twitch or YouTube and enter a channel.</div>`}
    <div class="note" style="margin-top:14px">Kick and TikTok need the PC app (Kick blocks phone browsers; TikTok goes through TikFinity on a PC).</div>`;
  $$('.seg button').forEach(b => b.onclick = () => { platformPick = b.dataset.p; render(true); $('#chan').focus(); });
  $('#scanform').onsubmit = e => { e.preventDefault(); try { const sc = addScanner(platformPick, $('#chan').value); location.hash = '#c/' + encodeURIComponent(sc.id); } catch (err) { toast(err.message, true); } };
  $$('.card').forEach(c => c.onclick = () => { location.hash = '#c/' + encodeURIComponent(c.dataset.id); });
  wireLogin();
}
function avatar(i) { const l = esc((i.display || '?').replace(/^@/, '')[0] || '?').toUpperCase(); return `<div class="avatar">${i.avatar ? `<img src="${esc(i.avatar)}" alt="" onerror="this.remove()">` : l}</div>`; }
function card(sc) {
  const st = sc.stats || {}, fl = sc.det.flagged().filter(f => f.status !== 'watching').length;
  const lurk = sc.presence ? sc.presence.lurkers(l => sc.det.isAllowlisted(l)).length : null;
  return `<div class="panel card" data-id="${esc(sc.id)}" data-p="${sc.platform}">
    <div class="card-top">${avatar(sc.a.info)}<div style="min-width:0"><div class="card-name">${esc(sc.a.info.display)}</div><span class="plat ${sc.platform}">${PLAT[sc.platform]}</span></div>
      <div class="tags">${st.live ? '<span class="tag live">Live</span>' : st.live === false ? '<span class="tag off">Offline</span>' : `<span class="tag">${sc.chat ? 'Chat linked' : '…'}</span>`}</div></div>
    <div class="card-stats" style="grid-template-columns:repeat(${lurk != null ? 4 : 3},1fr)">
      <div><div class="k">Viewers</div><div class="v">${fmt(st.viewers)}</div></div>
      <div><div class="k">Chatters</div><div class="v">${fmt(st.chatters10m)}</div></div>
      ${lurk != null ? `<div><div class="k">Lurkers</div><div class="v">${fmt(lurk)}</div></div>` : ''}
      <div><div class="k">${esc(st.followersLabel || 'Followers')}</div><div class="v">${fmt(st.followers)}</div></div></div>
    <div class="card-foot">${sc.status === 'error' ? `<span class="tag err">Error</span><span class="alertline" style="color:#ff8a92">${esc(sc.error)}</span>` : `<span class="flagcount ${fl ? '' : 'zero'}"><span class="dot"></span>${fl ? fl + ' flagged for review' : 'No flags'}</span>`}</div></div>`;
}
function tile(k, v, d, alertish) { return `<div class="panel tile ${alertish ? 'alertish' : ''}"><div class="k">${esc(k)}</div><div class="v mono">${esc(v)}</div>${d ? `<div class="delta">${esc(d)}</div>` : ''}</div>`; }

let flagHover = false;
function renderChannel(force) {
  const sc = scanners.get(curId); if (!sc) { location.hash = ''; return; }
  const st = sc.stats || {}, s = sc.session, caps = sc.a.caps(), flags = sc.det.flagged();
  const L = sc.lurkView();
  const tabs = [['overview', 'Overview', ''], ['flags', 'Flags', flags.length ? String(flags.length) : ''], ...(L.supported ? [['lurkers', 'Lurkers', fmt(L.lurking)]] : [])];
  if (!tabs.some(t => t[0] === curTab)) curTab = 'overview';
  if (curTab === 'flags' && flagHover && !force) return;
  const anyMod = caps.ban || caps.del || caps.block;
  let body = '';
  if (curTab === 'overview') {
    body = `<div class="tiles">
      ${tile('Viewers now', fmt(st.viewers))}${tile('Stream peak', fmt(s && s.peak))}${tile('Stream average', fmt(s && s.n ? Math.round(s.sum / s.n) : null))}
      ${tile('Active chatters', fmt(st.chatters10m), 'last 10 min')}${tile('Msgs / min', st.msgsPerMin ?? '—')}
      ${tile('Chat engagement', st.engagement != null ? (st.engagement > 1 ? '100%+' : (st.engagement * 100).toFixed(1) + '%') : '—', 'chatters ÷ viewers')}
      ${tile(st.followersLabel || 'Followers', fmt(st.followers), s && s.f0 != null && s.f1 != null ? (s.f1 - s.f0 >= 0 ? '+' : '') + (s.f1 - s.f0) + ' this stream' : '')}
      ${tile('Flagged', fmt(flags.length), '', flags.length > 0)}</div>
    <div class="panel"><div class="panel-h"><h3>Viewers · last 12h</h3><div class="legend"><span><i style="background:var(--crimson)"></i>Viewers</span><span><i style="background:var(--cyan)"></i>Chatters</span>${sc.presence ? '<span><i style="background:var(--amber)"></i>Lurkers</span>' : ''}</div></div>
      <div class="panel-b">${spark(sc.samples)}</div></div>
    <div class="panel" style="margin-top:14px"><div class="panel-h"><h3>Sensor alerts</h3></div>
      ${sc.alerts.length ? `<ul class="feed">${sc.alerts.slice(0, 8).map(a => `<li><span class="ic ${esc(a.type)}"></span><span style="flex:1">${esc(a.text)}</span><span class="when">${ago(a.t)}</span></li>`).join('')}</ul>` : '<div class="empty" style="padding:14px">All quiet.</div>'}</div>
    ${sc.notices.length ? `<div class="panel" style="margin-top:14px"><div class="panel-h"><h3>Notes</h3></div><ul class="feed">${sc.notices.map(n => `<li><span class="ic"></span><span style="flex:1">${esc(n.text)}</span></li>`).join('')}</ul></div>` : ''}`;
  } else if (curTab === 'flags') {
    body = `<div class="panel" id="flagpanel">${flags.length ? flags.map(flagRow).join('') : '<div class="empty"><b>NO HOSTILES DETECTED</b>Suspicious chatters and viewbot lurkers show up here with options.</div>'}</div>`;
  } else {
    const parts = [['Chatting', L.chatting, 'var(--cyan)'], ['Lurking', L.lurking - (L.knownBots || 0), 'var(--amber)'], ['Viewer-list bots', L.knownBots, 'var(--crimson)'], ['Not in chat list', L.unlisted, '#56607a']];
    const tot = parts.reduce((a, p) => a + (p[1] || 0), 0) || 1;
    body = `<div class="tiles">${tile('In chat list', fmt(L.inChat))}${tile('Chatting', fmt(L.chatting))}${tile('Lurking', fmt(L.lurking))}${tile('Flagged viewbots', fmt(L.flaggedLurkers), '', L.flaggedLurkers > 0)}</div>
      <div class="panel"><div class="panel-b"><div class="stack" style="height:14px">${parts.filter(p => p[1]).map(p => `<i style="width:${p[1] / tot * 100}%;background:${p[2]}"></i>`).join('')}</div>
        <div class="roles">${parts.filter(p => p[1] != null).map(p => `<span><i style="background:${p[2]}"></i>${p[0]} ${fmt(p[1])}</span>`).join('')}</div>
        <div class="note">${L.mode === 'list' ? 'Full chatter list (you mod this channel).' : 'Built from chat joins/leaves — Twitch shares these for chats under ~1,000 people. Mod the channel for the full list.'}</div>
        ${(L.clusters || []).map(c => `<div class="note warn"><b>${fmt(c.count)} lurkers</b> have accounts all created on <b>${esc(c.day)}</b> — classic viewbot-farm sign.</div>`).join('')}</div></div>
      <div class="panel" style="margin-top:14px"><div class="panel-h"><h3>Lurkers</h3><span class="dim" style="font-size:12px">${fmt(L.total)} silent</span></div>
        ${(L.list || []).length ? `<ul class="lurklist">${L.list.slice(0, 120).map(x => `<li class="${x.flagged ? 'flg' : ''}"><b>${esc(x.display)}</b><span class="dim">${dur(x.watchedMin * 60000)}${x.ageDays != null ? ' · ' + (x.ageDays < 1 ? 'new today' : x.ageDays + 'd old') : ''}</span>${x.tags.map(t => `<span class="reason">${esc(t)}</span>`).join('')}</li>`).join('')}</ul>` : '<div class="empty" style="padding:14px">Nobody lurking right now.</div>'}</div>`;
  }
  const head = `<a class="back" href="#">‹ All sensors</a>
    <div class="dhead">${avatar(sc.a.info)}<div style="min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h1>${esc(sc.a.info.display)}</h1><span class="plat ${sc.platform}">${PLAT[sc.platform]}</span>
      ${st.live ? '<span class="tag live">Live</span>' : st.live === false ? '<span class="tag off">Offline</span>' : ''}${sc.chat ? '<span class="tag">Chat linked</span>' : '<span class="tag off">Chat not linked</span>'}</div>
      <div class="sub">${esc([st.title, st.category].filter(Boolean).join(' · ') || (sc.status === 'error' ? sc.error : ''))}</div></div>
      <div class="actions"><a class="btn ghost" href="${esc(sc.a.link())}" target="_blank" rel="noopener">Open ↗</a><button class="btn danger" id="rm">Stop</button></div></div>
    ${setupBanner()}
    <div class="panel powers ${anyMod ? '' : 'limited'}">${anyMod ? '<span class="tag" style="color:var(--cyan);border-color:rgba(58,209,232,.4)">Mod tools on</span>' : '<span class="tag watch">Review only</span>'}<span class="muted">${esc(caps.why || 'You can act on flagged accounts here.')}</span></div>
    <div class="dtabs">${tabs.map(([k, l, b]) => `<button data-t="${k}" class="${curTab === k ? 'on' : ''}">${l}${b ? `<span class="tb ${k === 'flags' ? 'red' : ''}">${esc(b)}</span>` : ''}</button>`).join('')}</div>`;
  const y = window.scrollY;
  view().innerHTML = head + body;
  window.scrollTo(0, y);
  $$('.dtabs button').forEach(b => b.onclick = () => { curTab = b.dataset.t; flagHover = false; render(true); window.scrollTo(0, 0); });
  $('#rm').onclick = () => confirmBox(`Stop scanning ${sc.a.info.display}?`, 'You can add it again any time.', 'Stop', () => { removeScanner(sc.id); location.hash = ''; });
  const fp = $('#flagpanel');
  if (fp) { fp.ontouchstart = fp.onmouseenter = () => { flagHover = true; }; fp.onmouseleave = () => { flagHover = false; }; }
  $$('.optbtn').forEach(b => b.onclick = e => { e.stopPropagation(); const k = b.closest('.flag').dataset.key; openMenu(b, sc, flags.find(f => String(f.key) === k)); });
  wireLogin();
}
function flagRow(f) {
  const kind = { chat: 'Chat', lurker: 'Lurker', follow: 'Follow burst' }[f.kind] || f.kind;
  const age = f.accountCreated ? Math.floor((Date.now() - Date.parse(f.accountCreated)) / 86400000) : null;
  return `<div class="flag ${f.status === 'watching' ? 'watching' : ''}" data-key="${esc(f.key)}" style="grid-template-columns:48px minmax(0,1fr)">
    <div class="score ${f.score >= 80 ? 'hi' : 'mid'}"><div>${f.score}<small>RISK</small></div></div>
    <div style="min-width:0"><div class="fname"><b>${esc(f.display)}</b><span class="tag">${esc(kind)}</span>${f.status === 'watching' ? '<span class="tag watch">Watching</span>' : ''}${f.status === 'working' ? '<span class="tag">Working…</span>' : ''}</div>
      <div class="reasons">${f.reasons.map(r => `<span class="reason">${esc(r)}</span>`).join('')}</div>
      <div class="sample">${esc(f.sample)}</div>
      <div class="fmeta">${f.count ? `<span>${f.count} msg${f.count === 1 ? '' : 's'}</span>` : ''}${age != null ? `<span>Account ${age < 1 ? 'under a day' : age + 'd'} old</span>` : ''}<span>${ago(f.flaggedAt)} ago</span>${f.lastAction ? `<span class="last">${esc(f.lastAction)}</span>` : ''}${f.error ? `<span class="err">${esc(f.error)}</span>` : ''}</div>
      <button class="btn small amber fbtn optbtn" style="margin-top:8px">Options ▾</button></div></div>`;
}
function spark(samples) {
  if (!samples || samples.length < 2) return '<div class="empty" style="padding:10px">One reading a minute while live — fills in as you go.</div>';
  const W = 1000, H = 180, T = 8, B = 18, max = Math.max(5, ...samples.map(s => Math.max(s.v || 0, s.c || 0, s.l || 0)));
  const t0 = samples[0].t, t1 = samples[samples.length - 1].t;
  const x = t => ((t - t0) / Math.max(1, t1 - t0)) * W, y = v => T + (1 - v / max) * (H - T - B);
  const path = k => samples.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s[k] || 0).toFixed(1)}`).join('');
  return `<svg class="act" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:180px">
    <line x1="0" x2="${W}" y1="${y(max)}" y2="${y(max)}" stroke="var(--line)"/><text x="4" y="${y(max) + 12}" fill="var(--dim)" font-size="11">${fmt(max)}</text>
    <path d="${path('v')}" fill="none" stroke="#e0303f" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <path d="${path('c')}" fill="none" stroke="#3ad1e8" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>
    ${samples.some(s => s.l != null) ? `<path d="${path('l')}" fill="none" stroke="#f5a524" stroke-width="1.4" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>` : ''}</svg>
    <div class="actax dim"><span>${new Date(t0).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span><span>${new Date(t1).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></div>`;
}

// options menu
const ACTIONS = [
  { a: 'ban', label: 'Ban', ico: '⦸', cap: 'ban', danger: true },
  { a: 'timeout', label: 'Timeout', ico: '◷', cap: 'timeout', sub: [[60, '1m'], [600, '10m'], [3600, '1h'], [86400, '24h']] },
  { a: 'warn', label: 'Warn', ico: '!', cap: 'warn' },
  { a: 'delete', label: 'Delete their messages', ico: '⌫', cap: 'del' },
  { a: 'block', label: 'Block (from your account)', ico: '⊘', cap: 'block', danger: true }, '-',
  { a: 'watch', label: 'Keep watching', ico: '◉' }, { a: 'dismiss', label: 'Not a bot — dismiss', ico: '✓' }, { a: 'allow', label: 'Always allow', ico: '★' }, '-',
  { a: 'profile', label: 'Open profile (to report)', ico: '↗' }, { a: 'copy', label: 'Copy name', ico: '⧉' }];
function openMenu(anchor, sc, f) {
  closeMenu(); if (!f) return;
  const caps = sc.a.caps(), m = $('#menu');
  let html = `<div class="mh">${esc(f.display)}</div>`;
  for (const it of ACTIONS) {
    if (it === '-') { html += '<hr>'; continue; }
    let dis = it.cap && !caps[it.cap]; if (!dis && it.a === 'delete' && !f.msgCount) dis = true;
    if (it.sub) html += `<button disabled style="opacity:${dis ? .4 : 1};cursor:default"><span class="ico">${it.ico}</span>${it.label}</button><div class="sub">${it.sub.map(([s, l]) => `<button data-a="timeout" data-s="${s}" ${dis ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
    else html += `<button data-a="${it.a}" class="${it.danger ? 'danger' : ''}" ${dis ? 'disabled' : ''}><span class="ico">${it.ico}</span>${it.label}</button>`;
  }
  if (caps.why) html += `<hr><div class="why">${esc(caps.why)}</div>`;
  m.innerHTML = html; m.hidden = false;
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - mw - 8)) + 'px';
  m.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  $$('button[data-a]', m).forEach(b => b.onclick = () => { closeMenu(); run(sc, f, b.dataset.a, b.dataset.s ? Number(b.dataset.s) : null); });
}
function closeMenu() { const m = $('#menu'); if (m) { m.hidden = true; m.innerHTML = ''; } }
document.addEventListener('click', e => { if (!e.target.closest('#menu')) closeMenu(); });
async function run(sc, f, a, secs) {
  if (a === 'profile') { window.open(sc.platform === 'twitch' ? `https://twitch.tv/${encodeURIComponent(f.user)}` : `https://youtube.com/channel/${encodeURIComponent(f.userId)}`, '_blank', 'noopener'); return; }
  if (a === 'copy') { try { await navigator.clipboard.writeText(f.display); toast('Copied ' + f.display); } catch { toast('Copy blocked', true); } return; }
  const go = async (o = {}) => { try { toast(`${await sc.act(f.key, a, { ...o, seconds: secs })}: ${f.display}`); } catch (e) { toast(e.message, true); } flagHover = false; render(true); };
  if (a === 'ban') return confirmBox(`Ban ${f.display}?`, `Permanently bans from this ${PLAT[sc.platform]} chat.`, 'Ban', go, 'Reason (optional)', 'Bot / spam account');
  if (a === 'block') return confirmBox(`Block ${f.display}?`, 'Blocks them from your Twitch account.', 'Block', go);
  if (a === 'warn') return confirmBox(`Warn ${f.display}?`, 'Twitch shows the warning; they must acknowledge it before chatting again.', 'Send warning', go, 'Warning message', 'Please keep chat spam-free.');
  go();
}
function confirmBox(title, text, ok, onOk, inputLabel, def) {
  const m = $('#modal'), c = $('.modal-card', m);
  c.innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p>${inputLabel ? `<div class="field"><label>${esc(inputLabel)}</label><input type="text" id="mIn" value="${esc(def || '')}"></div>` : ''}
    <div class="row"><button class="btn ghost" id="mNo">Cancel</button><button class="btn primary" id="mOk">${esc(ok)}</button></div>`;
  m.hidden = false;
  const close = () => { m.hidden = true; };
  $('#mNo').onclick = close; m.onclick = e => { if (e.target === m) close(); };
  $('#mOk').onclick = () => { const v = $('#mIn') ? $('#mIn').value.trim() : undefined; close(); onOk(v !== undefined ? { reason: v } : {}); };
}

// ------------------------------------------------------------------ settings
const fv = v => `<span class="fv">${esc(v)}<button class="copy" data-copy="${esc(v)}" title="Copy">⧉</button></span>`;
function renderSettings() {
  const t = C.twitch, y = C.youtube, siteTw = !!SITE.twitchClientId, ytTok = y.token && Date.now() < y.exp - 60000;
  view().innerHTML = `
    <div class="hero"><div><h1>Settings</h1><p>Saved on this phone only.</p></div></div>
    <div class="settings">
      <div class="panel"><div class="panel-h"><span class="plat twitch">Twitch</span><h3>Stats, lurkers, mod actions</h3></div><div class="panel-b">
        ${siteTw ? '' : `<ol class="steps">
          <li>On a computer or your phone, open <a href="https://dev.twitch.tv/console/apps/create" target="_blank" rel="noopener">dev.twitch.tv → Register Your Application</a>.</li>
          <li><b>Name:</b> ${fv('Hyperwave Sensors Lite')} · <b>OAuth Redirect URLs:</b> ${fv(REDIRECT)}</li>
          <li><b>Category:</b> ${fv('Application Integration')} · <b>Client Type:</b> ${fv('Public')} → <b>Create</b>.</li>
          <li>Click <b>Manage</b>, copy the <b>Client ID</b> and paste it below. <span class="dim">No secret needed.</span></li>
        </ol>
        <div class="inline-form"><input type="text" id="twcid" placeholder="Twitch Client ID" value="${esc(t.clientId)}"><button class="btn" id="twcidSave">Save</button></div>`}
        <div class="conn"><span class="state ${t.token ? 'on' : ''}">${t.token ? `● Logged in as <b>${esc(t.login)}</b>` : '○ Not logged in'}</span>
          <button class="btn ${t.token ? 'ghost' : 'amber'}" data-login="twitch">${t.token ? 'Log in again' : 'Log in with Twitch'}</button>${t.token ? '<button class="btn ghost" id="twOut">Log out</button>' : ''}</div>
        <div class="note">Chat scanning works on any channel without logging in. Mod tools turn on for your channel and channels you mod.</div>
      </div></div>
      <div class="panel"><div class="panel-h"><span class="plat youtube">YouTube</span><h3>Stats + chat scan</h3></div><div class="panel-b">
        <ol class="steps">
          <li>Follow Part A of the YouTube setup guide in the PC app, or: <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener">enable YouTube Data API v3</a> → <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credentials</a> → <b>+ Create credentials → API key</b> (restrict it to YouTube Data API v3).</li>
          <li>Paste the key below.</li>
        </ol>
        <div class="inline-form"><input type="password" id="ytkey" placeholder="YouTube API key" value="${esc(y.apiKey)}"><button class="btn" id="ytkeySave">Save</button></div>
        <details class="manual"><summary>Optional: ban / delete in your own YouTube chat</summary>
          <ol class="steps"><li>In your Google project's <b>Clients</b>, create a <b>Web application</b> client with <b>Authorized JavaScript origins</b> ${fv(location.origin)} and <b>Authorized redirect URIs</b> ${fv(REDIRECT)}.</li>
            <li>Add your Gmail under <b>Audience → Test users</b>. Paste the Client ID below, then log in. <span class="dim">Google logins in the browser last about an hour.</span></li></ol>
          <div class="inline-form"><input type="text" id="gcid" placeholder="Google OAuth Client ID" value="${esc(y.clientId)}"><button class="btn" id="gcidSave">Save</button></div>
          <div class="conn"><span class="state ${ytTok ? 'on' : ''}">${ytTok ? `● Logged in${y.channelTitle ? ' as <b>' + esc(y.channelTitle) + '</b>' : ''}` : '○ Not logged in'}</span><button class="btn amber" data-login="google">Log in with Google</button></div>
        </details>
      </div></div>
      <div class="panel"><div class="panel-h"><h3>While scanning</h3></div><div class="panel-b">
        <label class="switch" style="text-transform:none;letter-spacing:0;font-family:var(--body);font-size:14px;color:var(--text)"><input type="checkbox" id="awake" ${C.keepAwake ? 'checked' : ''}> Keep the screen on while channels are being scanned</label>
        <div class="note">Phones pause web apps in the background or when the screen locks. Keep Sensors Lite open (it can sit on a stand next to you) — for all-stream scanning with history, use the PC app.</div>
      </div></div>
      <div class="panel"><div class="panel-h"><h3>Protected accounts</h3></div><div class="panel-b">
        <div class="chips">${C.allowlist.map(a => `<span class="chip">${esc(a)}<button data-rm="${esc(a)}">×</button></span>`).join('')}</div>
        <div class="inline-form"><input type="text" id="allow" placeholder="Add a bot or name"><button class="btn" id="allowAdd">Add</button></div>
      </div></div>
      <div class="panel"><div class="panel-h"><h3>Reset</h3></div><div class="panel-b"><button class="btn danger" id="reset">Clear everything on this phone</button></div></div>
    </div>`;
  const val = id => ($('#' + id) ? $('#' + id).value.trim() : '');
  const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
  on('twcidSave', () => { C.twitch.clientId = val('twcid'); C.twitch.token = ''; save(); toast('Saved'); renderSettings(); });
  on('twOut', () => { C.twitch.token = ''; C.twitch.userId = ''; C.twitch.login = ''; save(); renderSettings(); });
  on('ytkeySave', async () => {
    C.youtube.apiKey = val('ytkey'); save();
    try { await request('https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=%40YouTube&key=' + encodeURIComponent(C.youtube.apiKey)); toast('Key works  o7'); }
    catch (e) { toast(/not been used|disabled/i.test(e.message) ? 'YouTube Data API v3 isn\'t enabled for this key\'s project yet.' : 'Key test failed: ' + e.message, true); }
  });
  on('gcidSave', () => { C.youtube.clientId = val('gcid'); save(); toast('Saved'); });
  $('#awake').onchange = e => { C.keepAwake = e.target.checked; save(); keepAwake(); };
  on('allowAdd', () => { const v = val('allow').toLowerCase().replace(/^@/, ''); if (v && !C.allowlist.includes(v)) { C.allowlist.push(v); save(); } renderSettings(); });
  $$('[data-rm]').forEach(b => b.onclick = () => { C.allowlist = C.allowlist.filter(a => a !== b.dataset.rm); save(); renderSettings(); });
  on('reset', () => confirmBox('Clear everything?', 'Removes logins, keys, channels and saved readings from this phone.', 'Clear', () => {
    for (const sc of scanners.values()) sc.stop(); scanners.clear();
    try { Object.keys(localStorage).filter(k => k.startsWith('hws-lite')).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
    C = load(); location.hash = ''; route();
  }));
  $$('.copy').forEach(b => b.onclick = async e => { e.preventDefault(); try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied'); } catch { toast('Copy blocked', true); } });
  wireLogin();
}
function wireLogin() { $$('[data-login]').forEach(b => b.onclick = () => (b.dataset.login === 'twitch' ? loginTwitch() : loginGoogle())); }

// ------------------------------------------------------------------ about
async function renderAbout() {
  let A = {}; try { A = await (await fetch('about.json', { cache: 'no-store' })).json(); } catch { /* defaults */ }
  const safe = u => (/^https:\/\//i.test(u || '') ? u : '');
  const links = [[safe(A.tip), A.tipLabel || 'Leave a tip', 'btn tipbtn'], [safe(A.feedback), 'Send feedback', 'btn primary'], [safe(A.twitch), 'Twitch', 'btn'], [safe(A.kick), 'Kick', 'btn']].filter(l => l[0]);
  view().innerHTML = `<section class="panel aboutp"><div class="panel-h"><h3>About</h3></div><div class="panel-b aboutgrid"><div>
      <div class="abhead"><img class="ablogo" src="taii-logo.png" alt="TaiiRepublic logo"><p class="abtext">${esc(A.about || '')}</p></div>
      <div class="abbtns">${links.map(([h, l, c]) => `<a class="${c}" href="${esc(h)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}</div>
      <p class="dim abver">Hyperwave Sensors Lite v${esc(VERSION)} · made by ${esc(A.name || 'TaiiRepublic')} · the phone-only edition of Hyperwave Sensors</p></div>
      ${safe(A.tip) && A.tipQr ? `<figure class="abqr"><img src="${esc(A.tipQr)}" alt="Tip QR code" width="150" height="150"><figcaption>Scan with your phone</figcaption></figure>` : ''}</div></section>`;
}

// ------------------------------------------------------------------ start
(async () => {
  await finishLogin();
  for (const c of C.channels) { try { addScanner(c.platform, c.channel, false); } catch (e) { toast(e.message, true); } }
  route();
  keepAwake();
  setInterval(keepAwake, 30000);
})();
