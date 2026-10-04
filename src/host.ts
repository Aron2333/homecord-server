import { startTunnel } from 'untun';
import { CONFIG } from './config/index.js';
import './index.js'; // Starts Express + Socket.IO server

async function setupHostTunnel() {
  const port = Number(CONFIG.PORT) || 4000;
  console.log('\n[Tunnel] Publikus Cloudflare alagút indítása...');

  try {
    const cfTunnel = await startTunnel({
      url: `http://127.0.0.1:${port}`,
      port: port,
      hostname: '127.0.0.1'
    });

    if (cfTunnel) {
      const publicUrl = await cfTunnel.getURL();
      console.log('\n' + '='.repeat(70));
      console.log('🚀  OTPCORD SZERVER + NYILVÁNOS ALAGÚT SIKERESEN ELINDULT!');
      console.log('='.repeat(70));
      console.log(`🏠 Lokális cím (a saját gépeden):   http://localhost:${port}`);
      console.log(`🌐 NYILVÁNOS CSATLAKOZÁSI CÍM:      ${publicUrl}`);
      console.log('='.repeat(70));
      console.log('👉 Másold ki ezt a NYILVÁNOS linket és küldd el a barátaidnak!');
      console.log('👉 A kliensben a "Szerver kapcsolat" ablakba illesszék be.');
      console.log('='.repeat(70) + '\n');
    }
  } catch (cfErr: any) {
    console.error('[Tunnel Hiba]:', cfErr?.message || cfErr);
    console.log(`A szerver helyileg fut a http://localhost:${port} címen.`);
  }
}

// Small delay to let Express and MySQL connect first
setTimeout(setupHostTunnel, 1500);
