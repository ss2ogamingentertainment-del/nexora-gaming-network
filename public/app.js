const $ = id => document.getElementById(id);
let user = null, socket = null, authMode = "login", activeRoom = null, currentGame = null;
const gameGrid = $("gameGrid");

function renderGames() {
  gameGrid.innerHTML = window.NEXORA_GAMES.map(g => `
    <article class="game-card">
      <div class="game-art" style="--art:${g.art}">${g.icon}</div>
      <div class="game-info"><span class="tag">${g.category}</span><h3>${g.name}</h3><p>${g.desc}</p>
        <div class="game-meta"><span class="muted">Browser game</span><button class="small-btn" data-play="${g.id}">Play now →</button></div>
      </div>
    </article>`).join("");
  $("roomGame").innerHTML = window.NEXORA_GAMES.map(g => `<option value="${g.id}">${g.name}</option>`).join("");
}
renderGames();

async function api(url, body) {
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: body ? {"Content-Type":"application/json"} : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function updateAccount() {
  $("accountArea").innerHTML = user
    ? `<span class="muted">PLAYER</span> <strong>${escapeHtml(user.username)}</strong> <button class="btn btn-outline" id="logoutBtn">Sign out</button>`
    : `<button class="btn btn-outline" id="openAuth">Sign in</button>`;
  $("openAuth")?.addEventListener("click", () => $("authDialog").showModal());
  $("logoutBtn")?.addEventListener("click", logout);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function refreshUser() {
  try { user = (await api("/api/me")).user; } catch { user = null; }
  updateAccount();
}
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io();
  socket.on("connect_error", () => {});
  socket.on("room:update", room => { if (activeRoom?.code === room.code) renderRoom(room); });
  socket.on("game:started", ({game}) => { showGame(game, true); });
  socket.on("game:action", data => { window.dispatchEvent(new CustomEvent("nexora:remote-action",{detail:data})); });
}
async function logout() {
  try { await api("/api/logout", {}); } catch {}
  if (socket) socket.disconnect();
  socket = null; user = null; activeRoom = null; $("roomLive").classList.add("hidden"); updateAccount();
}
$("openAuth")?.addEventListener("click", () => $("authDialog").showModal());
document.querySelectorAll(".auth-tabs button").forEach(b => b.addEventListener("click", () => setAuthMode(b.dataset.mode)));
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll(".auth-tabs button").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  $("authTitle").textContent = mode === "login" ? "Welcome back" : "Create your player account";
  $("authSubmit").textContent = mode === "login" ? "Sign in" : "Create account";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("authError").textContent = "";
}
$("authForm").addEventListener("submit", async e => {
  e.preventDefault(); $("authError").textContent = "";
  try {
    const result = await api(authMode === "login" ? "/api/login" : "/api/register", {username:$("username").value.trim(),password:$("password").value});
    user = result.user; updateAccount(); $("authDialog").close(); $("authForm").reset(); connectSocket();
  } catch (err) { $("authError").textContent = err.message; }
});
function ensureSignedIn() {
  if (!user) { $("authDialog").showModal(); return false; }
  if (!socket || !socket.connected) connectSocket();
  return true;
}
$("createRoom").addEventListener("click", () => {
  if (!ensureSignedIn()) return;
  socket.emit("room:create",{game:$("roomGame").value,privateRoom:$("privateRoom").checked}, result => {
    if (result.error) return alert(result.error);
    activeRoom = result.room; renderRoom(result.room);
  });
});
$("joinRoom").addEventListener("click", () => {
  if (!ensureSignedIn()) return;
  socket.emit("room:join",{code:$("roomCode").value.trim()}, result => {
    if (result.error) return alert(result.error);
    activeRoom = result.room; renderRoom(result.room);
  });
});
function renderRoom(room) {
  activeRoom = room;
  const game = window.NEXORA_GAMES.find(g=>g.id===room.game);
  $("roomLive").classList.remove("hidden");
  $("roomLive").innerHTML = `<div class="section-heading"><div><p class="eyebrow">ROOM READY</p><h3>${escapeHtml(game?.name || room.game)}</h3></div><span class="tag">${room.players.length}/${room.maxPlayers} PLAYERS</span></div>
    <p class="muted">Share this code with your friends:</p><div class="score">${room.code}</div>
    <div class="player-list">${room.players.map(p=>`<span class="player-pill">${escapeHtml(p.username)} ${p.username===room.host?"★ HOST":""}</span>`).join("")}</div>
    <p class="hint">The room is hosted online. Friends can join from another network using this code.</p>
    <button class="btn btn-primary" id="startGame">${room.host===user?.username?"Start game":"Waiting for host…"}</button>`;
  $("startGame").disabled = room.host !== user?.username;
  $("startGame").addEventListener("click",()=>socket.emit("game:start"));
}
gameGrid.addEventListener("click", e => {
  const id = e.target.closest("[data-play]")?.dataset.play;
  if (!id) return;
  if (!ensureSignedIn()) return;
  showGame(id, false);
});
$("closeGame").addEventListener("click",()=>{$("gameDialog").close();currentGame=null;});
function showGame(id, fromRoom) {
  const g = window.NEXORA_GAMES.find(x=>x.id===id); if (!g) return;
  currentGame = id; $("gameTitle").textContent = g.name; $("gameHint").textContent = g.hint;
  const stage = $("gameStage"); stage.innerHTML = "";
  if (id === "football") footballGame(stage);
  else if (id === "cricket") cricketGame(stage);
  else if (id === "steal-egg") eggGame(stage);
  else if (id === "racing") racingGame(stage);
  else simpleGame(stage,g);
  if (!$("gameDialog").open) $("gameDialog").showModal();
}
function sendAction(payload) { if(socket?.connected) socket.emit("game:action",payload); }
function footballGame(stage) {
  let score=0, shots=0;
  stage.innerHTML=`<div><div class="score" id="fScore">0</div><p>GOALS · <span id="fShots">0</span> SHOTS</p><p>Choose a corner to take your penalty.</p><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="stage-button" data-shot="left">↖ Left</button><button class="stage-button" data-shot="center">↑ Center</button><button class="stage-button" data-shot="right">↗ Right</button></div><p id="fResult" class="muted"></p></div>`;
  stage.querySelectorAll("[data-shot]").forEach(b=>b.onclick=()=>{shots++;const goal=Math.random()>.35;if(goal)score++;$("fScore").textContent=score;$("fShots").textContent=shots;$("fResult").textContent=goal?"GOAL! Great shot!":"Saved by the keeper!";sendAction({type:"football-shot",value:goal?1:0});});
}
function cricketGame(stage) {
  let score=0, balls=0, active=false, timer;
  stage.innerHTML=`<div><div class="score" id="cScore">0</div><p>RUNS · <span id="cBalls">0</span> BALLS</p><p id="cPrompt">Wait for the green signal, then tap HIT.</p><button class="stage-button" id="hitBtn" disabled>HIT</button><p id="cResult" class="muted"></p></div>`;
  const btn=$("hitBtn");
  function next(){if(balls>=6){$("cPrompt").textContent="Over complete! Refresh to play again.";return;}active=false;btn.disabled=true;$("cPrompt").textContent="Bowler is running in…";timer=setTimeout(()=>{active=true;btn.disabled=false;$("cPrompt").textContent="NOW!";},900+Math.random()*1500);}
  btn.onclick=()=>{if(!active)return;active=false;clearTimeout(timer);balls++;const runs=[0,1,2,4,6][Math.floor(Math.random()*5)];score+=runs;$("cScore").textContent=score;$("cBalls").textContent=balls;$("cResult").textContent=runs===0?"Dot ball!":`${runs} runs!`;sendAction({type:"cricket-hit",value:runs});next();};
  next();
}
function eggGame(stage) {
  stage.innerHTML=`<div><p><strong>Golden Egg Arena</strong></p><canvas class="game-canvas" id="eggCanvas" width="560" height="300"></canvas><p class="muted">Move with WASD or arrow keys. Find the egg, then return to your base.</p><p id="eggStatus" class="muted">You are the blue player. Collect the golden egg!</p></div>`;
  const c=$("eggCanvas"),ctx=c.getContext("2d");let p={x:50,y:150},egg={x:280,y:150},got=false,base={x:30,y:130,w:45,h:40};
  function draw(){ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle="#163b36";ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle="#4e8b75";ctx.strokeRect(5,5,c.width-10,c.height-10);ctx.fillStyle="#357de0";ctx.fillRect(base.x,base.y,base.w,base.h);ctx.fillStyle="#f7cf53";ctx.beginPath();ctx.arc(got?p.x:egg.x,got?p.y:egg.y,10,0,Math.PI*2);ctx.fill();ctx.fillStyle="#64d9ff";ctx.beginPath();ctx.arc(p.x,p.y,11,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fff";ctx.font="12px Arial";ctx.fillText("YOUR BASE",15,120);if(got&&p.x<75&&p.y>120&&p.y<180){$("eggStatus").textContent="You returned the egg! You win this round.";}}
  function move(e){let k=e.key.toLowerCase(),dx=0,dy=0;if(k==="arrowleft"||k==="a")dx=-8;if(k==="arrowright"||k==="d")dx=8;if(k==="arrowup"||k==="w")dy=-8;if(k==="arrowdown"||k==="s")dy=8;if(!dx&&!dy)return;e.preventDefault();p.x=Math.max(15,Math.min(545,p.x+dx));p.y=Math.max(15,Math.min(285,p.y+dy));if(Math.hypot(p.x-egg.x,p.y-egg.y)<20)got=true;sendAction({type:"egg-position",x:p.x/560,y:p.y/300});draw();}
  window.addEventListener("keydown",move);draw();$("gameDialog").addEventListener("close",()=>window.removeEventListener("keydown",move),{once:true});
  window.addEventListener("nexora:remote-action",e=>{if(e.detail.type==="egg-position"){$("eggStatus").textContent=`${e.detail.username} is moving in the arena.`;}});
}
function racingGame(stage) {
  stage.innerHTML=`<div><div class="score" id="rScore">0</div><p>DRIVE SCORE</p><canvas class="game-canvas" id="raceCanvas" width="420" height="300"></canvas><p class="muted">Use ← and → to change lanes. Avoid the blocks.</p><button class="stage-button" id="raceStart">Start race</button></div>`;
  const c=$("raceCanvas"),ctx=c.getContext("2d");let lane=1,obstacles=[],score=0,running=false,raf;
  function frame(){if(!running)return;ctx.fillStyle="#263344";ctx.fillRect(0,0,420,300);ctx.strokeStyle="#eee";ctx.setLineDash([18,15]);ctx.beginPath();ctx.moveTo(140,0);ctx.lineTo(140,300);ctx.moveTo(280,0);ctx.lineTo(280,300);ctx.stroke();ctx.setLineDash([]);if(Math.random()<.025)obstacles.push({lane:Math.floor(Math.random()*3),y:-30});obstacles.forEach(o=>o.y+=4);obstacles=obstacles.filter(o=>o.y<330);ctx.fillStyle="#e46d55";obstacles.forEach(o=>ctx.fillRect(25+o.lane*140,o.y,40,28));ctx.fillStyle="#64e6f2";ctx.fillRect(35+lane*140,245,30,40);if(obstacles.some(o=>o.lane===lane&&o.y>225&&o.y<280)){running=false;$("gameHint").textContent="Crash! Press Start race to try again.";}else{score++;$("rScore").textContent=score;raf=requestAnimationFrame(frame);}}
  function key(e){if(e.key==="ArrowLeft")lane=Math.max(0,lane-1);if(e.key==="ArrowRight")lane=Math.min(2,lane+1);}window.addEventListener("keydown",key);
  $("raceStart").onclick=()=>{cancelAnimationFrame(raf);lane=1;score=0;obstacles=[];running=true;$("gameHint").textContent="Avoid the traffic!";frame();};
  $("gameDialog").addEventListener("close",()=>window.removeEventListener("keydown",key),{once:true});
}
function simpleGame(stage,g) {
  stage.innerHTML=`<div><div style="font-size:64px">${g.icon}</div><h3>${g.name}</h3><p class="muted">${g.hint}</p><button class="stage-button" id="simpleAction">Explore demo</button><p id="simpleResult" class="muted"></p></div>`;
  $("simpleAction").onclick=()=>{$("simpleResult").textContent="Demo launched! This game is ready for its full gameplay module.";sendAction({type:"demo-action",value:1});};
}
refreshUser().then(()=>{if(user)connectSocket();});
