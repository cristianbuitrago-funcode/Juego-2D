import { randomInt } from 'node:crypto';
import { ROOM_CODE_LENGTH } from '@shared/config/gameConfig';
import { Room } from './Room';

// Sin caracteres ambiguos (0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Registro de salas activas en memoria (una instancia de servidor). */
export class RoomManager {
  private rooms = new Map<string, Room>();

  create(): Room {
    let code: string;
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, (r) => this.rooms.delete(r.code));
    this.rooms.set(code, room);
    return room;
  }

  get(code: string | undefined): Room | undefined {
    return code ? this.rooms.get(code) : undefined;
  }

  get size() {
    return this.rooms.size;
  }
}
