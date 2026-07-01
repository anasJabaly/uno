/* ============================================================
   game.js – Spiel-Regeln & autoritativer Host-Zustand
   ============================================================ */

/* ---------- Geteilter Zustand ---------- */
var peer = null, myId = null, myName = '', isHost = false;
var hostConn = null, connections = [], roomCode = '';
var game = null, pendingWild = null;
var ME = { pid:null, name:'', wins:0 };   // wird in ui.js aus localStorage geladen

/* ---------- Konstanten ---------- */
const COLORS = ['red','yellow','green','blue'];
const SYMBOL = { skip:'⦸', reverse:'⇄', draw2:'+2', wild:'★', wild4:'+4', wish:'⟳' };
const SHORT  = { skip:'S', reverse:'R', draw2:'+2', wild:'W', wild4:'+4', wish:'⟳' };
const UNO_PENALTY = 1;  // Strafkarten, wenn UNO vergessen wurde

/* ---------- Karten / Deck ---------- */
function shuffle(a){
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function buildDeck(){
  const d = [];
  for(const c of COLORS){
    d.push({color:c, value:'0'});
    for(let n=1;n<=9;n++){ d.push({color:c,value:String(n)}); d.push({color:c,value:String(n)}); }
    for(const s of ['skip','reverse','draw2']){ d.push({color:c,value:s}); d.push({color:c,value:s}); }
  }
  for(let i=0;i<4;i++){ d.push({color:'wild',value:'wild'}); d.push({color:'wild',value:'wild4'}); }
  d.push({color:'wild', value:'wish'});   // Wunschkarte: nur EINMAL im ganzen Spiel
  return shuffle(d);
}
function cardLabel(card){
  if(['skip','reverse','draw2','wild','wild4','wish'].includes(card.value)) return SYMBOL[card.value];
  return card.value;
}
function cardCorner(card){
  if(['skip','reverse','draw2','wild','wild4','wish'].includes(card.value)) return SHORT[card.value];
  return card.value;
}

/* ============================================================
   HOST: Runde starten (Siege bleiben erhalten)
   ============================================================ */
function startGame(){
  if(!isHost) return;
  if(game.players.length < 2){ toast('Mindestens 2 Spieler nötig.'); return; }
  shuffle(game.players);   // Reihenfolge & Startspieler jede Runde zufällig
  const hs = Math.max(1, Math.min(15, game.handSize || 7));
  game.handSize = hs;

  game.deck = buildDeck();
  game.discard = [];
  game.direction = 1;
  game.winner = null;
  game.drawStack = 0;
  game.drewThisTurn = false;
  game.players.forEach(p=>{ p.hand = game.deck.splice(0,hs); p.saidUno = false; });

  // Startkarte: erste echte Farbkarte (keine Wild/Aktion als Auftakt)
  let start;
  do { start = game.deck.shift(); game.deck.push(start); }
  while(start.color === 'wild' || ['skip','reverse','draw2'].includes(start.value));
  game.deck.pop();
  game.discard.push(start);
  game.currentColor = start.color;
  game.currentIndex = 0;
  game.started = true;

  connections.forEach(c=> c.send({type:'gameStart'}));
  enterGameScreen();
  broadcastState({kind:'deal'});
}

/* ---------- Regel-Helfer ---------- */
function topCard(){ return game.discard[game.discard.length-1]; }

/* Darf "card" gerade gelegt werden?
   - Kein Schwarz auf Schwarz (Wild/+4 nicht auf Wild/+4).
   - Bei offenem Zieh-Zwang (drawStack>0): nur passende Stapel-Karten. */
function canPlay(card){
  const top = topCard();
  if(card.color === 'wild' && top.color === 'wild') return false;   // Schwarz auf Schwarz verboten

  if(game.drawStack > 0){
    if(top.value === 'draw2'){
      if(card.value === 'draw2') return true;     // +2 auf +2 (jede Farbe)
      if(card.value === 'wild4') return true;     // +4 auf +2
      return false;
    }
    if(top.value === 'wild4'){
      if(card.value === 'draw2' && card.color === game.currentColor) return true; // +2 auf +4, richtige Farbe
      return false;                               // +4 auf +4 schon oben verboten
    }
    return false;
  }

  if(card.color === 'wild') return true;
  if(card.color === game.currentColor) return true;
  if(card.value === top.value) return true;
  return false;
}

/* Hat der Spieler überhaupt eine legbare Karte? */
function hasPlayable(player){ return player.hand.some(c=> canPlay(c)); }

function reshuffleIfNeeded(){
  if(game.deck.length > 0) return;
  const top = game.discard.pop();
  game.deck = shuffle(game.discard);
  game.discard = [top];
}
function giveCards(player, n){
  for(let i=0;i<n;i++){ reshuffleIfNeeded(); if(game.deck.length) player.hand.push(game.deck.shift()); }
}
function nextIndex(from, steps){
  const n = game.players.length;
  return ((from + game.direction*steps) % n + n) % n;
}
/* Zug weiterrücken + "schon gezogen"-Markierung zurücksetzen */
function advanceTurn(steps){
  game.currentIndex = nextIndex(game.currentIndex, steps);
  game.drewThisTurn = false;
}

/* Wunschkarte: alle Hände einmal in Spielrichtung weiterreichen
   (zu zweit = Hände tauschen). */
function rotateHands(){
  const n = game.players.length;
  const hands = game.players.map(p=>p.hand);
  const newHands = new Array(n);
  for(let i=0;i<n;i++){
    const target = ((i + game.direction) % n + n) % n;   // gibt an den nächsten in Spielrichtung
    newHands[target] = hands[i];
  }
  game.players.forEach((p,i)=>{ p.hand = newHands[i]; p.saidUno = false; });
}

/* ---------- UNO ansagen ---------- */
function sayUno(pid){
  const cur = game.players[game.currentIndex];
  if(!cur || cur.id !== pid) return;
  if(cur.hand.length === 2){ cur.saidUno = true; broadcastState({kind:'uno', by:pid}); }
}

/* ============================================================
   HOST: Karte spielen
   ============================================================ */
function playCard(pid, index, chosenColor){
  if(!game.started || game.winner) return;
  const actorIdx = game.currentIndex;
  const cur = game.players[actorIdx];
  if(!cur || cur.id !== pid) return;
  const card = cur.hand[index];
  if(!card) return;
  if(!canPlay(card)){ const c=connFor(pid); if(c) c.send({type:'reject',msg:'Karte passt nicht.'}); return; }
  if(card.color === 'wild' && !COLORS.includes(chosenColor)) return;

  cur.hand.splice(index,1);
  game.discard.push(card);
  game.currentColor = (card.color === 'wild') ? chosenColor : card.color;

  // UNO vergessen? -> Strafkarten
  let penalty = false;
  if(cur.hand.length === 1 && !cur.saidUno){ giveCards(cur, UNO_PENALTY); penalty = true; }
  if(cur.hand.length !== 1) cur.saidUno = false;

  const ev = {kind:'play', by:pid, card, penalty};

  // Runde gewonnen? -> Sieg zählen
  if(cur.hand.length === 0){
    cur.wins = (cur.wins||0) + 1;
    game.winner = cur.name;
    broadcastState(ev);
    return;
  }

  const n = game.players.length;
  switch(card.value){
    case 'skip':    advanceTurn(2); break;
    case 'reverse': game.direction *= -1; advanceTurn(n === 2 ? 0 : 1); break;
    case 'draw2':   game.drawStack += 2; advanceTurn(1); break;  // stapelbar, kein Aussetzen
    case 'wild4':   game.drawStack += 4; advanceTurn(1); break;  // stapelbar, kein Aussetzen
    case 'wish':    rotateHands(); advanceTurn(1); break;        // Wunschkarte: Hände weiterreichen
    default:        advanceTurn(1);
  }

  // Regel B: Bleibt der Zug bei mir (zu zweit: Aussetzen/Drehen) und ich kann
  // nichts mehr legen, muss ich NICHT ziehen -> der/die andere ist dran.
  if(game.currentIndex === actorIdx && !hasPlayable(cur)){
    advanceTurn(1);
  }

  broadcastState(ev);
}

/* ============================================================
   HOST: Karte(n) ziehen
   ------------------------------------------------------------
   - Offener Zieh-Zwang (+2/+4): Stapel ziehen, ABER weiter dran
     bleiben (kein Aussetzen).
   - Sonst (Regel A): 1 Karte ziehen. Kann man danach spielen, bleibt
     man dran (spielen oder weitergeben). Kann man nicht -> automatisch
     weiter zum nächsten Spieler.
   ============================================================ */
function drawAction(pid){
  if(!game.started || game.winner) return;
  const cur = game.players[game.currentIndex];
  if(!cur || cur.id !== pid) return;

  if(game.drawStack > 0){
    const count = game.drawStack;
    giveCards(cur, count);
    game.drawStack = 0;
    cur.saidUno = false;
    broadcastState({kind:'draw', by:pid, count});   // bleibt am Zug
    return;
  }

  giveCards(cur, 1);
  cur.saidUno = false;
  game.drewThisTurn = true;

  if(hasPlayable(cur)){
    broadcastState({kind:'draw', by:pid, count:1});         // darf spielen oder weitergeben
  } else {
    advanceTurn(1);                                         // nichts spielbar -> weiter
    broadcastState({kind:'draw', by:pid, count:1});
  }
}

/* ---------- HOST: bewusst weitergeben (nur nach dem Ziehen) ---------- */
function passTurn(pid){
  if(!game.started || game.winner) return;
  const cur = game.players[game.currentIndex];
  if(!cur || cur.id !== pid) return;
  if(!game.drewThisTurn) return;   // weitergeben nur erlaubt, wenn man schon gezogen hat
  advanceTurn(1);
  broadcastState({kind:'pass', by:pid});
}

/* ---------- Persönliche Sicht für einen Spieler ---------- */
function makeView(pid){
  const top = topCard();
  const me = game.players.find(p=>p.id===pid);
  const yourTurn = game.started && !game.winner &&
      game.players[game.currentIndex] && game.players[game.currentIndex].id === pid;
  return {
    type:'state',
    hand: me ? me.hand : [],
    youSaidUno: me ? !!me.saidUno : false,
    youDrew: yourTurn && !!game.drewThisTurn,
    players: game.players.map((p,i)=>({
      id:p.id, name:p.name, count:p.hand.length, wins:p.wins||0,
      isYou:p.id===pid,
      current: game.started && !game.winner && i===game.currentIndex
    })),
    top, color: game.currentColor, started: game.started,
    direction: game.direction, drawStack: game.drawStack, handSize: game.handSize,
    winner: game.winner
  };
}


/* ============================================================
   HOST: Bot-Logik (KI)
   ============================================================ */
function checkBotTurn(){
  if(!game.started || game.winner) return;
  const cur = game.players[game.currentIndex];
  if(!cur || !cur.isBot) return;

  // Verzögerung, damit der Bot "menschlich" wirkt und nachdenkt (1,5 Sekunden)
  clearTimeout(game.botTimer);
  game.botTimer = setTimeout(() => doBotMove(cur), 1500);
}

function doBotMove(bot){
  if(!game.started || game.winner) return;
  if(game.players[game.currentIndex].id !== bot.id) return; // Sicherstellen, dass er noch dran ist

  // Situation A: Bot hat diese Runde schon eine Karte gezogen
  if(game.drewThisTurn){
    const playableIdx = bot.hand.findIndex(c => canPlay(c));
    if(playableIdx !== -1) playBotCard(bot, playableIdx); // Gezogene Karte passt -> spielen!
    else passTurn(bot.id);                                // Passt nicht -> weitergeben
    return;
  }

  // Situation B: Normaler Zug – Bot sucht eine legbare Karte
  const playableIdx = bot.hand.findIndex(c => canPlay(c));
  if(playableIdx !== -1) {
    playBotCard(bot, playableIdx);
  } else {
    drawAction(bot.id); // Nichts passt -> Karte ziehen
  }
}

function playBotCard(bot, idx){
  const card = bot.hand[idx];
  let chosenColor = card.color;

  // Wenn der Bot eine Wunschkarte oder +4 legt, wählt er eine zufällige Farbe
  if(card.color === 'wild'){
    chosenColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  }

  // Der Bot ist ein Profi und vergisst nie, UNO zu sagen!
  if(bot.hand.length === 2) bot.saidUno = true;

  playCard(bot.id, idx, chosenColor);
}
