/* ============================================================
   ui.js – Anzeige (Rendern) & Klick-Events
   ------------------------------------------------------------
   Wird ZULETZT geladen: greift auf alles aus game.js / network.js
   zu und bindet am Ende alle Buttons.
   ============================================================ */

/* ---------- DOM-Helfer ---------- */
const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');

function toast(text){
  const l = $('log'); l.textContent = text; l.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(()=>l.classList.remove('show'), 2600);
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Baut ein .card DOM-Element aus einem Karten-Objekt */
function makeCardEl(card){
  const el = document.createElement('div');
  el.className = 'card ' + card.color;
  el.innerHTML =
    `<span class="corner tl">${cardCorner(card)}</span>`+
    `<span class="val">${cardLabel(card)}</span>`+
    `<span class="corner br">${cardCorner(card)}</span>`;
  return el;
}

/* ---------- Warteraum: Spielerliste ---------- */
function renderPlayersList(players, hostId){
  const ul = $('playersList'); ul.innerHTML='';
  players.forEach(p=>{
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot"></span><span>${escapeHtml(p.name)}</span>`;
    if(p.id === hostId) li.innerHTML += `<span class="host-tag">HOST</span>`;
    ul.appendChild(li);
  });
}

/* ---------- Bildschirmwechsel ---------- */
function enterGameScreen(){ hide('lobby'); hide('waiting'); show('game'); }

/* ---------- Spielbildschirm rendern ---------- */
function renderGame(view){
  // Gegner
  const opp = $('opponents'); opp.innerHTML='';
  view.players.filter(p=>!p.isYou).forEach(p=>{
    const d = document.createElement('div');
    d.className = 'opp' + (p.current ? ' active':'');
    d.innerHTML = `<div class="nm">${escapeHtml(p.name)}</div>`+
                  `<div class="cnt">${p.count}<small> Karten</small></div>`+
                  (p.count===1 ? `<div class="uno-badge">UNO!</div>`:'');
    opp.appendChild(d);
  });

  // Ablage + aktuelle Farbe
  const dt = $('discardTop'); dt.innerHTML='';
  if(view.top) dt.appendChild(makeCardEl(view.top));
  const ring = $('colorRing');
  const colorMap = {red:'var(--red)',yellow:'var(--yellow)',green:'var(--green)',blue:'var(--blue)'};
  ring.style.background = colorMap[view.color] || '#777';

  // Zug-Anzeige
  const tb = $('turnBanner');
  if(view.winner){ tb.textContent=''; }
  else if(view.yourTurn){ tb.textContent='Du bist dran – spiel eine Karte oder zieh.'; tb.className='turn-banner you'; }
  else {
    const cur = view.players.find(p=>p.current);
    tb.textContent = cur ? `${cur.name} ist dran…` : '';
    tb.className = 'turn-banner wait';
  }

  // Eigene Hand
  const hand = $('hand'); hand.innerHTML='';
  view.hand.forEach((card, i)=>{
    const el = makeCardEl(card);
    const playable = view.yourTurn && canPlayLocally(card, view);
    el.classList.add(playable ? 'playable' : 'notplayable');
    if(playable) el.onclick = ()=> tryPlay(i, card);
    hand.appendChild(el);
  });

  // Ziehen-Button
  $('drawBtn').disabled = !view.yourTurn;

  // Gewinner
  if(view.winner){
    $('winnerName').textContent = view.winner;
    show('winnerOverlay');
    if(isHost) $('playAgainBtn').classList.remove('hidden');
    else $('playAgainBtn').classList.add('hidden');
  } else {
    hide('winnerOverlay');
  }
}

/* Lokale Prüfung nur fürs UI (Host validiert nochmal echt) */
function canPlayLocally(card, view){
  if(card.color === 'wild') return true;
  if(card.color === view.color) return true;
  if(view.top && card.value === view.top.value) return true;
  return false;
}

/* ============================================================
   Aktionen auslösen (Host spielt lokal, Client schickt an Host)
   ============================================================ */
function tryPlay(index, card){
  if(card.color === 'wild'){
    pendingWild = { index, card };
    show('colorOverlay');
  } else {
    sendPlay(index, null);
  }
}

function sendPlay(index, color){
  if(isHost) playCard(myId, index, color);
  else hostConn.send({ type:'play', index, color });
}

function doDraw(){
  if(isHost) drawAction(myId);
  else hostConn.send({ type:'draw' });
}

/* ============================================================
   Events binden
   ============================================================ */
$('createBtn').onclick = createRoom;
$('joinBtn').onclick   = joinRoom;
$('join').addEventListener('input', e=>{ e.target.value = e.target.value.toUpperCase(); });
$('drawBtn').onclick   = doDraw;

document.querySelectorAll('.swatch').forEach(sw=>{
  sw.onclick = ()=>{
    hide('colorOverlay');
    if(pendingWild){ sendPlay(pendingWild.index, sw.dataset.color); pendingWild=null; }
  };
});

$('roomCodeVal').onclick = ()=>{
  navigator.clipboard?.writeText(roomCode).then(()=>{
    $('copyHint').textContent = 'Kopiert ✓';
    setTimeout(()=> $('copyHint').textContent='Tippen zum Kopieren', 1500);
  });
};

$('startBtn').onclick = startGame;

$('playAgainBtn').onclick = ()=>{
  if(isHost){ hide('winnerOverlay'); startGame(); }
};

// Enter-Taste in der Lobby
$('name').addEventListener('keydown', e=>{ if(e.key==='Enter') $('join').focus(); });
$('join').addEventListener('keydown', e=>{ if(e.key==='Enter') joinRoom(); });
