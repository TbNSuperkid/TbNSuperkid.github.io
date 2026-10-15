/*
 * Rennkommentar für „Pferderennen“: aus dem Rennen vor und nach einer Karte eine Schlagzeile machen.
 *   „♠ Pik zieht davon!“ · „Drama in Reihe 3 – ♥ Herz muss zurück!“ · „Fotofinish! ♦ Karo hauchdünn vor ♣ Kreuz!“
 *
 * say(before, after, events, ctx) → { key, mood, text }
 *   key:  was passiert ist (start, win, win-big, photo, drama, lead, tie, near, alarm, away, catchup,
 *         reshuffle, move) – für Tests und Sounds
 *   mood: info | hot | drama | win – für die Farbe in der Oberfläche
 *   ctx:  { bettors: { S: ['Anna'], … }, random }
 */
(function (root) {
  'use strict';

  const Cards = root.PFCards;
  const SUITS = Cards.SUITS;

  function horse(s) {
    return `${Cards.SUIT[s].symbol} ${Cards.SUIT[s].name}`;
  }

  function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1];
  }

  /** „Anna jubelt“ / „Anna und Ben jubeln“ */
  function verb(names, one, many) {
    return `${joinNames(names)} ${names.length === 1 ? one : many}`;
  }

  /** Pferde ganz vorn (ohne Sieger: höchste Position) */
  function leaders(r) {
    const max = Math.max(...SUITS.map((s) => r.pos[s]));
    return SUITS.filter((s) => r.pos[s] === max);
  }

  function lastOnes(r) {
    const min = Math.min(...SUITS.map((s) => r.pos[s]));
    return SUITS.filter((s) => r.pos[s] === min);
  }

  function pick(list, random) {
    return list[Math.floor((random || Math.random)() * list.length) % list.length];
  }

  function say(before, after, events, ctx) {
    const c = ctx || {};
    const bettors = c.bettors || {};
    const fans = (s) => bettors[s] || [];
    const rnd = c.random || Math.random;
    const out = (key, mood, text) => ({ key, mood, text });
    const move = events.find((e) => e.type === 'move');
    const backs = events.filter((e) => e.type === 'track' && e.to < e.from);
    const L = after.length;

    /* Zieleinlauf */
    if (after.winner) {
      const w = after.winner;
      const close = SUITS.filter((s) => s !== w && after.pos[s] === L);
      const second = Math.max(...SUITS.filter((s) => s !== w).map((s) => after.pos[s]));
      const cheer = fans(w).length ? ` ${verb(fans(w), 'jubelt', 'jubeln')}!` : ' Darauf hat niemand gesetzt!';
      if (close.length) return out('photo', 'win', `📸 Fotofinish! ${horse(w)} hauchdünn vor ${joinNames(close.map(horse))}!${cheer}`);
      if (L + 1 - second >= 3) return out('win-big', 'win', `Überlegen! ${horse(w)} gewinnt mit ${L + 1 - second} Längen Vorsprung!${cheer}`);
      return out('win', 'win', pick([`${horse(w)} gewinnt das Rennen!`, `Und ${horse(w)} holt sich den Sieg!`, `${horse(w)} ist durch – Sieg!`], rnd) + cheer);
    }

    /* Streckenkarte (pro Karte höchstens eine: das ziehende Pferd steht danach genau auf der Reihe) */
    if (backs.length) {
      const e = backs[0];
      const top = leaders(before);
      const sad = fans(e.suit).length ? ` ${verb(fans(e.suit), 'leidet', 'leiden')}.` : '';
      if (top.length === 1 && top[0] === e.suit && before.pos[e.suit] > 0) return out('drama', 'drama', `Bitter! Spitzenreiter ${horse(e.suit)} muss zurück!${sad}`);
      return out('drama', 'drama', pick([`Drama in Reihe ${e.row} – ${horse(e.suit)} muss zurück!`, `Reihe ${e.row}: Rückschlag für ${horse(e.suit)}!`], rnd) + sad);
    }

    if (!move) return out('info', 'info', '');

    /* Der Start */
    if (after.tick === 1) return out('start', 'hot', pick([`Die Boxen sind offen – ${horse(move.suit)} kommt am besten weg!`, `Und los! ${horse(move.suit)} macht den ersten Satz.`], rnd));

    const topBefore = leaders(before);
    const topAfter = leaders(after);
    const near = SUITS.filter((s) => after.pos[s] === L);

    /* Kurz vor dem Ziel */
    if (near.length >= 2 && near.includes(move.suit) && after.pos[move.suit] > before.pos[move.suit]) {
      return out('alarm', 'hot', `Fotofinish-Alarm! ${joinNames(near.map(horse))} nur noch einen Sprung vom Ziel!`);
    }

    /* Führung */
    if (topAfter.length === 1 && topAfter[0] === move.suit && !(topBefore.length === 1 && topBefore[0] === move.suit)) {
      const cheer = fans(move.suit).length ? ` ${verb(fans(move.suit), 'jubelt', 'jubeln')}.` : '';
      if (topBefore.length === 1) return out('lead', 'hot', `Führungswechsel! ${horse(move.suit)} übernimmt die Spitze.${cheer}`);
      return out('lead', 'hot', `${horse(move.suit)} schiebt sich an die Spitze!${cheer}`);
    }
    if (near.length === 1 && near[0] === move.suit && after.pos[move.suit] > before.pos[move.suit]) {
      return out('near', 'hot', `${horse(move.suit)} ist nur noch einen Sprung vom Ziel entfernt!`);
    }
    if (topAfter.length === 1 && topAfter[0] === move.suit) {
      const others = SUITS.filter((s) => s !== move.suit).map((s) => after.pos[s]);
      if (after.pos[move.suit] - Math.max(...others) >= 2) return out('away', 'hot', pick([`${horse(move.suit)} zieht davon!`, `${horse(move.suit)} baut den Vorsprung aus!`], rnd));
    }
    if (topAfter.length >= 2 && topAfter.includes(move.suit) && after.pos[move.suit] > 1) {
      return out('tie', 'hot', `Kopf an Kopf! ${joinNames(topAfter.map(horse))} gleichauf an der Spitze.`);
    }

    /* Aufholjagd */
    const lastBefore = lastOnes(before);
    const lastAfter = lastOnes(after);
    if (lastBefore.length === 1 && lastBefore[0] === move.suit && !(lastAfter.length === 1 && lastAfter[0] === move.suit)) {
      return out('catchup', 'info', pick([`${horse(move.suit)} holt auf!`, `${horse(move.suit)} kämpft sich heran.`], rnd));
    }

    if (events.some((e) => e.type === 'reshuffle')) return out('reshuffle', 'info', 'Stapel leer – die Karten werden neu gemischt!');

    return out(
      'move',
      'info',
      pick([`${horse(move.suit)} macht einen Satz nach vorn.`, `${horse(move.suit)} galoppiert auf Reihe ${move.to}.`, `Weiter geht's für ${horse(move.suit)}.`, `${horse(move.suit)} legt nach.`], rnd)
    );
  }

  root.PFComments = { say, leaders };
})(typeof window !== 'undefined' ? window : globalThis);
