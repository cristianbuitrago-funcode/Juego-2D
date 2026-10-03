import './ui/styles.css';
import { audio } from './assets/AudioManager';
import { GameSession } from './GameSession';
import { NetworkClient } from './network/NetworkClient';
import { settings } from './systems/Settings';
import { toast } from './ui/dom';
import { LobbyScreen } from './ui/LobbyScreen';

// Punto de entrada del cliente: conecta la red con el lobby y las partidas.
const net = new NetworkClient();
const lobby = new LobbyScreen(net);
let session: GameSession | null = null;
let wasConnected = false;

audio.setVolumes(settings.sfxVolume, settings.musicVolume);
lobby.show();

const backToLobby = () => {
  session = null;
  lobby.show();
};

net.socket.on('connect', async () => {
  if (wasConnected) toast('Conexión restablecida.');
  wasConnected = true;
  // Reconexión automática a la misma plaza (p. ej. tras un corte o al recargar la página).
  const saved = net.savedSession();
  if (saved) {
    try {
      const res = await net.rejoin(saved.code, saved.token);
      lobby.setRoom(res.room, res.slot);
    } catch {
      net.forgetSession();
      lobby.setRoom(null);
    }
  }
  if (!session) lobby.show();
});

net.socket.on('disconnect', () => {
  toast('Conexión perdida con el servidor. Reintentando…', 'error', 5000);
  if (!session) lobby.show();
});

net.socket.on('lobby:state', (room) => {
  lobby.setRoom(room);
});

net.socket.on('game:init', (init) => {
  session?.dispose();
  lobby.hide();
  session = new GameSession(init, net, (reason) => {
    if (reason === 'left') lobby.setRoom(null);
    backToLobby();
  });
});

net.socket.on('game:snapshot', (snap) => session?.onSnapshot(snap));
net.socket.on('game:over', (info) => session?.gameOver(info));
net.socket.on('game:rejected', (reason) => {
  if (session) session.rejected(reason);
  else toast(reason, 'warn');
});

// Desbloquear audio con el primer gesto del usuario.
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
