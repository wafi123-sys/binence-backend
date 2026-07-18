const WebSocket = require('ws'); 
const ws = new WebSocket('wss://fstream.binance.com/ws/btcusdt@forceOrder'); 
ws.on('open', () => console.log('Connected')); 
ws.on('message', m => console.log('Message:', m.toString())); 
ws.on('close', (c) => console.log('Closed', c)); 
setTimeout(() => { ws.close(); process.exit(); }, 30000);
