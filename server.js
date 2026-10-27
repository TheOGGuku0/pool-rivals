import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Game} from './js/game.js';
import {STEP} from './js/physics.js';
import {upgrade} from './js/websocket-server.js';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const nameOf=x=>typeof x==='string'?x.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,24)||'Player':'Player';
const tokenEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createPoolServer(){
  const rooms=new Map(),peers=new Set();let last=performance.now(),accumulator=0,broadcastElapsed=0;
  const server=http.createServer(async(req,res)=>{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
    if(name==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}));return;}
    if(name==='/')name='/index.html';
    if(!/^\/(index\.html|style\.css|js\/[a-z-]+\.js)$/.test(name)||name==='/js/websocket-server.js'){res.writeHead(404);res.end('Not found');return;}
    try{const bytes=await readFile(path.join(ROOT,name.slice(1)));res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'"});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404);res.end('Not found');}
  });
  const error=(p,message,fatal=false)=>p.send({type:'error',message,fatal});
  const ready=r=>r.players.length===2&&r.players.every(p=>p.peer&&!p.peer.closed);
  function broadcast(room){
    const msg={type:'state',state:room.game.snapshot(),room:{code:room.code,ready:ready(room),players:room.players.map(p=>({name:p.name,connected:!!p.peer&&!p.peer.closed})),rematchVotes:[...room.votes]}};
    for(const p of room.players)p.peer?.send(msg);
  }
  function attached(peer){const room=rooms.get(peer.room);if(!room)return null;const player=room.players[peer.seat];if(player?.peer!==peer)return null;return room;}
  function addPlayer(room,peer,name){const seat=room.players.length,token=randomBytes(24).toString('hex');room.players.push({name:nameOf(name),token,peer,disconnectedAt:0});peer.room=room.code;peer.seat=seat;peer.send({type:'joined',code:room.code,token,seat});broadcast(room);}
  function leave(peer,concede=false){const room=attached(peer);if(!room)return;const player=room.players[peer.seat];player.peer=null;player.disconnectedAt=Date.now();peer.room=null;if(concede){player.token='';if(room.players.length===2){room.game.state.winner=1-peer.seat;room.game.state.phase='over';room.game.state.message=`${player.name} left the table.`;}}broadcast(room);}
  function process(peer,msg){
    const now=Date.now();if(now-peer.windowStart>1000){peer.windowStart=now;peer.count=0;}if(++peer.count>35){error(peer,'Too many actions. Please wait a moment.');return;}
    if(msg.type==='create'){
      if(peer.room){error(peer,'Leave your current room first.');return;}if(rooms.size>=100){error(peer,'The server is full. Try again later.');return;}
      let code;do{code=randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(rooms.has(code));
      const room={code,game:new Game(randomBytes(4).readUInt32LE()),players:[],votes:new Set(),events:[],created:now};
      room.game.onEvent=e=>{if(room.events.length<80)room.events.push(e);};rooms.set(code,room);addPlayer(room,peer,msg.name);return;
    }
    if(msg.type==='join'){
      if(peer.room){error(peer,'Leave your current room first.');return;}const room=rooms.get(typeof msg.code==='string'?msg.code.toUpperCase():'');
      if(!room){error(peer,'That room was not found. Check the six-character code.');return;}if(room.players.length>=2){error(peer,'This table already has two players.');return;}addPlayer(room,peer,msg.name);return;
    }
    if(msg.type==='resume'){
      const room=rooms.get(msg.code),seat=room?.players.findIndex(p=>tokenEqual(p.token,msg.token));
      if(!room||seat===-1||seat===undefined){error(peer,'Your previous room has expired. Create a new table.',true);return;}
      const player=room.players[seat];if(player.peer&&player.peer!==peer){player.peer.room=null;player.peer.close();}
      peer.room=room.code;peer.seat=seat;player.peer=peer;player.disconnectedAt=0;peer.send({type:'joined',code:room.code,seat,token:player.token});broadcast(room);return;
    }
    if(msg.type==='leave'){leave(peer,true);return;}
    const room=attached(peer);if(!room){error(peer,'Join a room before playing.');return;}
    if(msg.type==='rematch'){
      if(!ready(room)){error(peer,'Both players must be connected for a rematch.');return;}
      room.votes.add(peer.seat);for(const player of room.players)player.peer?.send({type:'notice',message:`${room.players[peer.seat].name} requested a rematch. Use New rack to agree.`});
      if(room.votes.size===2){room.game.reset(Date.now(),1-room.game.state.starter);room.votes.clear();room.events=[];}
      broadcast(room);return;
    }
    if(!ready(room)){error(peer,'Wait for your opponent to connect.');return;}
    let accepted=false;
    if(msg.type==='place')accepted=room.game.place(msg.x,msg.y,peer.seat);
    if(msg.type==='shot')accepted=room.game.shoot(msg.action,peer.seat);
    if(msg.type==='choice')accepted=room.game.choose(msg.option,peer.seat);
    if(!accepted)error(peer,'Action rejected: check your turn, cue placement, and called shot.');
    else{room.votes.clear();broadcast(room);}
  }
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/pool'||peers.size>=200){socket.end('HTTP/1.1 404 Not Found\r\n\r\n');return;}
    if(req.headers.origin){let host;try{host=new URL(req.headers.origin).host;}catch{}if(host!==req.headers.host){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}}
    upgrade(req,socket,head,peer=>{peers.add(peer);peer.windowStart=Date.now();peer.count=0;peer.onMessage=msg=>process(peer,msg);peer.onClose=()=>{leave(peer);peers.delete(peer);};});
  });
  const tick=setInterval(()=>{
    const now=performance.now(),elapsed=Math.min((now-last)/1000,.25);last=now;accumulator+=elapsed;broadcastElapsed+=elapsed;
    while(accumulator>=STEP){for(const room of rooms.values())if(ready(room))room.game.tick(STEP);accumulator-=STEP;}
    if(broadcastElapsed>=1/30){broadcastElapsed=0;for(const room of rooms.values()){
      if(room.game.state.phase==='moving'&&ready(room))broadcast(room);
      if(room.events.length){for(const p of room.players)p.peer?.send({type:'events',events:room.events});room.events=[];broadcast(room);}
    }}
  },1000/120);
  const cleanup=setInterval(()=>{
    const now=Date.now();for(const peer of peers)peer.ping();
    for(const [code,room] of rooms){
      if(room.players.every(p=>!p.peer)&&room.players.every(p=>now-p.disconnectedAt>60000)){rooms.delete(code);continue;}
      if(room.game.state.phase!=='over')for(let i=0;i<room.players.length;i++){const p=room.players[i];if(!p.peer&&now-p.disconnectedAt>60000&&room.players.length===2&&room.players[1-i].peer){room.game.state.phase='over';room.game.state.winner=1-i;room.game.state.message='Opponent did not reconnect within 60 seconds.';broadcast(room);break;}}
    }
  },5000);
  const stop=()=>{clearInterval(tick);clearInterval(cleanup);for(const p of peers)p.close();};server.on('close',stop);
  return {server,rooms,stop};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT)||3000,host=process.env.HOST||'127.0.0.1';const {server}=createPoolServer();
  server.listen(port,host,()=>console.log(`Eight Ball Club is ready: http://${host==='0.0.0.0'?'localhost':host}:${port}\nPrivate rooms use this same server. Ctrl+C to stop.`));
  server.on('error',e=>{console.error(`Could not start the table: ${e.message}`);process.exitCode=1;});
}
