process.env.DEBUG = ''; 
require('debug').disable(); 
delete process.env.DEBUG;
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const dns = require('dns').promises;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let vStarted = false;
let bot = null;
let announceCommands = true;
let lastGrabItem = { name: 'diamond_block', amount: 64 };
const TRUSTED_USERS = ['Jmofrfr', 'Jmo_fr', 'Jmo', 'Grum'];
const PASS = 'testificate';
let hasPathfinder = false;
let Movements = null;
let goals = null;

// Helper: resolve SRV and DNS then return host/port
async function resolveHostPort(hostInput, explicitPort) {
  let host = hostInput || 'localhost';
  let port = explicitPort || undefined;

  if (typeof host === 'string' && host.includes(':')) {
    const parts = host.split(':');
    host = parts[0];
    const p = parseInt(parts[1]);
    if (!isNaN(p)) port = p;
  }

  if (!port) {
    try {
      const srv = await dns.resolveSrv(`_minecraft._tcp.${host}`);
      if (srv && srv.length) {
        host = (srv[0].name || host).replace(/\.$/, '');
        port = srv[0].port;
        console.log('SRV resolved', host, port);
      }
    } catch (e) {
      // ignore - no SRV
    }
  }

  // Do not replace the hostname with its resolved IP address here —
  // some servers/proxies expect the original hostname in the Minecraft
  // handshake (SRV/virtual hosting). Return the hostname (possibly SRV
  // target) and port so the client uses the expected server name.
  return { host, port };
}

// Create a bot with tighter lifecycle handling and clear errors
async function createBotWithTimeout(opts = {}, socket, timeoutMs = 15000) {
  const { host: rawHost, port: rawPort, username = 'JmoAI', version = '1.12.2' } = opts;
  const resolved = await resolveHostPort(rawHost, rawPort);
  const botOpts = { host: resolved.host, username, version };
  if (resolved.port) botOpts.port = resolved.port;

  console.log('createBotWithTimeout ->', botOpts);
  try { socket.emit('log', `🔌 connecting to ${botOpts.host}${botOpts.port?':' + botOpts.port:''} as ${botOpts.username}`); } catch(e) {}

  return await new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let localBot = null;

    function cleanup() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!localBot) return;
      try { localBot.removeAllListeners('spawn'); } catch(e) {}
      try { localBot.removeAllListeners('error'); } catch(e) {}
      try { localBot.removeAllListeners('end'); } catch(e) {}
      try { if (localBot._client) { localBot._client.removeAllListeners('end'); localBot._client.removeAllListeners('error'); } } catch(e) {}
    }

    function fail(err) {
      if (settled) return;
      settled = true;
      cleanup();
      try { if (localBot && localBot.quit) localBot.quit(); } catch(e) {}
      reject(err);
    }

    function succeed(b) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(b);
    }

    try {
      localBot = mineflayer.createBot({ ...botOpts, hideErrors: false });
    } catch (e) {
      return fail(e);
    }

    // immediate listeners
       // immediate listeners
    localBot.once('login', () => { 
      try { socket.emit('log', '📥 Login successful (waiting for world)'); } catch(e) {}
      succeed(localBot); 
    });

    localBot.once('spawn', () => { 
      try { socket.emit('log', '✅ spawn received'); } catch(e) {}; 
      succeed(localBot); 
    });

    localBot.once('error', (err) => { 
      console.error('bot error event (early):', err); 
      try { socket.emit('log', `⚠ bot error: ${err && (err.message || err.code) || err}`); } catch(e) {}; 
      fail(err); 
    });

    localBot.once('end', () => { 
      console.error('bot end event (early)'); 
      try { socket.emit('log', '⚠ connection ended'); } catch(e) {}; 
      fail(new Error('connection ended')); 
    });

    localBot.on('packet', (data, meta) => {
      // If we see a chat packet, we're definitely "in"
      if (meta.name === 'chat' || meta.name === 'system_chat') {
         succeed(localBot);
      }
      // Logging for hangs
      if (meta.name === 'keep_alive') console.log('💓 KeepAlive received');
    });

    // Final safety checks for the client protocol
    if (localBot._client) {
        localBot._client.once('error', (err) => { 
          console.error('mcproto client error (early):', err); 
          fail(err); 
        });
        localBot._client.once('end', () => { 
          fail(new Error('mcproto end')); 
        });
    }

    timer = setTimeout(() => { fail(new Error('timeout')); }, Math.max(timeoutMs, 30000));
  });
}


// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  let telemetry = null;
  let followInterval = null;
  let followTarget = null;
  let pvpInterval = null;
  let pvpTarget = null;

  socket.on('start', async (data) => {
    try {
      if (bot) {
        try { bot.quit(); } catch(e) {}
        bot = null;
      }

      try { if (telemetry) { clearInterval(telemetry); telemetry = null; } } catch(e) {}

      socket.emit('log', `🔎 attempting version ${data.version || '1.12.2'} ...`);

      // create bot
      bot = await createBotWithTimeout({ host: data.h, port: data.p, username: data.u, version: data.version || '1.12.2' }, socket, 20000);

      socket.emit('log', `✅ connected using ${bot.version || data.version || '1.12.2'}`);

      // start telemetry
      telemetry = setInterval(() => {
        try {
          if (bot && bot.entity) {
            socket.emit('telemetry', { x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y), z: Math.floor(bot.entity.position.z) });
          }
        } catch (e) {}
      }, 500);

      // viewer
      if (!vStarted) {
        try { mineflayerViewer(bot, { port: 3001, firstPerson: true }); vStarted = true; } catch(e) {}
      }

      // try pathfinder plugin
      try {
        const pf = require('mineflayer-pathfinder');
        bot.loadPlugin(pf.pathfinder);
        Movements = pf.Movements; goals = pf.goals; hasPathfinder = true;
        console.log('pathfinder loaded');
      } catch (e) { hasPathfinder = false; }

      // auto-register/login on messages
      bot.on('messagestr', (m) => {
        try { socket.emit('log', m); } catch(e) {}
        const lower = (m || '').toLowerCase();
        if (lower.includes('/register')) {
          try { bot.chat(`/register ${PASS} ${PASS}`); } catch(e) {}
        } else if (lower.includes('/login')) {
          try { bot.chat(`/login ${PASS}`); } catch(e) {}
        }
      });

      // chat forwarding and commands
      bot.on('chat', async (username, message) => {
        try { socket.emit('log', `[CHAT] ${username}: ${message}`); } catch(e) {}
        if (!TRUSTED_USERS.includes(username)) return;

        // commands (minimal set preserved) - delegate to a handler for readability
        await handleChatCommand(bot, socket, username, message);
      });

      bot.on('end', () => {
        console.log('Bot connection ended');
        try { if (telemetry) { clearInterval(telemetry); telemetry = null; } } catch(e) {}
        try { if (followInterval) { clearInterval(followInterval); followInterval = null; followTarget = null; } } catch(e) {}
        try { if (pvpInterval) { clearInterval(pvpInterval); pvpInterval = null; pvpTarget = null; } } catch(e) {}
        try { socket.emit('log', '❌ Satellite De-synced (end)'); } catch(e) {}
        bot = null;
      });

      bot.on('error', (err) => {
        console.error('Bot error:', err);
        try { socket.emit('log', `⚠ Bot Error: ${err && (err.message || err.code) || err}`); } catch(e) {}
      });

    } catch (err) {
      console.error('Failed to start bot:', err);
      try { socket.emit('log', `❌ connection failed: ${err && (err.message || err.code) || err}`); } catch(e) {}
      bot = null;
    }
  });

  socket.on('drop_grab_item', async () => {
    if (!bot?.registry) return socket.emit('log', '❌ REGISTRY NOT READY.');
    if (bot.game.gameMode !== 'creative') return socket.emit('log', '⚠ NOT IN CREATIVE.');
    try {
      const itemData = bot.registry.itemsByName[lastGrabItem.name];
      if (!itemData) return socket.emit('log', '❌ INVALID ITEM.');
      const Item = require('prismarine-item')(bot.version);
      const item = new Item(itemData.id, lastGrabItem.amount);

      // Set item in a hotbar slot (e.g., slot 36)
      if (bot.creative && bot.creative.setInventorySlot) {
        await bot.creative.setInventorySlot(36, item);
      } else {
        // fallback to direct packet if creative API isn't present
        const notch = Item.toNotch(item);
        try { bot._client.write('set_creative_slot', { slot: 36, item: notch }); } catch(e) {}
      }

      // Drop the item
      const inventoryItem = bot.inventory.findInventoryItem(itemData.id);
      if (inventoryItem) {
        try { await bot.tossStack(inventoryItem); } catch(e) { /* ignore */ }
        socket.emit('log', `✅ Dropped ${lastGrabItem.amount}x ${lastGrabItem.name}`);
      } else {
        socket.emit('log', '❌ Could not place item in inventory');
      }
    } catch (err) {
      socket.emit('log', `❌ Error dropping item: ${err && err.message || err}`);
    }
  });
  socket.on('recalibrate', () => { if (bot?.entity) { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 100); } });
  socket.on('msg', t => { if (bot) bot.chat(t); });
  socket.on('move', d => { if (bot?.entity) bot.setControlState(d.k, d.s); });
  socket.on('look', d => { if (bot?.entity) bot.look(d.yaw, d.pitch); });
  socket.on('leave', () => { try { if (bot) bot.quit(); } catch(e) {}; try { if (telemetry) clearInterval(telemetry); } catch(e) {}; try { if (followInterval) clearInterval(followInterval); } catch(e) {}; try { if (pvpInterval) clearInterval(pvpInterval); } catch(e) {}; bot = null; socket.emit('log', '❌ DISCONNECTED.'); });

  socket.on('disconnect', (reason) => {
    console.log('Client disconnected:', socket.id, reason);
    try { if (bot) bot.quit(); } catch(e) {}
    try { if (telemetry) clearInterval(telemetry); } catch(e) {}
    try { if (followInterval) clearInterval(followInterval); } catch(e) {}
    try { if (pvpInterval) clearInterval(pvpInterval); } catch(e) {}
    bot = null;
  });

});

