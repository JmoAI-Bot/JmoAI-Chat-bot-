const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    transports: ['polling'],
    cors: { origin: "*" }
});

app.use(express.static('public'));

let bot;
let vStarted = false;
const PASS = "testificate";

io.on('connection', (socket) => {
    socket.on('start', (data) => {
        // Cleanup old instance before starting new one
        if (bot) {
            bot.quit();
            socket.emit('log', '🔄 System rebooting...');
        }

        bot = mineflayer.createBot({ 
            host: data.h, 
            username: data.u, 
            version: '1.8.8', 
            hideErrors: true 
        });

        bot.on('spawn', () => {
            socket.emit('log', '✔ SATELLITE LINK ESTABLISHED');
            
            // Fix "Under Map" glitch by forcing a position sync
            setTimeout(() => {
                if (bot && bot.entity) {
                    bot.look(0, 0);
                    bot.setControlState('jump', true);
                    setTimeout(() => { if(bot) bot.setControlState('jump', false) }, 150);
                }
            }, 2500);

            if (!vStarted) {
                try { 
                    mineflayerViewer(bot, { port: 3001, firstPerson: true }); 
                    vStarted = true; 
                    console.log('Satellite systems online on 3001.');
                } catch(e) {
                    console.log("Viewer already running.");
                }
            }
        });

        // Auto-Auth Logic
        bot.on('messagestr', (m) => {
            socket.emit('log', m);
            const low = m.toLowerCase();
            if (low.includes('/register')) {
                bot.chat(`/register ${PASS} ${PASS}`);
            } else if (low.includes('/login')) {
                bot.chat(`/login ${PASS}`);
            }
        });

        // --- Socket Listeners with Safety Checks ---

        socket.on('recalibrate', () => {
            if (bot && bot.entity) {
                bot.setControlState('jump', true);
                setTimeout(() => { if(bot) bot.setControlState('jump', false) }, 100);
            }
        });

        socket.on('msg', t => { 
            if(bot) bot.chat(t); 
        });

        socket.on('move', d => { 
            if(bot && bot.entity) {
                try { bot.setControlState(d.k, d.s); } catch(e) {}
            }
        });

        socket.on('look', d => { 
            if(bot && bot.entity) {
                bot.look(d.yaw, d.pitch); 
            }
        });

        socket.on('leave', () => { 
            if(bot) {
                bot.quit();
                socket.emit('log', '❌ Link Terminated by Operator.');
            }
        });
        
        socket.on('click', (type) => {
            if (!bot || !bot.entity) return;
            const b = bot.blockAtCursor(5);
            if (type === 'primary') {
                if (bot.targetEntity) bot.attack(bot.targetEntity);
                else if (b) bot.dig(b).catch(() => {});
            } else {
                if (b) bot.activateBlock(b).catch(() => {});
                else bot.activateItem();
            }
        });

        bot.on('error', (err) => {
            console.log('Relay Error:', err.code);
            socket.emit('log', `⚠ Uplink Error: ${err.code}`);
        });

        bot.on('kicked', (reason) => {
            socket.emit('log', `❌ Satellite De-synced: ${reason}`);
        });
    });
});

server.listen(8080, '0.0.0.0', () => {
    console.log('RESEARCH STATION READY: PORT 8080');
});
