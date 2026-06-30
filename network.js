/* ============================================================
   network.js – Peer-to-Peer-Verbindung (PeerJS) & Nachrichten
   ------------------------------------------------------------
   Host = autoritativer Spielzustand. Clients senden Aktionen,
   der Host validiert (in game.js), rechnet und schickt jedem
   seine eigene Sicht zurück.
   ============================================================ */

/* 4-stelligen Raumcode erzeugen (ohne leicht verwechselbare Zeichen) */
function genCode(){
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<4;i++) s += c[Math.floor(Math.random()*c.length)];
  return s;
}

/* ---------- HOST: Raum erstellen ---------- */
function createRoom(){
  myName = $('name').value.trim();
  if(!myName){ lobbyMsg('Bitte gib zuerst deinen Namen ein.','err'); return; }
  isHost = true;
  roomCode = genCode();
  lobbyMsg('Raum wird erstellt…','ok');

  peer = new Peer('uno-'+roomCode);

  peer.on('open', id=>{
    myId = id;
    // Host ist selbst Spieler 0
    game = {
      players: [{ id:myId, name:myName, hand:[] }],
      deck: [], discard: [], currentIndex:0, direction:1,
      currentColor:null, started:false, winner:null
    };
    enterWaitingRoom();
  });

  peer.on('connection', conn=>{
    conn.on('open', ()=> connections.push(conn));
    conn.on('data', data=> handleClientMessage(conn, data));
    conn.on('close', ()=> removePlayer(conn.peer));
  });

  peer.on('error', err=>{
    if(err.type === 'unavailable-id'){
      peer.destroy(); isHost=false; createRoom();   // Code vergeben -> neuen nehmen
    } else {
      lobbyMsg('Verbindungsfehler: '+err.type, 'err');
    }
  });
}

/* ---------- CLIENT: Raum beitreten ---------- */
function joinRoom(){
  myName = $('name').value.trim();
  const code = $('join').value.trim().toUpperCase();
  if(!myName){ lobbyMsg('Bitte gib zuerst deinen Namen ein.','err'); return; }
  if(code.length !== 4){ lobbyMsg('Der Raumcode hat 4 Zeichen.','err'); return; }

  isHost = false; roomCode = code;
  lobbyMsg('Verbinde mit Raum '+code+'…','ok');
  peer = new Peer();

  peer.on('open', id=>{
    myId = id;
    hostConn = peer.connect('uno-'+code, { reliable:true });

    const failTimer = setTimeout(()=>{
      lobbyMsg('Kein Raum mit diesem Code gefunden. Tippfehler? Ist der Host online?','err');
    }, 7000);

    hostConn.on('open', ()=>{
      clearTimeout(failTimer);
      hostConn.send({ type:'join', name:myName });
    });
    hostConn.on('data', data=> handleHostMessage(data));
    hostConn.on('close', ()=> toast('Verbindung zum Host verloren.'));
  });

  peer.on('error', err=>{
    if(err.type === 'peer-unavailable'){
      lobbyMsg('Kein Raum mit diesem Code gefunden.','err');
    } else {
      lobbyMsg('Fehler: '+err.type,'err');
    }
  });
}

function lobbyMsg(t, kind){
  const m = $('lobbyMsg'); m.textContent = t; m.className = 'msg ' + (kind||'');
}

/* ============================================================
   HOST: Warteraum & Lobby-Sync
   ============================================================ */
function enterWaitingRoom(){
  hide('lobby'); show('waiting');
  $('roomCodeVal').textContent = roomCode;
  if(isHost){
    show('startBtn');
    $('waitHint').textContent = 'Sobald alle da sind, starte das Spiel.';
  }
  if(isHost) broadcastLobby();
}

function broadcastLobby(){
  const lite = game.players.map(p=>({id:p.id, name:p.name}));
  renderPlayersList(lite, myId);                 // Host selbst
  connections.forEach(c=> c.send({type:'lobby', players:lite, hostId:myId}));
}

/* ============================================================
   HOST: Nachrichten von Clients
   ============================================================ */
function handleClientMessage(conn, data){
  if(data.type === 'join'){
    if(game.started){ conn.send({type:'reject', msg:'Spiel läuft bereits.'}); return; }
    if(game.players.find(p=>p.id===conn.peer)) return;
    game.players.push({ id:conn.peer, name:(data.name||'Spieler').slice(0,14), hand:[] });
    broadcastLobby();
    toast(data.name + ' ist beigetreten.');
  }
  else if(data.type === 'play'){ playCard(conn.peer, data.index, data.color); }
  else if(data.type === 'draw'){ drawAction(conn.peer); }
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
  if(game.started){ broadcastState(); toast(left.name+' hat den Raum verlassen.'); }
  else broadcastLobby();
}

/* Jedem Spieler seine persönliche Sicht schicken (Host rendert lokal) */
function broadcastState(){
  game.players.forEach(p=>{
    const view = makeView(p.id);
    if(p.id === myId) renderGame(view);
    else { const c = connFor(p.id); if(c) c.send(view); }
  });
}

/* ============================================================
   CLIENT: Nachrichten vom Host
   ============================================================ */
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