server.listen(8080, '0.0.0.0', () => console.log('Station Online'));

// ---- command handler (extracted) ----
async function handleChatCommand(bot, socket, username, message) {
  if (!message) return;
  try {
    // Announcement toggle
    if (message.startsWith('!JmoAI run msgs')) {
      const parts = message.split(' ');
      const v = (parts[3] || '').toLowerCase();
      if (v === 'on') { announceCommands = true; bot.chat('⚡ announcements ON'); }
      else if (v === 'off') { announceCommands = false; bot.chat('⚡ announcements OFF'); }
      else bot.chat('⚠ msgs requires on/off');
      return;
    }

    if (message.startsWith('!JmoAI run ') || message.startsWith('!JmoAI execute ')) {
      const parts = message.split(' ');
      const cmd = parts[2]?.toLowerCase();
      if (!cmd) return;
      const isRun = message.startsWith('!JmoAI run');
      const sayStart = () => { if (announceCommands) bot.chat(isRun ? 'running..' : 'executing..'); };
      const sayEnd = (extra = '') => { if (announceCommands) bot.chat(`${isRun ? 'ran' : 'executed'}; ${cmd} successfully${extra}`); };

      // ---- GRAB ITEM ----
      if (cmd === 'grabitem') {
        const itemName = parts[3] || 'diamond_block';
        const amount = parseInt(parts[4]) || 64;
        lastGrabItem = { name: itemName, amount };
        if (bot.game.gameMode !== 'creative') return bot.chat('⚠ not in creative mode.');
        const itemData = bot.registry.itemsByName[itemName];
        if (!itemData) return bot.chat('⚠ invalid item.');
        sayStart();
        try {
          const Item = require('prismarine-item')(bot.version);
          const mcItem = new Item(itemData.id, amount);
          const notchItem = Item.toNotch(mcItem);
          bot._client.write('set_creative_slot', { slot: 36, item: notchItem });
          bot._client.write('window_click', { windowId: 0, slot: 36, mouseButton: 1, action: 999, mode: 4, item: notchItem });
          setTimeout(() => sayEnd(), 300);
        } catch (e) { bot.chat('⚠ grab failed'); }
        return;
      }

      // ---- MOVEMENT ----
      if (['forward','back','left','right'].includes(cmd)) {
        const dur = parseInt(parts[3]) || 1000;
        sayStart(); bot.setControlState(cmd, true);
        setTimeout(() => { bot.setControlState(cmd, false); sayEnd(); }, dur);
        return;
      }

      if (cmd === 'stop') { sayStart(); ['forward','back','left','right','jump','sneak','sprint'].forEach(k=>bot.setControlState(k,false)); sayEnd(', all movement stopped'); return; }
      if (cmd === 'jump') { sayStart(); bot.setControlState('jump', true); setTimeout(()=>{ bot.setControlState('jump', false); sayEnd(); }, 300); return; }
      if (cmd === 'look') { const yaw = parseFloat(parts[3]) * Math.PI/180; const pitch = parseFloat(parts[4]) * Math.PI/180; sayStart(); try{ bot.look(yaw,pitch); }catch(e){} sayEnd(); return; }
      if (cmd === 'say') { const text = parts.slice(3).join(' '); if (!text) return bot.chat('⚠ say requires a message'); sayStart(); bot.chat(text); sayEnd(); return; }
      if (cmd === 'getpos') { sayStart(); if (!bot.entity) return bot.chat('⚠ no entity data'); const p = bot.entity.position; bot.chat(`POS ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`); sayEnd(); return; }

      // ---- FOLLOW ----
      if (cmd === 'follow') {
        const target = parts[3]; if (!target) return bot.chat('⚠ follow requires a player name');
        if (hasPathfinder && bot.pathfinder) {
          try {
            const mcData = require('minecraft-data')(bot.version);
            const moves = new Movements(bot, mcData);
            bot.pathfinder.setMovements(moves);
            const GoalFollow = goals.GoalFollow;
            let player = bot.players[target] || Object.values(bot.players).find(p => p && p.username && p.username.toLowerCase()===target.toLowerCase());
            if (!player || !player.entity) return bot.chat(`⚠ target ${target} not found`);
            bot.pathfinder.setGoal(new GoalFollow(player.entity, 1), true);
            return bot.chat(`now following ${target}`);
          } catch(e) { /* fallback below */ }
        }
        // naive fallback
        let interval = setInterval(()=>{
          try{
            let player = bot.players[target] || Object.values(bot.players).find(p=>p && p.username && p.username.toLowerCase()===target.toLowerCase());
            if (!player || !player.entity) { clearInterval(interval); return bot.chat(`⚠ target ${target} not found`); }
            const targetPos = player.entity.position; const myPos = bot.entity && bot.entity.position; if (!myPos) return;
            const dx = targetPos.x-myPos.x, dz = targetPos.z-myPos.z; const d = Math.sqrt(dx*dx + dz*dz);
            try{ bot.lookAt(targetPos.offset(0,1.6,0)); } catch(e){}
            if (d>2.2) bot.setControlState('forward', true); else bot.setControlState('forward', false);
          }catch(e){}
        },600);
        return bot.chat(`started following ${target}`);
      }

      // ---- PVP ----
      if (cmd === 'pvp') {
        const target = parts[3]; if (!target) return bot.chat('⚠ pvp requires a player name');
        if (hasPathfinder && bot.pathfinder) {
          try {
            const mcData = require('minecraft-data')(bot.version);
            const moves = new Movements(bot, mcData);
            bot.pathfinder.setMovements(moves);
            bot.chat(`engaging ${target}`);
            const loop = setInterval(()=>{
              try {
                let player = bot.players[target] || Object.values(bot.players).find(p => p && p.username && p.username.toLowerCase()===target.toLowerCase());
                if (!player || !player.entity) { clearInterval(loop); bot.chat(`⚠ pvp target ${target} lost`); return; }
                bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), true);
                try {
                  if (bot.entity && player.entity) {
                    const dist = bot.entity.position.distanceTo(player.entity.position);
                    if (dist < 3.5) {
                      bot.attack(player.entity);
                    }
                  }
                } catch (e) {
                  clearInterval(loop);
                }
              } catch(e) { clearInterval(loop); }
            }, 500);
            return;
          } catch (e) {
            bot.chat('⚠ pvp initialization failed');
          }
        }
        return bot.chat('⚠ pathfinder/target error for pvp');
      }

      // ---- LOOKAT ----
      if (cmd === 'lookat') {
        const target = parts[3];
        if (!target) return bot.chat('⚠ lookat requires a player name');
        let player = bot.players[target] || Object.values(bot.players).find(p => p && p.username && p.username.toLowerCase() === target.toLowerCase());
        if (!player || !player.entity) return bot.chat(`⚠ target ${target} not found`);
        sayStart();
        try {
          bot.lookAt(player.entity.position.offset(0, 1.6, 0));
          sayEnd();
        } catch (e) { bot.chat('⚠ lookat failed'); }
        return;
      }

      // ---- PLACE (Creative Fallback) ----
      if (cmd === 'place') {
        sayStart();
        try {
          const referenceBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));
          if (referenceBlock) {
            await bot.placeBlock(referenceBlock, require('vec3')(0, 1, 0));
            sayEnd();
          }
        } catch (e) { bot.chat('⚠ place failed'); }
        return;
      }

      // Catch-all for unknown !JmoAI run commands
      if (announceCommands) bot.chat(`⚠ unknown command: ${cmd}`);

    } // End of !JmoAI run/execute check
  } catch (err) {
    console.error('Command Error:', err);
    try { socket.emit('log', `⚠ command error: ${err.message}`); } catch (e) {}
  }
} // End of handleChatCommand
