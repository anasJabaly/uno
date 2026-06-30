/* ============================================================
   game.js – Spiel-Regeln & autoritativer Host-Zustand
   ------------------------------------------------------------
   Geteilter Zustand (var = dateiübergreifend sichtbar) + reine
   Uno-Logik. Kein DOM hier – nur Daten & Regeln.
   ============================================================ */

/* ---------- Geteilter Zustand ---------- */
var peer = null, myId = null, myName = '', isHost = false;
var hostConn = null, connections = [], roomCode = '';
var game = null, pendingWild = null;
var ME = { pid:null, name:'', wins:0 };   // wird in ui.js aus localStorage geladen

/* ---------- Konstanten ---------- */
const COLORS = ['red','yellow','green','blue'];
const SYMBOL = { skip:'⦸', reverse:'⇄', draw2:'+2', wild:'★', wild4:'+4' };
const SHORT  = { skip:'S', reverse:'R', draw2:'+2', wild:'W', wild4:'+4' };
const TARGET = 500;     // Punkte zum Spielsieg
const UNO_PENALTY = 2;  // Strafkarten, wenn UNO vergessen wurde

/* ---------- Punkte ---------- */
function cardPoints(card){
  if(['skip','reverse','draw2'].includes(card.value)) return 20;
  if(card.value === 'wild' || card.value === 'wild4') return 50;
  return parseInt(card.value, 10);   // 0–9
}
function handPoints(hand){ return hand.reduce((s,c)=> s + cardPoints(c), 0); }

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
  return shuffle(d);
}
function cardLabel(card){
  if(['skip','reverse','draw2','wild','wild4'].includes(card.value)) return SYMBOL[card.value];
  return card.value;
}
function cardCorner(card){
  if(['skip','reverse','draw2','wild','wild4'].includes(card.value)) return SHORT[card.value];
  return card.value;
}

/* ============================================================
   HOST: Runde starten (Punkte & Siege bleiben erhalten)
   ============================================================ */
function startGame(){
  if(!isHost) return;
  if(game.players.length < 2){ toast('Mindestens 2 Spieler nötig.'); return; }
  const hs = Math.max(1, Math.min(12, game.handSize || 7));
  game.handSize = hs;

  game.deck = buildDeck();
  game.discard = [];
  game.direction = 1;
  game.winner = null;
  game.drawStack = 0;
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
  const cur = game.players[game.currentIndex];
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

  // Runde gewonnen?
  if(cur.hand.length === 0){
    const gained = game.players.filter(p=>p.id!==cur.id).reduce((s,p)=> s + handPoints(p.hand), 0);
    cur.score += gained;
    game.lastRound = { winner: cur.name, gained };
    game.winner = cur.name;
    if(cur.score >= TARGET){ game.champion = cur.name; cur.wins = (cur.wins||0) + 1; }
    else game.champion = null;
    broadcastState(ev);
    return;
  }

  const n = game.players.length;
  switch(card.value){
    case 'skip':    game.currentIndex = nextIndex(game.currentIndex, 2); break;
    case 'reverse': game.direction *= -1;
      game.currentIndex = (n === 2) ? game.currentIndex : nextIndex(game.currentIndex, 1); break;
    case 'draw2':   game.drawStack += 2; game.currentIndex = nextIndex(game.currentIndex, 1); break;  // stapelbar
    case 'wild4':   game.drawStack += 4; game.currentIndex = nextIndex(game.currentIndex, 1); break;  // stapelbar
    default:        game.currentIndex = nextIndex(game.currentIndex, 1);
  }
  broadcastState(ev);
}

/* ============================================================
   HOST: Karte(n) ziehen
   ============================================================ */
function drawAction(pid){
  if(!game.started || game.winner) return;
  const cur = game.players[game.currentIndex];
  if(!cur || cur.id !== pid) return;

  let count;
  if(game.drawStack > 0){ count = game.drawStack; giveCards(cur, count); game.drawStack = 0; }  // Zieh-Zwang abarbeiten
  else { count = 1; giveCards(cur, 1); }

  cur.saidUno = false;
  game.currentIndex = nextIndex(game.currentIndex, 1);
  broadcastState({kind:'draw', by:pid, count});
}

/* ---------- Persönliche Sicht für einen Spieler ---------- */
function makeView(pid){
  const top = topCard();
  const me = game.players.find(p=>p.id===pid);
  return {
    type:'state',
    hand: me ? me.hand : [],
    youSaidUno: me ? !!me.saidUno : false,
    players: game.players.map((p,i)=>({
      id:p.id, name:p.name, count:p.hand.length, score:p.score, wins:p.wins||0,
      isYou:p.id===pid,
      current: game.started && !game.winner && i===game.currentIndex
    })),
    top, color: game.currentColor, started: game.started,
    direction: game.direction, drawStack: game.drawStack, handSize: game.handSize,
    winner: game.winner, champion: game.champion, lastRound: game.lastRound, target: TARGET
  };
}

/* ---------- Neues Spiel: Punkte zurücksetzen (Siege bleiben) ---------- */
function resetScores(){
  if(!isHost) return;
  game.players.forEach(p=> p.score = 0);
  game.champion = null;
  game.lastRound = null;
  startGame();
}