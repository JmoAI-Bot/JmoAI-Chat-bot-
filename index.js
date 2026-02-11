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
    socket.setMaxListeners(0); // Kill the "Memory Leak" warning for good

    socket.on('startBot', (data) => {
        if (bot) {
            bot.quit();
            socket.emit('log', '🔄 Rebooting system...');
        }

        bot = mineflayer.createBot({
            host: data.host || 'mc.sealcentral.co',
            username: data.username || 'JmoAI',
            version: '1.8.8',
            hideErrors: true // Stop the console from screaming if connection drops
        });

        bot.on('spawn', () => {
            socket.emit('log', '✔ NEURAL LINK ESTABLISHED');
            try {
                mineflayerViewer(bot, { port: 3001, firstPerson: true });
                inventoryViewer(bot, { port: 3002 });
            } catch(e) { /* Ignore if ports are busy */ }
        });

        bot.on('messagestr', (msg) => {
            socket.emit('log', `[MSG] ${msg}`);
            if (msg.includes('/register')) bot.chat(`/register ${password} ${password}`);
            if (msg.includes('/login')) bot.chat(`/login ${password}`);
        });

        // --- Interaction Logic ---
        socket.on('interact', (type) => {
            if(!bot) return;
            const block = bot.blockAtCursor(5);
            if (!block) return socket.emit('log', '⚠ Target out of range');
            
            if (type === 'break') {
                bot.dig(block).catch(e => socket.emit('log', 'Mining failed.'));
            } else {
                bot.activateBlock(block).catch(e => socket.emit('log', 'Interaction failed.'));
            }
        });

        socket.on('look', (d) => { if(bot && bot.entity) bot.look(d.yaw, d.pitch); });
        socket.on('control', (d) => { if(bot) bot.setControlState(d.key, d.state); });
        socket.on('sendChat', (t) => { if(bot) bot.chat(t); });
        socket.on('disconnectBot', () => { if(bot) bot.quit(); });
        
        bot.on('error', (err) => socket.emit('log', `⚠ System Error: ${err.code}`));
        bot.on('kicked', (reason) => socket.emit('log', `❌ Kicked: ${reason}`));
    });
});

// Port 8080 for the dashboard
server.listen(8080, '0.0.0.0', () => console.log('LINK READY: PORT 8080'));
