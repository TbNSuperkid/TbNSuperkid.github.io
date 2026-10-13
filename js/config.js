/*
 * Standard-Konfiguration für reines Static-Hosting (z.B. GitHub Pages):
 * Online-Modus über PeerJS/WebRTC.
 * Läuft die Seite über den mitgelieferten Node-Server (npm start), liefert dieser
 * stattdessen { transport: 'ws' } aus und das WebSocket-Relay wird benutzt.
 */
window.ACTIVITY_CONFIG = window.ACTIVITY_CONFIG || { transport: 'peer' };
