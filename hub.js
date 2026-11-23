/*
 * Filter der Spieleauswahl: „Ein Gerät reicht“, „Musik“, „Trinkspiele“ und die Personenzahl.
 * Die Karten tragen dafür data-features ("one music drink") sowie data-min / data-max.
 * Die Auswahl bleibt für diese Sitzung erhalten (z. B. nach „← Alle Spiele“).
 */
(() => {
  const bar = document.querySelector('.filters');
  const cards = [...document.querySelectorAll('.games .game')];
  const chips = [...bar.querySelectorAll('.chip[data-filter]')];
  const people = document.getElementById('f-people');
  const status = document.getElementById('f-status');
  const empty = document.getElementById('f-empty');
  const KEY = 'hub.filter';
  const MAX_PEOPLE = 20;

  for (let n = 2; n <= MAX_PEOPLE; n++) people.add(new Option(`${n} Personen`, String(n)));

  function apply() {
    const on = chips.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.dataset.filter);
    const n = Number(people.value) || 0;
    let shown = 0;
    for (const card of cards) {
      const features = (card.dataset.features || '').split(' ');
      const fits =
        on.every((f) => features.includes(f)) && (!n || (n >= Number(card.dataset.min) && n <= Number(card.dataset.max)));
      card.hidden = !fits;
      if (fits) shown++;
    }
    people.closest('.chip').classList.toggle('is-active', n > 0);
    status.textContent = shown === cards.length ? `${shown} Spiele` : `${shown} von ${cards.length} Spielen`;
    empty.hidden = shown > 0;
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ on, people: n }));
    } catch (e) {}
  }

  function reset() {
    for (const c of chips) c.setAttribute('aria-pressed', 'false');
    people.value = '';
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
  document.getElementById('f-reset').addEventListener('click', () => {
    reset();
    chips[0].focus();
  });

  bar.hidden = false;
  apply();
})();
