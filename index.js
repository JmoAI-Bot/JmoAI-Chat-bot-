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
let lastGrabItem = { name: 'diamond_block', amount: 64 };
const TRUSTED_USERS = ['Jmofrfr', 'Jmo_fr', 'Jmo'];

io.on('connection', (socket) => {
    socket.on('start', (data) => {
        if (bot) bot.quit();

        bot = mineflayer.createBot({ 
            host: data.h, 
            username: data.u, 
            version: '1.8.8', 
            hideErrors: true 
        });

        const telemetry = setInterval(() => {
            if (bot?.entity) {
                socket.emit('telemetry', { 
                    x: Math.floor(bot.entity.position.x), 
                    y: Math.floor(bot.entity.position.y), 
                    z: Math.floor(bot.entity.position.z) 
                });
            }
        }, 500);

        bot.on('spawn', () => {
            socket.emit('log', '✔ Neural Link Established.');
            if (!vStarted) {
                try { 
                    mineflayerViewer(bot, { port: 3001, firstPerson: true }); 
                    vStarted = true; 
                } catch(e) {}
            }
        });

        // ---- JmoAI COMMAND SYSTEM ----
        bot.on('chat', (username, message) => {
            if (!TRUSTED_USERS.includes(username)) return;

            if (message.startsWith('!JmoAI run ') || message.startsWith('!JmoAI execute ')) {
                const parts = message.split(' ');
                const cmd = parts[2]?.toLowerCase();
                const isRun = message.startsWith('!JmoAI run');

                const sayStart = () => bot.chat(isRun ? 'running..' : 'executing..');
                const sayEnd = (extra = '') => {
                    bot.chat(`${isRun ? 'ran' : 'executed'}; ${cmd} successfully${extra}`);
                };

                if (!cmd) return;

                // ---- GRAB ITEM COMMAND ----
                if (cmd === 'grabitem') {
                    const itemName = parts[3] || 'diamond_block';
                    const amount = parseInt(parts[4]) || 64;

                    lastGrabItem = { name: itemName, amount: amount };

                    if (bot.game.gameMode !== 'creative') {
                        return bot.chat('⚠ not in creative mode.');
                    }

                    const itemData = bot.registry.itemsByName[itemName];
                    if (!itemData) return bot.chat('⚠ invalid item.');

                    sayStart();

                    const Item = require('prismarine-item')(bot.version);
                    const mcItem = new Item(itemData.id, amount);
                    const notchItem = Item.toNotch(mcItem);

                    bot._client.write('set_creative_slot', {
                        slot: 36,
                        item: notchItem
                    });

                    // automatically drop the item
                    bot._client.write('window_click', {
                        windowId: 0,
                        slot: 36,
                        mouseButton: 1,
                        action: 999,
                        mode: 4,
                        item: notchItem
                    });

                    setTimeout(() => {
                        sayEnd();
                    }, 300);

                    return;
                }

                // ---- BASIC MOVEMENT COMMANDS ----
                if (cmd === 'crouch') {
                    sayStart();
                    bot.setControlState('sneak', true);
                    setTimeout(() => {
                        bot.setControlState('sneak', false);
                        sayEnd();
                    }, 500);
                }

                if (cmd === 'togglecrouch') {
                    sayStart();
                    bot.setControlState('sneak', !bot.controlState.sneak);
                    setTimeout(() => {
                        sayEnd(`, now ${bot.controlState.sneak ? 'ON' : 'OFF'}`);
                    }, 200);
                }

                if (cmd === 'togglesprint') {
                    sayStart();
                    bot.setControlState('sprint', !bot.controlState.sprint);
                    setTimeout(() => {
                        sayEnd(`, now ${bot.controlState.sprint ? 'ON' : 'OFF'}`);
                    }, 200);
                }
            }
        });

        // ---- DROP/GRAB ITEM SOCKET ----
        socket.on('drop_grab_item', async () => {
            if (!bot?.registry) return socket.emit('log', '❌ REGISTRY NOT READY.');
            if (bot.game.gameMode !== 'creative') return socket.emit('log', '⚠ NOT IN CREATIVE.');

            try {
                const itemData = bot.registry.itemsByName[lastGrabItem.name];
                if (!itemData) return socket.emit('log', '❌ INVALID ITEM.');

                const Item = require('prismarine-item')(bot.version);
                const mcItem = new Item(itemData.id, lastGrabItem.amount);
                const notchItem = Item.toNotch(mcItem);

                bot._client.write('set_creative_slot', { slot: 36, item: notchItem });

                bot._client.write('window_click', {
                    windowId: 0,
                    slot: 36,
                    mouseButton: 1,
                    action: 999,
                    mode: 4,
                    item: notchItem
                });

                socket.emit('log', `⭐ DROPPED ${lastGrabItem.amount}x ${lastGrabItem.name}`);

            } catch (err) {
                socket.emit('log', '❌ ACTION FAILED.');
            }
        });

        // ---- BOT MISC EVENTS ----
        bot.on('messagestr', (m) => {
            socket.emit('log', m);
            if (m.toLowerCase().includes('/register')) bot.chat(`/register ${PASS} ${PASS}`);
            else if (m.toLowerCase().includes('/login')) bot.chat(`/login ${PASS}`);
        });

        bot.on('error', (err) => {
            console.log('Relay Error:', err.code);
            socket.emit('log', `⚠ Uplink Error: ${err.code}`);
        });

        bot.on('kicked', (reason) => {
            socket.emit('log', `❌ Satellite De-synced: ${reason}`);
        });

        // ---- SOCKET CONTROLS ----
        socket.on('recalibrate', () => { 
            if (bot?.entity) { 
                bot.setControlState('jump', true); 
                setTimeout(() => bot.setControlState('jump', false), 100); 
            }
        });
        socket.on('msg', t => { if(bot) bot.chat(t); });
        socket.on('move', d => { if(bot?.entity) bot.setControlState(d.k, d.s); });
        socket.on('look', d => { if(bot?.entity) bot.look(d.yaw, d.pitch); });
        socket.on('leave', () => { 
            if(bot) { 
                bot.quit(); 
                clearInterval(telemetry); 
                socket.emit('log', '❌ DISCONNECTED.'); 
            }
        });

        // ---- BOT MOUSE + CLICK ----
        socket.on('click', async (type) => {
            if (!bot?.entity) return;
            const b = bot.blockAtCursor(5);
            bot.swingArm();
            if (type === 'primary') {
                if (bot.targetEntity) bot.attack(bot.targetEntity);
                else if (b) {
                    socket.emit('log', `>> Punching: ${b.name}`);
                    await bot.lookAt(b.position.offset(0.5,0.5,0.5));
                    bot.dig(b).catch(() => {});
                }
            } else {
                if (b) bot.activateBlock(b).catch(() => {});
                else bot.activateItem();
            }
        });
    });
});

server.listen(8080, '0.0.0.0', () => console.log('Station Online'));
