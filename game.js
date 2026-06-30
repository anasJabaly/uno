/* ============================================================
   game.js – Spiel-Regeln & autoritativer Host-Zustand
   ------------------------------------------------------------
   Hier liegt der geteilte Zustand (var = über alle Dateien
   erreichbar) und die komplette Uno-Logik. DOM/PeerJS werden
   hier NICHT angefasst – nur Daten und Regeln.
   ============================================================ */

/* ---------- Geteilter Zustand (von network.js & ui.js genutzt) ---------- */
var peer = null;          // PeerJS-Instanz
var myId = null;          // eigene Peer-ID
var myName = '';          // eigener Name
var isHost = false;       // bin ich der Host?
var hostConn = null;      // Client -> Host Verbindung
var connections = [];     // Host: alle Client-Verbindungen
var roomCode = '';        // 4-stelliger Raumcode
var game = null;          // NUR auf dem Host: kompletter Spielzustand
var pendingWild = null;   // {index, card} während der Farbwahl

/* ---------- Konstanten ---------- */
const COLORS = ['red','yellow','green','blue'];
const SYMBOL = { skip:'⦸', reverse:'⇄', draw2:'+2', wild:'★', wild4:'+4' };
const SHORT  = { skip:'S', reverse:'R', draw2:'+2', wild:'W', wild4:'+4' };

/* ---------- Karten / Deck ---------- */
function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
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
   HOST: Spiel starten
   ============================================================ */
function startGame(){
  if(!isHost) return;
  if(game.players.length < 2){ toast('Mindestens 2 Spieler nötig.'); return; }

  game.deck = buildDeck();
  game.discard = [];
  game.direction = 1;
  game.winner = null;
  game.players.forEach(p=> p.hand = game.deck.splice(0,7));

  // Startkarte: erste echte Farbkarte (keine Wild/Aktion als Auftakt)
  let start;
  do { start = game.deck.shift(); game.deck.push(start); }
  while(start.color === 'wild' || ['skip','reverse','draw2'].includes(start.value));
  game.deck.pop();                 // die zuletzt gepushte (=start) wieder raus
  game.discard.push(start);
  game.currentColor = start.color;
  game.currentIndex = 0;
  game.started = true;

  connections.forEach(c=> c.send({type:'gameStart'}));
  enterGameScreen();
  broadcastState();
}

/* ---------- Regel-Helfer ---------- */
function topCard(){ return game.discard[game.discard.length-1]; }

function canPlay(card){
  const top = topCard();
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

/* ============================================================
   HOST: Karte spielen
   ============================================================ */
function playCard(pid, index, chosenColor){
  if(!game.started || game.winner) return;
  const cur = game.players[game.currentIndex];
  if(!cur || cur.id !== pid) return;                                  // nicht dran
  const card = cur.hand[index];
  if(!card) return;
  if(!canPlay(card)){ const c=connFor(pid); if(c) c.send({type:'reject',msg:'Karte passt nicht.'}); return; }
  if(card.color === 'wild' && !COLORS.includes(chosenColor)) return;  // Farbe fehlt

  // Karte ablegen
  cur.hand.splice(index,1);
  game.discard.push(card);
  game.currentColor = (card.color === 'wild') ? chosenColor : card.color;

  // Gewonnen?
  if(cur.hand.length === 0){ game.winner = cur.name; broadcastState(); return; }

  const n = game.players.length;
  switch(card.value){
    case 'skip':
      game.currentIndex = nextIndex(game.currentIndex, 2); break;
    case 'reverse':
      game.direction *= -1;
      game.currentIndex = (n === 2) ? game.currentIndex : nextIndex(game.currentIndex, 1);
      break;
    case 'draw2': {
      const t = game.players[nextIndex(game.currentIndex,1)];
      giveCards(t, 2);
      game.currentIndex = nextIndex(game.currentIndex, 2);
      break;
    }
    case 'wild4': {
      const t = game.players[nextIndex(game.currentIndex,1)];
      giveCards(t, 4);
      game.currentIndex = nextIndex(game.currentIndex, 2);
      break;
    }
    default:
      game.currentIndex = nextIndex(game.currentIndex, 1);
  }
  broadcastState();
}

/* ============================================================
   HOST: Karte ziehen (Zug endet danach)
   ============================================================ */
function drawAction(pid){
  if(!game.started || game.winner) return;
  const cur = game.players[game.currentIndex];
  if(!cur || cur.id !== pid) return;
  giveCards(cur, 1);
  game.currentIndex = nextIndex(game.currentIndex, 1);
  broadcastState();
}

/* ---------- Persönliche Sicht für einen Spieler bauen ---------- */
function makeView(pid){
  const top = topCard();
  const me = game.players.find(p=>p.id===pid);
  return {
    type:'state',
    hand: me ? me.hand : [],
    players: game.players.map((p,i)=>({
      name:p.name, count:p.hand.length,
      isYou:p.id===pid,
      current: game.started && !game.winner && i===game.currentIndex
    })),
    top, color: game.currentColor, started: game.started,
    winner: game.winner,
    yourTurn: game.started && !game.winner && game.players[game.currentIndex]?.id===pid
  };
}
