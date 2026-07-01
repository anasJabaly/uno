/* ============================================================
   ui.js – Anzeige, Sitzplätze, Animationen, Events, Login
   Wird ZULETZT geladen.
   ============================================================ */

/* ---------- DOM-Helfer ---------- */
const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');
const rectOf = el => el.getBoundingClientRect();

function toast(text){
  const l = $('log'); l.textContent = text; l.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(()=>l.classList.remove('show'), 2600);
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- Identität: Name = Profil, Siege pro Name gespeichert ---------- */
function loadProfiles(){ try{ return JSON.parse(localStorage.getItem('uno_profiles')||'{}') || {}; }catch(e){ return {}; } }
function saveProfiles(p){ try{ localStorage.setItem('uno_profiles', JSON.stringify(p)); }catch(e){} }
function winsFor(name){ if(!name) return 0; return loadProfiles()[name] || 0; }
function setWinsFor(name, w){ if(!name) return; const p = loadProfiles(); p[name] = w; saveProfiles(p); }

function loadIdentity(){
  let last = '';
  try{
    last = localStorage.getItem('uno_lastname') || '';
    // Einmalige Migration vom alten ID-System (Siege nicht verlieren)
    if(Object.keys(loadProfiles()).length === 0){
      const oldName = localStorage.getItem('uno_name') || '';
      const oldWins = parseInt(localStorage.getItem('uno_wins')||'0',10) || 0;
      if(oldName){ setWinsFor(oldName, oldWins); if(!last) last = oldName; }
    }
  }catch(e){}
  ME.name = last;
  ME.wins = winsFor(last);
}
/* Aktuellen Namen merken + Siege darunter sichern */
function saveIdentity(){
  try{ localStorage.setItem('uno_lastname', ME.name || ''); }catch(e){}
  setWinsFor(ME.name, ME.wins || 0);
}

/* ---------- Karten-Element ---------- */
function makeCardEl(card){
  const el = document.createElement('div');
  el.className = 'card ' + card.color + (isNaN(parseInt(card.value,10)) ? ' v-'+card.value : '');
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
    li.innerHTML = `<span class="dot"></span><span>${escapeHtml(p.name)}</span>`+
        (p.wins ? `<span class="wins-badge">🏆 ${p.wins}</span>` : '')+
        (p.id === hostId ? `<span class="host-tag">HOST</span>` : '');
    ul.appendChild(li);
  });
}

function enterGameScreen(){ hide('lobby'); hide('waiting'); show('game'); }

/* ---------- Sitzplatz-Anker (Prozent im Tisch) ---------- */
function seatAnchors(k){
  const A = {
    1:[[50,16]],
    2:[[24,22],[76,22]],
    3:[[16,40],[50,13],[84,40]],
    4:[[13,34],[37,12],[63,12],[87,34]],
    5:[[12,46],[29,16],[50,11],[71,16],[88,46]],
    6:[[11,48],[26,16],[45,11],[63,11],[80,18],[90,48]]
  };
  if(A[k]) return A[k];
  const arr=[]; for(let i=0;i<k;i++){ const t=Math.PI*(0.14+0.72*(i/(k-1||1))); arr.push([50-42*Math.cos(t), 12+34*Math.sin(t)]); }
  return arr;
}

