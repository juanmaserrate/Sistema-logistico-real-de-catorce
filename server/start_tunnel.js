
const ngrok = require('@ngrok/ngrok');

const PORT = process.env.PORT || process.env.VITE_PORT || 5175;

(async function() {
  try {
    console.log(`\nConectando túnel al puerto ${PORT}...\n`);
    const listener = await ngrok.forward({ 
        addr: `127.0.0.1:${PORT}`, 
        authtoken: '3991YHdNB0w6j33mLd6rQ0257Bd_VBgpje6aP1bZ7Zz1Qfh6',
        domain: 'uropygial-conservational-joy.ngrok-free.dev'
    });
    
    console.log(`\n\n >>> TU APP ESTÁ ONLINE AQUÍ: ${listener.url()} <<<\n\n`);
    
    // Check for errors on the listener
    // listener.on('error', (err) => console.error("Listener Error:", err));
    
    process.on('uncaughtException', (err) => console.error("Uncaught Error:", err));
    
    // Keep alive with interval
    setInterval(() => {}, 1000 * 60 * 60);
} catch(e) {
    console.error("Ngrok Init Error:", e);
}
})();
