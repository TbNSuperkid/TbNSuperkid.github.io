/*
 * Karten für „Prost!“ – Set 💕 Pärchen: für Paare in der Runde. Die Paare werden beim Spielstart eingetragen,
 * {c1} und {c2} sind die beiden Personen eines Paares. Ohne eingetragene Paare wird das Set übersprungen.
 * Format und Platzhalter: siehe js/cards/warmup.js
 */
window.PROST_CARDS = window.PROST_CARDS || {};
window.PROST_CARDS.paerchen = `
# 🎯 Aufgaben
aufgabe|{c1} und {c2} trinken {s2} – mit verschränkten Armen wie bei einer Hochzeit.
aufgabe|{c1} erzählt, wie {c1} und {c2} sich kennengelernt haben. {c2} darf korrigieren – für jeden Fehler trinkt {c1} {s1}.
aufgabe|{c1} und {c2} schauen sich 10 Sekunden tief in die Augen. Wer zuerst lacht, trinkt {s2}.
aufgabe|{c1} macht {c2} vor der ganzen Runde ein ernst gemeintes Kompliment. Zu kitschig? {s1} für {c1}.
aufgabe|{c1} imitiert {c2} beim Aufwachen. Erkennt sich {c2} wieder, trinkt {c2} {s2}, sonst {c1}.
aufgabe|{c1} und {c2} dürfen zusammen {s4} verteilen – aber nur, wenn ihr euch einig seid.
aufgabe|{c1} und {c2} sind bis zur nächsten Wasserpause ein Team: Trinkt eine Person, trinkt die andere mit.
aufgabe|{c1} zählt drei Dinge auf, die {c2} im Haushalt besser macht. Mehr als 5 Sekunden Pause? {s2}.
aufgabe|{c1} und {c2} tauschen für eine Runde die Plätze mit {p1}.
aufgabe|{c1} sagt das Lieblingsessen von {c2}. Falsch? {s2} für {c1}.
aufgabe|{c1} sagt die Lieblingsfarbe von {c2}. Falsch? {s2} für {c1}.
aufgabe|{c2} sagt, welche Schuhgröße {c1} hat. Falsch? {s2} für {c2}.
aufgabe|{c1} und {c2} singen zusammen einen Refrain eines Liebeslieds. Alle anderen trinken {s1}.
aufgabe|{c1} küsst {c2} auf die Wange – oder beide trinken {s2}.
aufgabe|{c1} und {c2}: Wer hat zuerst „Ich liebe dich“ gesagt? Wenn ihr euch nicht einig seid, trinkt ihr beide {s3}.
aufgabe|{p1} stellt {c1} eine Frage über {c2}. Richtig beantwortet? {c1} verteilt {s2}. Falsch? {c1} trinkt {s2}.

# 🙋 Alle, die …
alle|Alle Paare, die schon mal zusammen im Urlaub gestritten haben, trinken {s2}.
alle|Alle Paare, die länger als zwei Jahre zusammen sind, verteilen {s2}.
alle|Alle, die in einer Beziehung sind, trinken {s1} auf die Liebe.
alle|Alle Singles verteilen {s2} an die Paare ihrer Wahl.
alle|Alle Paare, die schon mal getrennt waren und wieder zusammengekommen sind, trinken {s3}.
alle|Alle, die heute schon ihre Partnerin oder ihren Partner geküsst haben, trinken {s1}.

# 🙅 Ich hab noch nie
nie|meiner Partnerin oder meinem Partner ein Geschenk gemacht, das ich eigentlich für mich wollte.
nie|so getan, als würde mir das Essen meines Partners oder meiner Partnerin schmecken.
nie|einen Jahrestag vergessen.
nie|mit meiner Partnerin oder meinem Partner Schluss gemacht und es am nächsten Tag bereut.
nie|heimlich das Handy meiner Partnerin oder meines Partners angeschaut.

# 🗳️ Wer würde eher
eher|aus der Runde zuerst heiraten
eher|zuerst Kinder bekommen
eher|beim Streit zuerst nachgeben
eher|einen Jahrestag vergessen
eher|die Partnerin oder den Partner mit einem Heiratsantrag überraschen
eher|eine Fernbeziehung durchhalten

# ⚔️ Duelle
duell|{c1} gegen {c2}: Wer kennt den anderen besser? {p1} stellt jeder Person eine Frage. Verlierer:in trinkt {s2}.
duell|{c1} gegen {c2}: Schere, Stein, Papier – wer verliert, macht morgen das Frühstück. Und trinkt {s1}.
duell|{c1} gegen {c2}: Armdrücken! Verlierer:in trinkt {s2}.
duell|{c1} gegen {c2}: Wer nennt mehr Freund:innen der anderen Person in 15 Sekunden? Verlierer:in trinkt {s2}.

# 📜 Regeln
regel|Neue Regel: Paare dürfen nicht nebeneinander sitzen. Wer neben der eigenen Partnerin oder dem eigenen Partner sitzt, trinkt {s2} und wechselt den Platz.|Paare dürfen wieder nebeneinander sitzen.
regel|Neue Regel: Wer „Schatz“ sagt, trinkt {s1}.|„Schatz“ ist wieder erlaubt.

# 🦠 Viren
virus|{c1} und {c2} müssen sich bei jedem Schluck zuprosten.|{c1} und {c2} müssen sich nicht mehr zuprosten.
virus|{c1} darf nur trinken, wenn {c2} es erlaubt.|{c1} darf wieder trinken, wann {c1} will.

# 🎲 Wahrheit oder trinken
wahrheit|{c1}: Was nervt dich am meisten an {c2}? Oder {s3}.
wahrheit|{c2}: Was war dein erster Gedanke, als du {c1} gesehen hast? Oder {s3}.
wahrheit|{c1}: Was war euer schlimmster Streit? Oder ihr trinkt beide {s3}.
wahrheit|{c2}: Was findest du an {c1} am attraktivsten? Oder {s2}.
wahrheit|{c1}: Was würdest du an {c2} ändern, wenn du könntest? Oder {s3}.
wahrheit|{c2}: Welche Person aus der Runde wäre für dich die zweite Wahl? Oder {exen}.
wahrheit|{c1}: Wann hast du {c2} zuletzt angelogen – und worum ging es? Oder {s3}.
`;
