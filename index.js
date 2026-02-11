const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const inventoryViewer = require('mineflayer-web-inventory');
const v = require('vec3');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let bot;
const password = "generationedpassword";

io.on('connection', (socket) => {
    // Fix for the "MaxListeners" warning
    socket.setMaxListeners(100);

    socket.on('startBot', (data) => {
        if (bot) { bot.quit(); socket.emit('log', 'Restarting...'); }

        bot = mineflayer.createBot({
            host: data.host || 'mc.sealcentral.co',
            username: data.username || 'JmoAI',
            version: '1.8.8'
        });

        bot.on('spawn', () => {
            socket.emit('log', '✔ SPAWNED: Camera on :3001, Inv on :3002');
            try {
                mineflayerViewer(bot, { port: 3001, firstPerson: true });
                inventoryViewer(bot, { port: 3002 });
            } catch(e) { console.log("Viewers already running or port busy"); }
        });

        bot.on('messagestr', (msg) => {
            socket.emit('log', `[CHAT] ${msg}`);
            if (msg.includes('/register')) bot.chat(`/register ${password} ${password}`);
            if (msg.includes('/login')) bot.chat(`/login ${password}`);
        });

        // --- Controls ---
        socket.on('control', (d) => { if(bot) bot.setControlState(d.key, d.state); });
        
        socket.on('look', (d) => { if(bot) bot.look(d.yaw, d.pitch); });

        socket.on('interact', (type) => {
            if(!bot) return;
            const block = bot.blockAtCursor(5);
            if (!block) return socket.emit('log', 'No block in range');
            
            if (type === 'break') {
                bot.dig(block, (err) => { if(err) socket.emit('log', 'Dig error: ' + err); });
            } else if (type === 'place') {
                const item = bot.inventory.items()[0];
                if (item) bot.placeBlock(block, v(0, 1, 0)).catch(e => {});
            } else {
                bot.activateBlock(block); // For Crafting Tables/Chests
            }
        });

        socket.on('lookNearest', () => {
            const p = bot.nearestEntity(e => e.type === 'player');
            if (p) bot.lookAt(p.position.offset(0, 1.6, 0));
        });

        socket.on('sendChat', (t) => { if(bot) bot.chat(t); });
        socket.on('disconnectBot', () => { if(bot) bot.quit(); });
    });
});

server.listen(8080, '0.0.0.0', () => console.log('MASTER TERMINAL LIVE ON 8080'));
