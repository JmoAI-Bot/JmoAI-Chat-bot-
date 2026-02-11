const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ['polling'] });

app.use(express.static('public'));

let bot;
let vStarted = false;
const PASS = "testificate";

io.on('connection', (socket) => {
    socket.on('start', (data) => {
        if (bot) bot.quit();
        bot = mineflayer.createBot({ host: data.h, username: data.u, version: '1.8.8', hideErrors: true });

        bot.on('spawn', () => {
            socket.emit('log', 'Link: Established.');
            if (!vStarted) {
                try { mineflayerViewer(bot, { port: 3001, firstPerson: true }); vStarted = true; } catch(e) {}
            }
        });

        bot.on('messagestr', (m) => {
            socket.emit('log', m);
            const low = m.toLowerCase();
            if (low.includes('/register')) bot.chat(`/register ${PASS} ${PASS}`);
            else if (low.includes('/login')) bot.chat(`/login ${PASS}`);
        });

        socket.on('msg', t => { if(bot) bot.chat(t); });
        socket.on('move', d => { if(bot) bot.setControlState(d.k, d.s); });
        socket.on('leave', () => { if(bot) bot.quit(); socket.emit('log', 'Link Terminated.'); });
        
        socket.on('click', (type) => {
            if (!bot) return;
            const b = bot.blockAtCursor(5);
            if (type === 'primary') {
                if (bot.targetEntity) bot.attack(bot.targetEntity);
                else if (b) bot.dig(b).catch(() => {});
            } else {
                if (b) bot.activateBlock(b).catch(() => {});
                else bot.activateItem();
            }
        });
    });
});

server.listen(8080, '0.0.0.0', () => console.log('Station Online'));
