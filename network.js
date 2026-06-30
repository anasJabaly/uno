/* ============================================================
   network.js – Peer-to-Peer (PeerJS) & Nachrichten
   ============================================================ */

/* ============================================================
   ICE-Server (STUN + TURN)
   ------------------------------------------------------------
   STUN findet die öffentliche IP; TURN leitet weiter, wenn eine
   direkte Verbindung scheitert (z.B. Handy im Mobilfunk/CGNAT).
   TURN-Daten werden bei jedem Start frisch von metered.ca geholt.
   ============================================================ */
const METERED_APP = CONFIG.METERED_APP;
const METERED_KEY = CONFIG.METERED_KEY;

/* Start-Fallback: nur STUN (falls der TURN-Abruf scheitert) */
let ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};
let iceLoaded = false;

async function ensureIce(){
  if(iceLoaded) return;
  try{
    const res = await fetch(`https://${METERED_APP}/api/v1/turn/credentials?apiKey=${METERED_KEY}`);
    const servers = await res.json();
    if(Array.isArray(servers) && servers.length){
      ICE = { iceServers: servers };
      iceLoaded = true;
    }
  }catch(e){
    console.warn('TURN-Daten konnten nicht geladen werden – nutze nur STUN.', e);
  }
}

function genCode(){
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<4;i++) s += c[Math.floor(Math.random()*c.length)];
  return s;
}

/* ---------- HOST: Raum erstellen ---------- */
async function createRoom(){
  myName = $('name').value.trim();
  if(!myName){ lobbyMsg('Bitte gib zuerst deinen Namen ein.','err'); return; }
  ME.name = myName; saveIdentity();
  isHost = true; roomCode = genCode();
  lobbyMsg('Raum wird erstellt…','ok');

  await ensureIce();
  peer = new Peer('uno-'+roomCode, { config: ICE });

  // Bei kurzem Verbindungsabriss (Leerlauf) automatisch neu verbinden
  peer.on('disconnected', ()=>{ try{ peer.reconnect(); }catch(e){} });

  peer.on('open', id=>{
    myId = id;
    game = {
      players: [{ id:myId, name:myName, hand:[], score:0, wins:ME.wins||0, saidUno:false }],
      deck:[], discard:[], currentIndex:0, direction:1, currentColor:null,
      started:false, winner:null, champion:null, lastRound:null,
      handSize:7, drawStack:0
    };
    enterWaitingRoom();
  });

  peer.on('connection', conn=>{
    conn.on('open', ()=> connections.push(conn));
    conn.on('data', data=> handleClientMessage(conn, data));
    conn.on('close', ()=> removePlayer(conn.peer));
  });

  peer.on('error', err=>{
    if(err.type === 'unavailable-id'){ peer.destroy(); isHost=false; createRoom(); }
    else lobbyMsg('Verbindungsfehler: '+err.type, 'err');
  });
}

/* ---------- CLIENT: Raum beitreten ---------- */
async function joinRoom(){
  myName = $('name').value.trim();
  const code = $('join').value.trim().toUpperCase();
  if(!myName){ lobbyMsg('Bitte gib zuerst deinen Namen ein.','err'); return; }
  if(code.length !== 4){ lobbyMsg('Der Raumcode hat 4 Zeichen.','err'); return; }
  ME.name = myName; saveIdentity();
  isHost = false; roomCode = code;
  lobbyMsg('Verbinde mit Raum '+code+'…','ok');

  await ensureIce();
  peer = new Peer({ config: ICE });

  // Bei kurzem Verbindungsabriss (Leerlauf) automatisch neu verbinden
  peer.on('disconnected', ()=>{ try{ peer.reconnect(); }catch(e){} });

  peer.on('open', id=>{
    myId = id;
    hostConn = peer.connect('uno-'+code, { reliable:true });
    const failTimer = setTimeout(()=>{
      lobbyMsg('Kein Raum mit diesem Code gefunden. Tippfehler? Ist der Host online?','err');
    }, 7000);
    hostConn.on('open', ()=>{
      clearTimeout(failTimer);
      hostConn.send({ type:'join', name:myName, wins:ME.wins||0 });
    });
    hostConn.on('data', data=> handleHostMessage(data));
    hostConn.on('close', ()=> toast('Verbindung zum Host verloren.'));
  });

  peer.on('error', err=>{
    if(err.type === 'peer-unavailable') lobbyMsg('Kein Raum mit diesem Code gefunden.','err');
    else lobbyMsg('Fehler: '+err.type,'err');
  });
}

function lobbyMsg(t, kind){ const m = $('lobbyMsg'); m.textContent = t; m.className = 'msg ' + (kind||''); }

/* ---------- Warteraum & Lobby-Sync ---------- */
function enterWaitingRoom(){
  hide('lobby'); show('waiting');
  $('roomCodeVal').textContent = roomCode;
  if(isHost){
    show('startBtn'); show('handSizeCtrl');
    $('waitHint').textContent = 'Startkarten wählen, dann starten.';
  }
  if(isHost) broadcastLobby();
}

function broadcastLobby(){
  const lite = game.players.map(p=>({id:p.id, name:p.name, wins:p.wins||0}));
  renderPlayersList(lite, myId);
  connections.forEach(c=> c.send({type:'lobby', players:lite, hostId:myId}));
}

/* ---------- HOST: Nachrichten von Clients ---------- */
function handleClientMessage(conn, data){
  if(data.type === 'join'){
    if(game.started){ conn.send({type:'reject', msg:'Spiel läuft bereits.'}); return; }
    if(game.players.find(p=>p.id===conn.peer)) return;
    game.players.push({ id:conn.peer, name:(data.name||'Spieler').slice(0,14), hand:[], score:0, wins:data.wins||0, saidUno:false });
    broadcastLobby();
    toast(data.name + ' ist beigetreten.');
  }
  else if(data.type === 'play'){ playCard(conn.peer, data.index, data.color); }
  else if(data.type === 'draw'){ drawAction(conn.peer); }
  else if(data.type === 'pass'){ passTurn(conn.peer); }
  else if(data.type === 'uno'){ sayUno(conn.peer); }
}

function connFor(pid){ return connections.find(c=>c.peer===pid); }

function removePlayer(pid){
  if(!game) return;
  const idx = game.players.findIndex(p=>p.id===pid);
  if(idx === -1) return;
  const left = game.players[idx];
  game.players.splice(idx,1);
  connections = connections.filter(c=>c.peer!==pid);
  if(game.players.length === 0) return;
  if(game.currentIndex >= game.players.length) game.currentIndex = 0;
  else if(idx < game.currentIndex) game.currentIndex--;
  if(game.started){ broadcastState({kind:'left'}); toast(left.name+' hat den Raum verlassen.'); }
  else broadcastLobby();
}

/* ---------- Zustand an alle verteilen ---------- */
function broadcastState(event){
  game.players.forEach(p=>{
    const view = makeView(p.id);
    view.event = event || null;
    if(p.id === myId) renderGame(view);
    else { const c = connFor(p.id); if(c) c.send(view); }
  });
}

/* ---------- CLIENT: Nachrichten vom Host ---------- */
function handleHostMessage(data){
  switch(data.type){
    case 'lobby':     enterWaitingRoomClient(data); break;
    case 'gameStart': enterGameScreen(); break;
    case 'state':     renderGame(data); break;
    case 'reject':    toast(data.msg || 'Ungültiger Zug.'); break;
  }
}

function enterWaitingRoomClient(data){
  hide('lobby'); show('waiting');
  $('roomCodeVal').textContent = roomCode;
  renderPlayersList(data.players, data.hostId);
}