/* ---------- Spielbildschirm rendern ---------- */
function renderGame(view){
  const ev = view.event;
  const meP = view.players.find(p=>p.isYou);

  view.yourTurn = meP ? meP.current : false;

  // Eigene Leiste (nur Siege, kein Punktekonto mehr)
  $('selfName').textContent = meP ? meP.name : '';
  $('selfStats').innerHTML = `<span class="chip-wins">🏆 ${meP?meP.wins:0}</span>`;
  // Siege auf diesem Gerät speichern, wenn ICH die Runde gewonnen habe
  if(view.winner && meP && view.winner === meP.name){ ME.wins = meP.wins; saveIdentity(); }

  // Gegner-Sitzplätze
  const felt = $('opponents'); felt.innerHTML='';
  const order = view.players;
  const selfIdx = order.findIndex(p=>p.isYou);
  const opps = [];
  for(let i=1;i<order.length;i++){ opps.push(order[(selfIdx + i) % order.length]); }
  const anchors = seatAnchors(opps.length);
  opps.forEach((p,i)=>{
    const a = anchors[i] || [50,16];
    const seat = document.createElement('div');
    seat.className = 'seat' + (p.current ? ' active':'');
    seat.style.left = a[0]+'%'; seat.style.top = a[1]+'%';
    seat.dataset.pid = p.id;
    const fanN = Math.min(p.count, 7);
    let fan='';
    for(let j=0;j<fanN;j++){
      const off = j-(fanN-1)/2;
      fan += `<div class="mini back" style="transform:rotate(${off*7}deg) translateY(${Math.abs(off)*2}px)"></div>`;
    }
    seat.innerHTML =
        `<div class="seat-head">${p.current?'<span class="turn-dot">▶</span>':''}<span class="seat-name">${escapeHtml(p.name)}</span></div>`+
        `<div class="mini-fan">${fan || '<div class="mini empty"></div>'}</div>`+
        `<div class="seat-foot"><b>${p.count}</b> Karten`+
        (p.wins?` · 🏆${p.wins}`:'')+
        (p.count===1?` <span class="uno-badge">UNO!</span>`:'')+`</div>`;
    felt.appendChild(seat);
  });

  // Mitte: Ablage + Farbe + Richtung
  const dt = $('discardTop'); dt.innerHTML='';
  if(view.top){
    const tc = makeCardEl(view.top);
    if(ev && ev.kind==='play'){ tc.style.opacity='0'; setTimeout(()=>{ tc.style.opacity='1'; tc.classList.add('dropin'); }, 360); }
    dt.appendChild(tc);
  }
  const cmap = {red:'var(--red)',yellow:'var(--yellow)',green:'var(--green)',blue:'var(--blue)'};
  $('colorRing').style.background = cmap[view.color] || '#777';
  $('dirArrow').textContent = view.direction === 1 ? '↻' : '↺';

  // Zug-Anzeige
  const tb = $('turnBanner');
  if(view.winner){ tb.textContent=''; }
  else if(view.yourTurn){
    tb.className = 'turn-banner you';
    tb.textContent = view.drawStack>0 ? `Du bist dran – stapeln oder ${view.drawStack} ziehen (danach normal spielen)` : 'Du bist dran!';
  } else {
    const cur = view.players.find(p=>p.current);
    tb.className = 'turn-banner wait';
    tb.textContent = cur ? `${cur.name} ist dran…` : '';
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

  // Ziehen- / Weitergeben-Knopf
  const db = $('drawBtn');
  db.disabled = !view.yourTurn;
  if(view.yourTurn && view.drawStack>0){
    db.textContent = `${view.drawStack} Karten ziehen`;
    db.onclick = doDraw;
  } else if(view.yourTurn && view.youDrew){
    db.textContent = 'Weitergeben';
    db.onclick = doPass;
  } else {
    db.textContent = 'Karte ziehen';
    db.onclick = doDraw;
  }

  // UNO-Knopf (bei genau 2 Karten am Zug)
  const ub = $('unoBtn');
  if(view.youSaidUno && view.hand.length <= 2){
    ub.classList.remove('hidden'); ub.classList.add('said'); ub.textContent = 'UNO ✓';
  } else if(view.yourTurn && view.hand.length === 2){
    ub.classList.remove('hidden'); ub.classList.remove('said'); ub.textContent = 'UNO!';
  } else {
    ub.classList.add('hidden');
  }

  // Gewinner-Overlay
  if(view.winner){ renderWinner(view); show('winnerOverlay'); }
  else hide('winnerOverlay');

  // Animationen
  if(ev){
    if(ev.kind === 'deal') animateDeal(view);
    else if(ev.kind === 'play'){ animatePlay(view, ev); if(ev.card && ev.card.value==='wish') toast('⟳ Wunschkarte – alle Hände wurden weitergereicht!'); if(ev.penalty){ const w=view.players.find(p=>p.id===ev.by); toast((w&&!w.isYou?w.name+': ':'')+'UNO vergessen – Strafkarten!'); } }
    else if(ev.kind === 'draw') animateDraw(view, ev);
    else if(ev.kind === 'uno'){ const w=view.players.find(p=>p.id===ev.by); if(w && !w.isYou) toast(`${w.name} sagt UNO!`); }
  }
}

/* Lokale Spielbarkeits-Prüfung (gleiche Regeln wie Host, nur fürs Hervorheben) */
function canPlayLocally(card, view){
  const top = view.top;
  if(card.color === 'wild' && top && top.color === 'wild') return false;
  if(view.drawStack > 0){
    if(top.value === 'draw2') return card.value==='draw2' || card.value==='wild4';
    if(top.value === 'wild4') return card.value==='draw2' && card.color===view.color;
    return false;
  }
  if(card.color === 'wild') return true;
  if(card.color === view.color) return true;
  if(top && card.value === top.value) return true;
  return false;
}

/* ---------- Gewinner / Sieges-Rangliste ---------- */
function renderWinner(view){
  $('winTrophy').textContent = '🏆';
  $('winnerName').textContent = view.winner;
  $('winSub').textContent = 'hat die Runde gewonnen';
  $('gainedLine').textContent = '';

  const rank = [...view.players].sort((a,b)=> (b.wins||0) - (a.wins||0));
  $('rankingTable').innerHTML =
      '<tr><th>#</th><th>Spieler</th><th>Siege</th></tr>' +
      rank.map((p,i)=>`<tr class="${p.isYou?'me':''}"><td>${i+1}</td><td>${escapeHtml(p.name)}${p.isYou?' (Du)':''}</td><td>🏆 ${p.wins||0}</td></tr>`).join('');

  if(isHost){
    $('nextBtn').classList.remove('hidden'); $('waitNext').classList.add('hidden');
    $('nextBtn').textContent = 'Nächste Runde';
  } else {
    $('nextBtn').classList.add('hidden'); $('waitNext').classList.remove('hidden');
  }
}

/* ============================================================
   Animationen (fliegende Karten)
   ============================================================ */
function flyCard(fromRect, toRect, opts={}){
  const { face=null, back=true, dur=480, delay=0 } = opts;
  const W=62, H=92;
  const c = document.createElement('div');
  c.className = 'card flycard ' + (back ? 'back' : (face ? face.color : ''));
  c.innerHTML = back ? '<span class="val">UNO</span>'
      : `<span class="corner tl">${cardCorner(face)}</span><span class="val">${cardLabel(face)}</span><span class="corner br">${cardCorner(face)}</span>`;
  c.style.width=W+'px'; c.style.height=H+'px';
  document.body.appendChild(c);
  const fx = fromRect.left + fromRect.width/2 - W/2, fy = fromRect.top + fromRect.height/2 - H/2;
  const tx = toRect.left + toRect.width/2 - W/2,   ty = toRect.top + toRect.height/2 - H/2;
  c.style.transform = `translate(${fx}px,${fy}px) scale(.55)`;
  c.style.opacity = '0';
  setTimeout(()=>{
    requestAnimationFrame(()=>{
      c.style.transition = `transform ${dur}ms cubic-bezier(.2,.8,.2,1), opacity 160ms`;
      c.style.transform = `translate(${tx}px,${ty}px) scale(1)`;
      c.style.opacity = '1';
    });
  }, delay);
  setTimeout(()=>{ c.style.transition='opacity 150ms'; c.style.opacity='0'; setTimeout(()=>c.remove(),160); }, delay+dur);
}

function seatRectFor(pid, view){
  const meP = view.players.find(p=>p.isYou);
  if(meP && meP.id === pid) return rectOf($('hand'));
  const seat = document.querySelector('.seat[data-pid="'+pid+'"]');
  return seat ? rectOf(seat) : rectOf($('discardTop'));
}

function animateDeal(view){
  const deck = rectOf($('drawPile'));
  const targets = view.players.map(p=> seatRectFor(p.id, view));
  let delay = 0; const step = 60;
  for(let r=0;r<view.handSize;r++){
    targets.forEach(t=>{ flyCard(deck, t, {back:true, dur:420, delay}); delay += step; });
  }
}

function animatePlay(view, ev){
  const from = seatRectFor(ev.by, view);
  const to = rectOf($('discardTop'));
  flyCard(from, to, {back:false, face:ev.card, dur:400});
}

function animateDraw(view, ev){
  const deck = rectOf($('drawPile'));
  const to = seatRectFor(ev.by, view);
  const n = Math.min(ev.count, 6);
  let delay = 0;
  for(let i=0;i<n;i++){ flyCard(deck, to, {back:true, dur:360, delay}); delay += 80; }
}

/* ============================================================
   Aktionen auslösen
   ============================================================ */
function tryPlay(index, card){
  if(card.color === 'wild'){ pendingWild = { index, card }; show('colorOverlay'); }
  else sendPlay(index, null);
}
function sendPlay(index, color){
  if(isHost) playCard(myId, index, color);
  else hostConn.send({ type:'play', index, color });
}
function doDraw(){
  if(isHost) drawAction(myId);
  else hostConn.send({ type:'draw' });
}
function doPass(){
  if(isHost) passTurn(myId);
  else hostConn.send({ type:'pass' });
}
function sayUnoLocal(){
  if(isHost) sayUno(myId);
  else hostConn.send({ type:'uno' });
}

/* ============================================================
   Kartenanzahl-Stepper (Host)
   ============================================================ */
let chosenHandSize = 7;
function updateHandSizeUI(){ $('handSizeVal').textContent = chosenHandSize; }

/* ============================================================
   Events binden
   ============================================================ */
$('createBtn').onclick = createRoom;
$('joinBtn').onclick   = joinRoom;
$('join').addEventListener('input', e=>{ e.target.value = e.target.value.toUpperCase(); });
$('unoBtn').onclick    = sayUnoLocal;

$('hsMinus').onclick = ()=>{ chosenHandSize = Math.max(2, chosenHandSize-1); updateHandSizeUI(); };
$('hsPlus').onclick  = ()=>{ chosenHandSize = Math.min(15, chosenHandSize+1); updateHandSizeUI(); };

document.querySelectorAll('.swatch').forEach(sw=>{
  sw.onclick = ()=>{
    hide('colorOverlay');
    if(pendingWild){ sendPlay(pendingWild.index, sw.dataset.color); pendingWild = null; }
  };
});

$('roomCodeVal').onclick = ()=>{
  navigator.clipboard?.writeText(roomCode).then(()=>{
    $('copyHint').textContent = 'Kopiert ✓';
    setTimeout(()=> $('copyHint').textContent='Tippen zum Kopieren', 1500);
  });
};

$('startBtn').onclick = ()=>{ game.handSize = chosenHandSize; startGame(); };

$('nextBtn').onclick = ()=>{
  if(!isHost) return;
  hide('winnerOverlay');
  startGame();
};

$('name').addEventListener('keydown', e=>{ if(e.key==='Enter') $('join').focus(); });
$('join').addEventListener('keydown', e=>{ if(e.key==='Enter') joinRoom(); });

/* ---------- Schutz gegen versehentliches Neuladen ---------- */
window.addEventListener('beforeunload', function (e) {
  if (roomCode) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- Start: Profil laden & anzeigen ---------- */
function updateIdLine(){
  const n = $('name').value.trim();
  if(n){ $('idLine').innerHTML = `🏆 <b>${winsFor(n)}</b> Siege als „${escapeHtml(n)}"`; }
  else { $('idLine').textContent = 'Gib einen Namen ein – darunter werden deine Siege gespeichert.'; }
}
loadIdentity();
if(ME.name) $('name').value = ME.name;
$('name').addEventListener('input', updateIdLine);
updateIdLine();
updateHandSizeUI();