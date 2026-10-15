/*
 * Karten für „Prost!“ – Set 🌱 Warm-up: harmlos, zum Reinkommen. Kommt zu Spielbeginn zuerst.
 *
 * Eine Zeile pro Karte:  typ|text|ende-text (nur bei regel und virus)
 * Typen:  aufgabe · alle · nie · eher · duell · kategorie · regel · virus · wahrheit
 *   nie:   nur der Rest des Satzes – das Spiel setzt „Ich hab noch nie “ davor
 *   eher:  nur der Rest der Frage – das Spiel macht daraus „Wer würde eher … ?“
 * Platzhalter: {p1} {p2} {p3} Namen · {c1} {c2} ein Paar (nur Pärchen-Set) · {s1}…{s5} Schlucke · {exen}
 * Zeilen mit # werden ignoriert. Karten bitte geschlechtsneutral formulieren (Verlierer:in, wer …).
 */
window.PROST_CARDS = window.PROST_CARDS || {};
window.PROST_CARDS.warmup = `
aufgabe|{p1} verteilt {s2}.
aufgabe|{p1} darf {s3} verteilen – aber nicht an sich selbst.
aufgabe|{p1} und {p2} stoßen an und trinken {s1}.
aufgabe|Alle stoßen auf {p1} an! {p1} sagt einen Trinkspruch, dann trinken alle {s1}.
aufgabe|{p1} sucht sich eine Trinkpartnerin oder einen Trinkpartner aus. Bis zur nächsten Wasserpause trinkt ihr immer zusammen.
aufgabe|{p1} erzählt in einem Satz, wie der Tag heute war. Langweilig? Dann {s1}.
aufgabe|{p1} macht ein Kompliment an die Person links. Wer rot wird, trinkt {s1}.
aufgabe|{p1} macht eine Tierstimme vor. Wer sie zuerst errät, verteilt {s2}.
aufgabe|{p1} summt ein Lied. Wer es zuerst errät, verteilt {s2}. Errät es niemand, trinkt {p1} {s2}.
aufgabe|Wer zuletzt die Hand hebt, trinkt {s1}. Los!
aufgabe|Wer als Letztes den Boden berührt, trinkt {s2}.
aufgabe|Alle mit leerem Glas schenken sich nach. Wer noch ein volles Glas hat, trinkt {s1}.
aufgabe|{p1}: Nenne drei Dinge, die du heute schon gegessen hast. Schaffst du es nicht, trinkst du {s1}.
aufgabe|{p1} und {p2} tauschen die Plätze.
aufgabe|{p1} stellt sich vor wie in einem Bewerbungsgespräch – 20 Sekunden. Danach verteilt {p1} {s2}.
aufgabe|Die jüngste Person in der Runde trinkt {s1}.
aufgabe|Die älteste Person in der Runde verteilt {s2}.
aufgabe|Wer als Nächstes Geburtstag hat, verteilt {s3}.
aufgabe|Wer am weitesten weg wohnt, trinkt {s1}.
aufgabe|Wer heute als Erstes hier war, verteilt {s2}.
alle|Alle, die heute schon Kaffee getrunken haben, trinken {s1}.
alle|Alle, die gerade Socken in zwei verschiedenen Farben tragen, trinken {s2}.
alle|Alle, die ein Haustier haben, trinken {s1}.
alle|Alle mit Brille trinken {s1}.
alle|Alle, die heute Sport gemacht haben, verteilen {s1}. Alle anderen trinken {s1}.
alle|Alle, die gerade Schwarz tragen, trinken {s1}.
alle|Alle, die Geschwister haben, trinken {s1}.
alle|Alle, die mit dem Auto hier sind, trinken {s1} Wasser – und sonst nichts!
alle|Alle, die heute schon einmal zu spät gekommen sind, trinken {s1}.
alle|Alle, die ihr Handy in der Hand haben, trinken {s1}. Weg damit!
alle|Alle, die heute noch nichts gegessen haben, essen jetzt erst mal was. Die anderen trinken {s1}.
nie|im Ausland gelebt.
nie|einen Knochen gebrochen.
nie|vor einem Spiegel eine Rede geübt.
nie|bei einem Film geweint.
nie|einen Kaktus umgebracht.
nie|ein Instrument gespielt.
nie|eine Nacht durchgemacht.
nie|einen Promi getroffen.
eher|beim Wandern verloren gehen
eher|an einer Kochshow teilnehmen
eher|im Supermarkt mit sich selbst reden
eher|ein Haustier nach einem Essen benennen
eher|als Erstes auf der Tanzfläche stehen
eher|bei einem Horrorfilm einschlafen
eher|einen Marathon laufen
duell|{p1} gegen {p2}: Schere, Stein, Papier. Verlierer:in trinkt {s1}.
duell|{p1} gegen {p2}: Wer zuerst lacht, verliert. Schaut euch in die Augen! Verlierer:in trinkt {s2}.
duell|{p1} gegen {p2}: Daumencatchen! Verlierer:in trinkt {s1}.
duell|{p1} gegen {p2}: Wer kann länger auf einem Bein stehen? Verlierer:in trinkt {s1}.
kategorie|Nennt reihum Automarken. {p1} fängt an. Wer nichts mehr weiß, trinkt {s1}.
kategorie|Nennt reihum Obstsorten. {p1} fängt an. Wer nichts mehr weiß, trinkt {s1}.
kategorie|Nennt reihum Länder in Europa. {p1} fängt an. Wer nichts mehr weiß, trinkt {s1}.
kategorie|Nennt reihum Disney-Filme. {p1} fängt an. Wer nichts mehr weiß, trinkt {s1}.
kategorie|Nennt reihum Biermarken. {p1} fängt an. Wer nichts mehr weiß, trinkt {s1}.
regel|Neue Regel: Wer trinkt, muss vorher „Prost!“ rufen. Wer es vergisst, trinkt {s1} extra.|Ihr müsst nicht mehr „Prost!“ rufen.
regel|Neue Regel: Es wird nur noch mit der linken Hand getrunken. Wer es vergisst, trinkt {s1}.|Ihr dürft wieder mit beiden Händen trinken.
virus|{p1} muss ab jetzt jeden Satz mit „Ehrlich gesagt …“ beginnen. Wer es vergisst, trinkt {s1}.|{p1} darf wieder normal reden.
virus|{p1} ist jetzt Fragenmeister:in: Wer auf eine Frage von {p1} antwortet, trinkt {s1}.|{p1} ist nicht mehr Fragenmeister:in.
wahrheit|{p1}: Was war dein erster Job? Oder du trinkst {s2}.
wahrheit|{p1}: Was ist dein peinlichster Lieblingssong? Oder du trinkst {s2}.
wahrheit|{p1}: Welche App benutzt du am meisten? Handy zeigen – oder {s2}.
wahrheit|{p1}: Was war dein erstes Handy? Oder du trinkst {s1}.
`;
