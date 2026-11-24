/*
 * Filter der Spieleauswahl: Suche, „Ein Gerät reicht“, „Musik“, „Trinkspiele“ und die Personenzahl.
 * Die Karten tragen dafür data-features ("one music drink") sowie data-min / data-max.
 * Kategorien ohne passendes Spiel werden ausgeblendet, ihre Anzahl wird angepasst.
 * Die Auswahl bleibt für diese Sitzung erhalten (z. B. nach „← Alle Spiele“), die Suche nicht.
 */
(() => {
  const bar = document.querySelector('.filters');
  const searchBox = document.querySelector('.search');
  const search = document.getElementById('f-search');
  const cards = [...document.querySelectorAll('.game')];
  const cats = [...document.querySelectorAll('.cat')];
  const chips = [...bar.querySelectorAll('.filter[data-filter]')];
  const people = document.getElementById('f-people');
  const status = document.getElementById('f-status');
  const empty = document.getElementById('f-empty');
  const KEY = 'hub.filter';
  const MAX_PEOPLE = 20;

  for (let n = 2; n <= MAX_PEOPLE; n++) people.add(new Option(`${n} Personen`, String(n)));

  /** Kleinbuchstaben ohne Akzente: „Flüsterpost“ findet man auch mit „flusterpost“ */
  const norm = (s) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  const text = new Map(cards.map((c) => [c, norm(c.querySelector('h3').textContent + ' ' + c.querySelector('p').textContent)]));

  function apply() {
    const on = chips.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.dataset.filter);
    const n = Number(people.value) || 0;
    const words = norm(search.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const card of cards) {
      const features = (card.dataset.features || '').split(' ');
      const fits =
        on.every((f) => features.includes(f)) &&
        (!n || (n >= Number(card.dataset.min) && n <= Number(card.dataset.max))) &&
        words.every((w) => text.get(card).includes(w));
      card.hidden = !fits;
      if (fits) shown++;
    }
    for (const cat of cats) {
      const visible = cat.querySelectorAll('.game:not([hidden])').length;
      cat.hidden = visible === 0;
      cat.querySelector('.cat-count').textContent = String(visible);
    }
    people.closest('.filter').classList.toggle('is-active', n > 0);
    status.textContent = shown === cards.length ? `${shown} Spiele` : `${shown} von ${cards.length} Spielen`;
    empty.hidden = shown > 0;
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ on, people: n }));
    } catch (e) {}
  }

  function reset() {
    for (const c of chips) c.setAttribute('aria-pressed', 'false');
    people.value = '';
    search.value = '';
    apply();
  }

  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved) {
      for (const c of chips) c.setAttribute('aria-pressed', String(saved.on.includes(c.dataset.filter)));
      if (saved.people) people.value = String(saved.people);
    }
  } catch (e) {}

  for (const c of chips) {
    c.addEventListener('click', () => {
      c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true'));
      apply();
    });
  }
  people.addEventListener('change', apply);
  search.addEventListener('input', apply);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      search.value = '';
      apply();
    }
  });
  document.getElementById('f-reset').addEventListener('click', () => {
    reset();
    chips[0].focus();
  });

  bar.hidden = false;
  searchBox.hidden = false;
  apply();
})();
