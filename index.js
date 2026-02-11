const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let bot;
const password = "generationedpassword";

io.on('connection', (socket) => {
    socket.emit('log', 'Connected to Panel');

    socket.on('startBot', (data) => {
        if (bot) bot.quit();
        socket.emit('log', `Joining ${data.host} as ${data.username}...`);

        bot = mineflayer.createBot({
            host: data.host,
            username: data.username,
            version: '1.8.8'
        });

        bot.on('spawn', () => socket.emit('log', '✔ Bot is in the server!'));

        bot.on('messagestr', (msg) => {
            socket.emit('log', `[CHAT] ${msg}`);
            // Auth Logic
            if (msg.includes('/register')) bot.chat(`/register ${password} ${password}`);
            if (msg.includes('/login')) bot.chat(`/login ${password}`);
        });

        bot.on('error', (err) => socket.emit('log', `⚠ Error: ${err.message}`));
        bot.on('kicked', (reason) => socket.emit('log', `❌ Kicked: ${reason}`));
    });

    socket.on('sendChat', (text) => { if (bot) bot.chat(text); });

    socket.on('move', (dir) => {
        if (!bot) return;
        bot.setControlState(dir, true);
        setTimeout(() => bot.setControlState(dir, false), 500);
        socket.emit('log', `Moving ${dir}`);
    });
});

server.listen(3000, '0.0.0.0', () => {
    console.log('Bot Dashboard is LIVE on port 3000');
});
