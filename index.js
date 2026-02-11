const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['polling'] }); // Bypass WebSocket blocks

app.use(express.static('public'));

let bot;
let viewerActive = false;

io.on('connection', (socket) => {
    socket.on('startBot', (data) => {
        if (bot) bot.quit();

        bot = mineflayer.createBot({
            host: data.host,
            username: data.username,
            version: '1.8.8',
            hideErrors: true
        });

        bot.on('spawn', () => {
            socket.emit('log', 'Link Secure.');
            if (!viewerActive) {
                try {
                    mineflayerViewer(bot, { port: 3001, firstPerson: true });
                    viewerActive = true;
                } catch(e) {}
            }
        });

        // Chat listener
        bot.on('messagestr', (m) => socket.emit('log', m));

        // Interaction socket listeners
        socket.on('sendChat', (t) => { if(bot) bot.chat(t); });
        socket.on('look', (d) => { if(bot?.entity) bot.look(d.yaw, d.pitch); });
        socket.on('control', (d) => { if(bot) bot.setControlState(d.key, d.state); });
        
        bot.on('error', (err) => console.log('Relay error:', err.code));
    });
});

server.listen(8080, '0.0.0.0', () => console.log('Station Active.'));
