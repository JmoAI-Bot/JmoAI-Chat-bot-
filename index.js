const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let bot;
let aiEnabled = false;
let autoSprint = false;
let skinUrl = ""; 
const password = "generationedpassword";

io.on('connection', (socket) => {
    socket.on('startBot', (data) => {
        if (bot) bot.quit();
        skinUrl = data.skinUrl; // Received from frontend

        bot = mineflayer.createBot({ host: data.host, username: data.username, version: '1.8.8' });

        bot.on('spawn', () => {
            socket.emit('log', '✔ Bot Connected!');
            // Apply skin if a URL was provided
            if (skinUrl) {
                bot.chat(`/skin ${skinUrl}`);
                socket.emit('log', 'Applied custom skin via /skin command.');
            }
        });

        // Auto-Sprint Logic
        bot.on('move', () => {
            if (autoSprint && bot.controlState.forward) {
                bot.setControlState('sprint', true);
            }
        });

        bot.on('messagestr', (msg) => {
            socket.emit('log', `[CHAT] ${msg}`);
            if (msg.includes('/register')) bot.chat(`/register ${password} ${password}`);
            if (msg.includes('/login')) bot.chat(`/login ${password}`);
        });

        // Toggles
        socket.on('toggleSprint', (val) => { 
            autoSprint = val; 
            bot.setControlState('sprint', val);
        });
        
        socket.on('toggleCrouch', (val) => { 
            bot.setControlState('sneak', val); 
        });

        socket.on('control', (data) => { if (bot) bot.setControlState(data.key, data.state); });
        socket.on('disconnectBot', () => { if (bot) bot.quit(); });
    });
});

server.listen(8080, '0.0.0.0', () => console.log('Advanced Dashboard LIVE'));
