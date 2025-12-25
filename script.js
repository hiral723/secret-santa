// script.js - auth-aware participants & secure reveal
(function(){
  console.log('Secret Santa v-auth script starting');

  const $ = id => document.getElementById(id);
  const log = (...a)=>console.log(...a), err = (...a)=>console.error(...a);

  // helpers for UI
  function setMessage(msg){ const el = $('message'); if(el) el.textContent = msg; log('msg ->', msg); }
  function setRoomCodeUI(code){ const rc = $('roomCode'); if(rc) rc.textContent = code; const inp = $('roomCodeInput'); if(inp) inp.value = code; }

  // firebase objects should be exposed by index.html init module
  function hasFirebase(){ return !!window.db && !!window.ref && !!window.auth && !!window.get; }
  const db = () => window.db;
  const ref = (path) => window.ref(window.db, path);
  const dbGet = async (path) => await window.get(window.ref(window.db, path));
  const dbSet = async (path, val) => await window.set(window.ref(window.db, path), val);
  const onVal = (p, cb, errCb) => window.onValue(window.ref(window.db, p), cb, errCb);

  // current user (updated by auth listener)
  let currentUser = null;

  // Auth state: update currentUser when sign-in completes
  if(window.onAuthStateChanged && window.auth){
    window.onAuthStateChanged(window.auth, (user) => {
      if(user){
        currentUser = user;
        log('Auth ready uid:', user.uid);
        // optional: show small UI indicator of signed-in user
        const nameInput = $('nameInput');
        if(nameInput) nameInput.placeholder = 'Your name (signed in)';
      } else {
        log('Not signed in');
      }
    });
  } else {
    console.warn('Auth not available on window - ensure index.html init uses auth import');
  }

  // UI "navigation" (same single-page behavior you had)
  function showRoomView(code, {isHost=false, message} = {}){
    const main = $('main-menu'), room = $('room-section');
    if(main) main.classList.add('hidden'); if(room) room.classList.remove('hidden');
    setRoomCodeUI(code);
    setMessage(message || ('In room: ' + code));
    if(isHost){ const ab = $('assignBtn'); if(ab) ab.classList.remove('hidden'); }
  }
  function showMainView(){ const main = $('main-menu'), room = $('room-section'); if(room) room.classList.add('hidden'); if(main) main.classList.remove('hidden'); }

  // generate code
  const genCode = () => Math.random().toString(36).slice(2,8).toUpperCase();

  // ADD PARTICIPANT: writes to rooms/{room}/participants/{uid}
  async function addParticipant(){
    if(!currentUser) { setMessage('Not signed in yet. Wait a moment.'); return; }
    const nameEl = $('nameInput'); const name = nameEl && nameEl.value && nameEl.value.trim();
    const currentRoom = ($('roomCode') && $('roomCode').textContent) || ($('roomCodeInput') && $('roomCodeInput').value);
    if(!currentRoom) return setMessage('Create or join a room first');
    if(!name) return setMessage('Enter your name');

    setMessage('Joining as ' + name + '...');
    const uid = currentUser.uid;
    try {
      // check if this uid already in participants for this room
      const snap = await dbGet(`rooms/${currentRoom}/participants/${uid}`);
      if(snap && snap.exists()){
        setMessage('You already joined this room with name: ' + snap.val().name);
        // optionally update name? we keep one name per uid by default
        return;
      }

      // write participant under uid
      const participantObj = { name, uid, createdAt: Date.now() };
      await dbSet(`rooms/${currentRoom}/participants/${uid}`, participantObj);
      setMessage(`${name} added to ${currentRoom}`);
      // clear input after success
      if(nameEl) nameEl.value = '';
    } catch(e){
      err('addParticipant error', e);
      setMessage('Failed to join room (see console)');
    }
  }

  // CREATE ROOM - same as before but create initial participants map
  async function createRoom(){
    const code = genCode();
    setRoomCodeUI(code);
    showRoomView(code, { isHost: true, message: 'Room created: ' + code });
    try {
      if(hasFirebase()){
        await dbSet(`rooms/${code}`, { createdAt: Date.now(), ownerUid: currentUser.uid, participants: {} });
        setMessage('Room created on Firebase: ' + code);
      } else {
        setMessage('Room created locally: ' + code);
      }
    } catch(e){
      err('createRoom error', e);
      setMessage('Failed to create room on Firebase');
    }
    window.__ss_current_room = code;
    window.__ss_is_host = true;
  }

  // JOIN ROOM - verify room exists, then show view
  async function joinRoom(){
    const inp = $('roomCodeInput'); const code = inp && inp.value && inp.value.trim();
    if(!code) return setMessage('Enter a room code to join');
    setMessage('Joining room ' + code + '...');
    if(hasFirebase()){
      try {
        const snap = await dbGet(`rooms/${code}`);
        if(!snap.exists()) return setMessage('Room not found: ' + code);
      } catch(e){
        err('joinRoom read error', e);
        setMessage('Error checking room; joining locally');
      }
    }
    showRoomView(code, { isHost: false, message: 'Joined room: ' + code });
    if(inp) inp.value = '';
  }

  // ASSIGN GIFTS (host only) - compute derangement over participants' uids and save uid->uid map
  async function assignGifts(){
    const currentRoom = ($('roomCode') && $('roomCode').textContent) || ($('roomCodeInput') && $('roomCodeInput').value);
    if(!currentRoom) return setMessage('No room to assign');
    setMessage('Assigning gifts...');
    if(!hasFirebase()) return setMessage('No Firebase connection to persist assignments');

    try {
      const snap = await dbGet(`rooms/${currentRoom}/participants`);
      if(!snap.exists()) return setMessage('No participants to assign');
      const participantsMap = snap.val(); // { uid: {name, uid, ...}, ... }
      const uids = Object.keys(participantsMap);
      if(uids.length < 2) return setMessage('Need at least 2 participants');

      // derangement shuffle of uids
      function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } }
      let assignments = null;
      let tries = 0;
      while(tries++ < 5000){
        const out = uids.slice();
        shuffle(out);
        let ok = true;
        for(let i=0;i<uids.length;i++){ if(uids[i] === out[i]) { ok = false; break; } }
        if(ok){ assignments = {}; for(let i=0;i<uids.length;i++){ assignments[uids[i]] = out[i]; } break; }
      }
      if(!assignments) return setMessage('Could not compute assignments');

      // write assignments as uid -> targetUid
      await dbSet(`rooms/${currentRoom}/assignments`, assignments);
      setMessage('Assignments saved to Firebase');
      console.log('assignments', assignments);
    } catch(e){
      err('assignGifts error', e);
      setMessage('Assignment failed');
    }
  }

  // REVEAL - only reveals the assignment for the signed-in user
  async function revealGift(){
    if(!currentUser) return setMessage('Not signed in yet (wait a moment)');
    const currentRoom = ($('roomCode') && $('roomCode').textContent) || ($('roomCodeInput') && $('roomCodeInput').value);
    if(!currentRoom) return setMessage('No room selected');
    const uid = currentUser.uid;
    setMessage('Revealing your assignment...');
    if(!hasFirebase()) return setMessage('No Firebase connection');

    try {
      const snap = await dbGet(`rooms/${currentRoom}/assignments/${uid}`);
      if(!snap.exists()) return setMessage('Assignments not ready or you are not assigned');

      const targetUid = snap.val();
      // lookup target name
      const targetSnap = await dbGet(`rooms/${currentRoom}/participants/${targetUid}`);
      const targetName = (targetSnap && targetSnap.exists()) ? targetSnap.val().name : '(unknown)';
      const resultEl = $('giftResult');
      if(resultEl) resultEl.textContent = `You got: ${targetName}`;
      setMessage('Reveal complete');
    } catch(e){
      err('reveal error', e);
      setMessage('Reveal failed');
    }
  }

  // Render active rooms list realtime (optional - keeps previous watchRooms behavior)
  function renderRoomsList(roomsObj){
    const container = $('roomsList'); if(!container) return;
    const empty = $('roomsEmpty'); container.querySelectorAll('.room-item').forEach(n=>n.remove());
    if(!roomsObj){ if(empty) empty.style.display = ''; return; }
    if(empty) empty.style.display = 'none';
    Object.keys(roomsObj).sort().forEach(code=>{
      const row = document.createElement('div'); row.className='room-item'; row.style.padding='8px';
      row.style.display='flex'; row.style.justifyContent='space-between';
      const left = document.createElement('div'); left.innerHTML = `<strong>${code}</strong><div style="font-size:12px;opacity:0.85">${roomsObj[code].createdAt?new Date(roomsObj[code].createdAt).toLocaleString():'—'}</div>`;
      const actions = document.createElement('div'); const useBtn = document.createElement('button'); useBtn.textContent='Use';
      useBtn.onclick = ()=>{ const roomIn = $('roomCodeInput'); if(roomIn) roomIn.value = code; setRoomCodeUI(code); const nameInp = $('nameInput'); if(nameInp) nameInp.focus(); };
      actions.appendChild(useBtn); row.appendChild(left); row.appendChild(actions); container.appendChild(row);
    });
  }

  function watchRooms(){
    if(!hasFirebase()) return console.warn('watchRooms: no firebase');
    onVal('rooms', snap => {
      const v = (snap && snap.exists && snap.exists()) ? snap.val() : null;
      renderRoomsList(v);
    }, err => console.warn('watchRooms error', err));
  }

  // Expose for index.html onclick handlers
  window.createRoom = createRoom;
  window.joinRoom = joinRoom;
  window.addParticipant = addParticipant;
  window.assignGifts = assignGifts;
  window.revealGift = revealGift;

  // On load: attach button events and start watchRooms
  document.addEventListener('DOMContentLoaded', ()=>{
    const createBtn = $('createRoomBtn'); if(createBtn && !createBtn.onclick) createBtn.addEventListener('click', createRoom);
    const jrBtn = $('joinRoomBtn'); if(jrBtn && !jrBtn.onclick) jrBtn.addEventListener('click', joinRoom);
    const joinName = $('joinBtn'); if(joinName && !joinName.onclick) joinName.addEventListener('click', addParticipant);
    const assignBtn = $('assignBtn'); if(assignBtn && !assignBtn.onclick) assignBtn.addEventListener('click', assignGifts);
    const revealBtn = $('revealBtn'); if(revealBtn && !revealBtn.onclick) revealBtn.addEventListener('click', revealGift);

    // small delay to wait for firebase module init to set window.db etc
    setTimeout(()=>{ try{ watchRooms(); } catch(e){ console.warn('watchRooms failed', e); } }, 120);
    console.log('Auth-aware script ready');
  });
})();
