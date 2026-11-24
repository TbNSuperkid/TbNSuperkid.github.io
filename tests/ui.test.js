'use strict';
/* Tests für die gemeinsamen Oberflächen-Bausteine (shared/ui.js), ohne Browser: node tests/ui.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

globalThis.window = globalThis;
const Icons = require(path.join(__dirname, '..', 'shared', 'icons.js'));
const UI = require(path.join(__dirname, '..', 'shared', 'ui.js'));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name);
    throw err;
  }
}

console.log('Gemeinsame Bausteine (shared/ui.js)');

test('Text wird maskiert, Hilfen tun, was sie sollen', () => {
  assert.strictEqual(UI.esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.strictEqual(UI.esc(null), '');
  assert.strictEqual(UI.plural(1, 'Punkt', 'Punkte'), 'Punkt');
  assert.strictEqual(UI.plural(0, 'Punkt', 'Punkte'), 'Punkte');
  assert.strictEqual(UI.teamStyle('#ef4444'), '--team:#ef4444');
  assert.strictEqual(UI.teamStyle('"><script>'), '--team:&quot;&gt;&lt;script&gt;');
  assert.ok(UI.connectError('not-found').startsWith('Kein Spiel'));
  assert.ok(UI.connectError('irgendwas').startsWith('Verbindung fehlgeschlagen'));
  assert.strictEqual(UI.session('x'), null, 'ohne sessionStorage kein Fehler');
});

test('Auswahlknöpfe: gewählter Wert, data-Attribute, Werte maskiert', () => {
  const html = UI.seg('length', ['short', 'normal'], 'normal', (o) => o.toUpperCase(), 'setup');
  assert.strictEqual((html.match(/class="seg-btn/g) || []).length, 2);
  assert.ok(html.includes('data-act="set" data-key="length" data-value="normal" data-scope="setup" aria-pressed="true"'));
  assert.ok(html.includes('aria-pressed="false" >SHORT'));
  assert.ok(UI.seg('k', ['"x'], null, String, 's').includes('data-value="&quot;x"'));
  assert.ok(UI.seg('k', [1], 1, String, 's', true).includes('disabled'));
});

test('Schalter: Standard toggle mit key, eigene Aktion ohne key', () => {
  const a = UI.toggle(true, { key: 'joker', scope: 'lobby' });
  assert.ok(a.includes('class="switch on"') && a.includes('aria-checked="true"'));
  assert.ok(a.includes('data-act="toggle" data-key="joker" data-scope="lobby"'));
  assert.ok(a.includes('>An<'));
  const b = UI.toggle(false, { act: 'toggle-joker', scope: 'setup' });
  assert.ok(b.includes('data-act="toggle-joker" data-scope="setup"') && !b.includes('data-key'));
  assert.ok(b.includes('aria-checked="false"') && b.includes('>Aus<'));
});

test('Timer: Sekunden oder m:ss, Ticken, Art als Klasse', () => {
  assert.strictEqual(UI.timer(null), '');
  const a = UI.timer({ remaining: 4200, total: 10000 }, { tick: true });
  assert.ok(a.includes('data-tick') && a.includes('data-rem="4200"') && a.includes('data-total="10000"'));
  assert.ok(a.includes('>5</b>') && a.includes('width:42%'));
  const b = UI.timer({ remaining: 75000, total: 90000, kind: 'read' }, { clock: true, cls: 'timer-big' });
  assert.ok(b.includes('class="timer timer-read timer-big"') && b.includes('data-clock') && b.includes('>1:15</b>'));
});

test('Raumbox: Fehler, Warten, QR mit Code und Link', () => {
  assert.strictEqual(UI.roomBox(null), '');
  assert.ok(UI.roomBox({ state: 'error' }).includes('class="alert"'));
  assert.ok(UI.roomBox({ state: 'connecting' }).includes('Raum wird geöffnet'));
  const html = UI.roomBox({ state: 'online', code: 'AB<CD' }, true, { inviteLink: (c) => 'https://x/?raum=' + c, qrSvg: () => '<svg/>' });
  assert.ok(html.includes('class="qr qr-big"><svg/>'));
  assert.ok(html.includes('data-testid="room-code">AB&lt;CD</div>'));
  assert.ok(html.includes('https://x/?raum=AB&lt;CD'));
});

test('Menü, Dialog, Bestätigung', () => {
  const item = UI.menuItem('resolve', 'next', 'Frage <überspringen>', { attrs: 'data-no="3"', small: '(sofort)', danger: true });
  assert.ok(item.startsWith('<button class="menu-item danger" data-act="resolve" data-no="3">'));
  assert.ok(item.includes('Frage &lt;überspringen&gt; <small>(sofort)</small>'));
  const basics = UI.menuBasics(true);
  assert.strictEqual(basics.length, 2);
  assert.ok(basics[1].includes('Ton einschalten'));
  assert.ok(UI.menu([basics[0], '', null]).includes('<h2>Menü</h2>'));
  assert.strictEqual(UI.modal(''), '', 'leerer Dialog wird nicht gezeigt');
  const m = UI.modal('<p>Hallo</p>', { wide: true });
  assert.ok(m.includes('data-act="close-modal-bg"') && m.includes('class="modal modal-wide"') && m.includes('<p>Hallo</p>'));
  const c = UI.confirmBody({ title: 'Löschen?', text: 'Wirklich <alles>?', yes: 'Löschen', danger: true });
  assert.ok(c.includes('btn-danger') && c.includes('Wirklich &lt;alles&gt;?') && !c.includes('confirm-no'));
  assert.ok(UI.confirmBody({ title: 't', text: 'x', yes: 'Ja', no: 'Nein' }).includes('data-act="confirm-no">Nein'));
});

test('Startseite, Lobby, Spielende: Bausteine maskieren Namen', () => {
  assert.ok(UI.logo('A & B', 'bell', true).includes('class="logo logo-small" aria-label="A &amp; B"'));
  assert.ok(UI.screenHead('Neues Spiel', { right: UI.rulesButton() }).includes('data-act="rules"'));
  assert.ok(UI.screenHead('Wände', { back: 'ed-back', backLabel: 'Zurück zu <x>' }).includes('data-act="ed-back"'));
  const card = UI.modeCard({ act: 'new-game', icon: 'laptop', title: 'Spiel anlegen', text: 'Am <b>Laptop</b>', go: "Los geht's" });
  assert.ok(card.includes('<small>Am <b>Laptop</b></small>') && card.includes('Los geht&#39;s'));
  assert.ok(UI.resume({ act: 'resume-stage', title: 'Fortsetzen', sub: 'Lobby', discard: 'discard-stage' }).includes('aria-label="Verwerfen"'));
  const chip = UI.chip({ id: 'p"1', name: '<Ben>', online: false }, { dot: true, style: '--team:#fff' });
  assert.ok(chip.includes('is-offline') && chip.includes('&lt;Ben&gt;') && chip.includes('data-player="p&quot;1"') && chip.includes('team-dot'));
  assert.ok(!UI.chip({ id: 'a', name: 'A', online: true }, { kick: false }).includes('chip-x'));
  assert.ok(UI.settingsSummary(['10 Fragen', '', 'Joker <an>']).includes('10 Fragen · Joker &lt;an&gt;'));
  const step = UI.podiumStep({ place: 1, index: 0, name: '<Rot>', points: '3 Punkte', cls: 'team-rot' });
  assert.ok(step.includes('podium-step p1 team-rot') && step.includes('&lt;Rot&gt;'));
  const award = UI.award({ icon: '⚡', title: 'Schnell', text: 'A', sub: 'B' }, { '⚡': 'zap' });
  assert.ok(award.includes('<svg class="ico"') && award.includes('award-sub'));
  assert.ok(UI.award({ icon: '🦄', title: 'x', text: 'y' }, {}).includes('🦄'), 'unbekanntes Emoji bleibt sichtbar');
});

test('alle Icons, die shared/ui.js benutzt, gibt es', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'ui.js'), 'utf8');
  const used = [...src.matchAll(/\bI\(\s*'([a-z-]+)'/g), ...src.matchAll(/menuItem\('[\w-]+', '([a-z-]+)'/g)].map((m) => m[1]);
  for (const m of src.matchAll(/\bI\(([^()]*\?[^()]*)\)/g)) for (const q of m[1].matchAll(/'([a-z-]+)'/g)) used.push(q[1]);
  assert.ok(used.length >= 10, 'zu wenige gefunden');
  for (const name of used) assert.ok(Icons.has(name), 'Icon fehlt: ' + name);
});

console.log(`\n${passed} Tests bestanden.`);
