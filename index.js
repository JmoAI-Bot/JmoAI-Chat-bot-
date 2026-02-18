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
        // Version 1.8.8 is set here to match your requirement
        bot = mineflayer.createBot({ host: data.h, username: data.u, version: '1.8.8', hideErrors: true });

        const telemetry = setInterval(() => {
            if (bot?.entity) {
                socket.emit('telemetry', { x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y), z: Math.floor(bot.entity.position.z) });
            }
        }, 500);

        bot.on('spawn', () => {
            socket.emit('log', '✔ Neural Link Established.');
            if (!vStarted) {
                try { mineflayerViewer(bot, { port: 3001, firstPerson: true }); vStarted = true; } catch(e) {}
            }
        });

        // --- ULTIMA PROTOCOL-X (SAFE & AGGRESSIVE) ---
               socket.on('protocol_x', async () => {
            if (!bot?.registry) return socket.emit('log', '❌ REGISTRY NOT READY.');
            socket.emit('log', '☣ INJECTING GHOST PAYLOAD (STRICT SILENCE)...');
            
            try {
                const itemData = bot.registry.itemsByName['diamond_block'];
                const Item = require('prismarine-item')(bot.version);
                const mcItem = new Item(itemData.id, 64);
                const notchItem = Item.toNotch(mcItem);

                // --- THE SILENT EXPLOIT ---
                // We DON'T chat /gamemode. We just tell the server we ARE in creative.
                bot.game.gameMode = 'creative';

                for (let i = 0; i < 20; i++) {
                    // 1. Force the server to think slot 36 (hotbar) has diamonds
                    bot._client.write('set_creative_slot', { slot: 36, item: notchItem });

                    // 2. IMMEDIATELY tell the server we are dropping the item from that slot
                    // Mode 4 = Drop, Button 1 = Control+Drop (Full Stack)
                    bot._client.write('window_click', {
                        windowId: 0,
                        slot: 36,
                        mouseButton: 1, 
                        action: i + 500,
                        mode: 4,
                        item: notchItem
                    });

                    // 3. Send a 'Held Item Change' packet to force a sync
                    bot._client.write('held_item_slot', { slotId: 0 });
                }

                // 4. THE FINISHER: Try a "Physical" toss as a fallback
                setTimeout(async () => {
                    const stack = bot.inventory.slots[36];
                    if (stack) {
                        await bot.tossStack(stack).catch(() => {});
                        socket.emit('log', '⭐ GHOST SYNC SUCCESS.');
                    } else {
                        socket.emit('log', '>> PACKET BURST COMPLETE.');
                    }
                    bot.game.gameMode = 'survival';
                }, 50);

            } catch (err) {
                bot.game.gameMode = 'survival';
                socket.emit('log', '❌ PACKET COLLISION.');
            }
        });


        bot.on('messagestr', (m) => {
            socket.emit('log', m);
            if (m.toLowerCase().includes('/register')) bot.chat(`/register ${PASS} ${PASS}`);
            else if (m.toLowerCase().includes('/login')) bot.chat(`/login ${PASS}`);
        });

        socket.on('recalibrate', () => { if (bot?.entity) { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 100); }});
        socket.on('msg', t => { if(bot) bot.chat(t); });
        socket.on('move', d => { if(bot?.entity) bot.setControlState(d.k, d.s); });
        socket.on('look', d => { if(bot?.entity) bot.look(d.yaw, d.pitch); });
        socket.on('leave', () => { if(bot) { bot.quit(); clearInterval(telemetry); socket.emit('log', '❌ DISCONNECTED.'); }});
        
        socket.on('click', async (type) => {
            if (!bot?.entity) return;
            const b = bot.blockAtCursor(5);
            bot.swingArm();
            if (type === 'primary') {
                if (bot.targetEntity) bot.attack(bot.targetEntity);
                else if (b) {
                    socket.emit('log', `>> Punching: ${b.name}`);
                    await bot.lookAt(b.position.offset(0.5, 0.5, 0.5));
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
