/*
 * Karten für „Prost!“: Kartenlisten einlesen, Stapel bauen und Platzhalter füllen.
 *
 *  - Stapel:  Warm-up-Karten zuerst, danach alle gewählten Sets gemischt. Karten, die der Browser schon von
 *             früheren Abenden kennt (localStorage), kommen erst dran, wenn alles andere gezogen ist.
 *  - Füllen:  {p1} {p2} {p3} → Namen, fair verteilt (wer selten dran war, kommt eher) · {c1} {c2} → ein Paar ·
 *             {s1}…{s5} → „1 Schluck“ / „3 Schlucke“ mal Intensität · {exen} → „exen“
 *             Namen werden erst beim Aufdecken eingesetzt, damit sie auch passen, wenn jemand dazukommt oder geht.
 */
(function (root) {
  'use strict';

  const SETS = [
    { id: 'warmup', label: 'Warm-up', icon: '🌱', text: 'harmlos, zum Reinkommen' },
    { id: 'party', label: 'Party', icon: '🎉', text: 'der Hauptteil, alle Kartentypen' },
    { id: 'heftig', label: 'Heftig', icon: '🔥', text: 'mehr Schlucke, mehr Wahrheit, frechere Fragen' },
    { id: 'paerchen', label: 'Pärchen', icon: '💕', text: 'für Paare in der Runde', couples: true },
    { id: 'adult', label: '18+', icon: '🔞', text: 'eindeutige Fragen rund um Sex', adult: true },
  ];
  const DEFAULT_SETS = ['warmup', 'party'];

  /** Kartentypen: Symbol, Name, Farbe. ende/pause/start erzeugt das Spiel selbst. */
  const TYPES = {
    aufgabe: { icon: '🎯', label: 'Aufgabe', color: '#ff9f43' },
    alle: { icon: '🙋', label: 'Alle, die …', color: '#22c1c3' },
    nie: { icon: '🙅', label: 'Ich hab noch nie', color: '#a66cff' },
    eher: { icon: '🗳️', label: 'Wer würde eher', color: '#5b8cff' },
    duell: { icon: '⚔️', label: 'Duell', color: '#ff4d6d' },
    kategorie: { icon: '🔁', label: 'Kategorie', color: '#2ecc71' },
    regel: { icon: '📜', label: 'Neue Regel', color: '#f7b731' },
    virus: { icon: '🦠', label: 'Virus', color: '#7bd148' },
    wahrheit: { icon: '🎲', label: 'Wahrheit oder trinken', color: '#ff6fb5' },
    ende: { icon: '✅', label: 'Aufgehoben', color: '#9aa5b8' },
    pause: { icon: '💧', label: 'Wasserpause', color: '#4fc3f7' },
    start: { icon: '🍻', label: 'Prost!', color: '#ffb347' },
  };
  const CARD_TYPES = ['aufgabe', 'alle', 'nie', 'eher', 'duell', 'kategorie', 'regel', 'virus', 'wahrheit'];
  const LASTING = ['regel', 'virus'];
  const PLACEHOLDERS = ['p1', 'p2', 'p3', 'c1', 'c2', 's1', 's2', 's3', 's4', 's5', 'exen'];
  const INTENSITY = { leicht: 0.5, normal: 1, heftig: 1.5 };
  /** Schlucke für die Abstimmungskarten (Text kommt vom Spiel, nicht aus der Kartenliste) */
  const VOTE_SIPS = { eher: 2, nie: 1 };
  const WARMUP_SHARE = 0.2;
  const SEEN_KEY = 'prost.seen.v1';
  let cache = null;

  function lines(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }

  function placeholders(text) {
    return [...String(text || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  }

  /** Eine Kartenliste einlesen: typ|text|ende-text */
  function parse(text, set) {
    return lines(text).map((l) => {
      const [type, body, end] = l.split('|').map((x) => (x || '').trim());
      const used = placeholders(body + ' ' + (end || ''));
      const people = ['p3', 'p2', 'p1'].find((p) => used.includes(p));
      return {
        key: set + ':' + String(body).toLowerCase(),
        set,
        type,
        text: body,
        end: end || null,
        needs: { people: people ? +people.slice(1) : 0, couple: used.includes('c1') || used.includes('c2') },
      };
    });
  }

  function all() {
    if (!cache) {
      const C = root.PROST_CARDS || {};
      cache = [];
      for (const s of SETS) cache.push(...parse(C[s.id], s.id));
    }
    return cache;
  }

  function set(id) {
    return SETS.find((s) => s.id === id) || null;
  }

  function counts() {
    const out = { total: all().length };
    for (const s of SETS) out[s.id] = all().filter((c) => c.set === s.id).length;
    return out;
  }

  /* ---------- Gesehene Karten (über Spiele hinweg) ---------- */

  function storage() {
    try {
      return root.localStorage || null;
    } catch {
      return null;
    }
  }

  function loadSeen() {
    const ls = storage();
    if (!ls) return new Set();
    try {
      return new Set(JSON.parse(ls.getItem(SEEN_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  function saveSeen(seen) {
    const ls = storage();
    if (!ls) return;
    try {
      ls.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch {
      /* Speicher voll oder gesperrt – egal */
    }
  }

  function markSeen(key) {
    const seen = loadSeen();
    if (seen.has(key)) return;
    seen.add(key);
    saveSeen(seen);
  }

  /* ---------- Stapel ---------- */

  function shuffle(list, random) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * n Karten aus pool ziehen: erst Ungesehenes (gemischt), dann Gesehenes. Ist von einem Set schon alles gesehen,
   * wird es für den nächsten Abend wieder freigegeben.
   */
  function take(pool, n, seen, random) {
    const fresh = shuffle(
      pool.filter((c) => !seen.has(c.key)),
      random
    );
    const old = shuffle(
      pool.filter((c) => seen.has(c.key)),
      random
    );
    if (!fresh.length && old.length) {
      for (const c of old) seen.delete(c.key);
      saveSeen(seen);
    }
    return fresh.concat(old).slice(0, n);
  }

  /** Karten der gewählten Sets (Pärchen nur mit eingetragenen Paaren) */
  function poolFor(sets, couples) {
    const ids = SETS.filter((s) => sets.includes(s.id) && (!s.couples || couples)).map((s) => s.id);
    return all().filter((c) => ids.includes(c.set));
  }

  /**
   * Stapel bauen.
   * @param {{sets: string[], length: number, couples?: boolean, exclude?: string[], warmup?: boolean, random?: Function}} o
   *   length 0 = endlos (es wird ein erster Schwung gebaut, more() legt nach) · exclude: schon gespielte Karten
   *   warmup: false → keine Warm-up-Karten vorziehen (beim Neubauen mitten im Spiel)
   */
  function build(o) {
    const random = o.random || Math.random;
    const n = o.length || 50;
    const exclude = new Set(o.exclude || []);
    const seen = loadSeen();
    const pool = poolFor(o.sets || DEFAULT_SETS, !!o.couples).filter((c) => !exclude.has(c.key));
    const warm = pool.filter((c) => c.set === 'warmup');
    const rest = pool.filter((c) => c.set !== 'warmup');
    if (!rest.length) return take(warm, n, seen, random);
    if (!warm.length) return take(rest, n, seen, random);
    const w = o.warmup === false ? 0 : Math.min(warm.length, Math.max(4, Math.min(10, Math.round(n * WARMUP_SHARE))));
    const first = take(warm, w, seen, random);
    // Nach dem Warm-up: der Rest der Warm-up-Karten darf sich unter die anderen mischen
    return first.concat(take(rest.concat(warm.filter((c) => !first.includes(c))), n - first.length, seen, random));
  }

  /** Endlos-Modus: weitere Karten nachlegen – erst Ungespieltes, ist alles durch, geht es von vorn los */
  function more(o) {
    const exclude = new Set(o.exclude || []);
    const pool = poolFor(o.sets || DEFAULT_SETS, !!o.couples);
    const open = pool.filter((c) => !exclude.has(c.key));
    return shuffle(open.length ? open : pool, o.random || Math.random).slice(0, o.count || 50);
  }

  /* ---------- Platzhalter ---------- */

  function sips(n, intensity) {
    const f = INTENSITY[intensity] || 1;
    const k = Math.max(1, Math.round(n * f));
    return `${k} ${k === 1 ? 'Schluck' : 'Schlucke'}`;
  }

  /** Karte mit Anfang/Ende: „Ich hab noch nie …“ und „Wer würde eher …?“ */
  function sentence(type, text) {
    if (type === 'nie') return 'Ich hab noch nie ' + text;
    if (type === 'eher') return 'Wer würde eher ' + text + '?';
    return text;
  }

  /** Personen fair wählen: nur wer bisher am seltensten dran war; die Leute der letzten Karte nur zur Not */
  function choose(players, count, avoid, random) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const left = players.filter((p) => !out.includes(p));
      if (!left.length) return null;
      let pool = left.filter((p) => !avoid.includes(p.id));
      if (!pool.length) pool = left;
      const min = Math.min(...pool.map((p) => p.picked || 0));
      const best = pool.filter((p) => (p.picked || 0) === min);
      out.push(best[Math.floor(random() * best.length)]);
    }
    return out;
  }

  /**
   * Karte füllen. Gibt null zurück, wenn es gerade nicht geht (zu wenige Personen, kein Paar).
   * @param {object} card
   * @param {{players: {id, name, picked}[], couples?: string[][], intensity?: string, avoid?: string[], random?: Function}} ctx
   * @returns {{text: string, endText: string|null, players: string[], note: string|null}|null}
   */
  function fill(card, ctx) {
    const random = ctx.random || Math.random;
    const players = ctx.players || [];
    const byId = (id) => players.find((p) => p.id === id);
    let couple = null;
    if (card.needs.couple) {
      const ok = (ctx.couples || []).filter((c) => c.length === 2 && byId(c[0]) && byId(c[1]));
      if (!ok.length) return null;
      const score = (c) => (byId(c[0]).picked || 0) + (byId(c[1]).picked || 0);
      const min = Math.min(...ok.map(score));
      const best = ok.filter((c) => score(c) === min);
      couple = best[Math.floor(random() * best.length)].map(byId);
      if (random() < 0.5) couple.reverse();
    }
    // Namen neben einem Paar: möglichst jemand anderes
    const others = couple ? players.filter((p) => !couple.includes(p)) : players;
    const want = card.needs.people;
    let people = choose(others.length >= want ? others : players, want, ctx.avoid || [], random);
    if (!people) return null;
    const names = {};
    people.forEach((p, i) => (names['p' + (i + 1)] = p.name));
    if (couple) {
      names.c1 = couple[0].name;
      names.c2 = couple[1].name;
    }
    const intensity = ctx.intensity || 'normal';
    const replace = (text) =>
      String(text).replace(/\{(\w+)\}/g, (m, k) => {
        if (names[k]) return names[k];
        if (/^s[1-5]$/.test(k)) return sips(+k.slice(1), intensity);
        if (k === 'exen') return 'exen';
        return m;
      });
    const ids = (couple || []).concat(people).map((p) => p.id);
    return {
      text: sentence(card.type, replace(card.text)),
      endText: card.end ? replace(card.end) : null,
      players: [...new Set(ids)],
      note: VOTE_SIPS[card.type] ? voteNote(card.type, intensity) : null,
    };
  }

  /** Was bei den Abstimmungskarten getrunken wird */
  function voteNote(type, intensity) {
    if (type === 'eher') return `Meiste Stimmen trinkt ${sips(VOTE_SIPS.eher, intensity)}.`;
    if (type === 'nie') return `Wer es schon mal gemacht hat, trinkt ${sips(VOTE_SIPS.nie, intensity)}.`;
    return null;
  }

  root.PRDeck = {
    SETS,
    DEFAULT_SETS,
    TYPES,
    CARD_TYPES,
    LASTING,
    PLACEHOLDERS,
    INTENSITY,
    VOTE_SIPS,
    all,
    set,
    counts,
    parse,
    placeholders,
    build,
    more,
    fill,
    sips,
    sentence,
    voteNote,
    markSeen,
    loadSeen,
  };
})(typeof window !== 'undefined' ? window : globalThis);
