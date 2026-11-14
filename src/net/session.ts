import { Peer, type DataConnection } from 'peerjs';
import { CLASSES } from '../engine/classes';
import { isAction, isMember, MAX_PARTY, type Action, type Member } from '../engine/party';
import type { ClassId } from '../engine/types';

/**
 * Online co-op without a game server. Players connect straight to each other with WebRTC
 * (PeerJS; its free public broker is only used to find each other by room code).
 *
 * The host is the referee for ordering only: every action goes to the host, gets a sequence
 * number and is sent to everyone, and each machine applies the actions in that order to its own
 * copy of the game (see engine/party.ts). Machines also compare a fingerprint of their game
 * after every action, so a copy that has drifted is noticed straight away.
 */

const ID_PREFIX = 'dayzero-coop-';
/** No 0/O, 1/I/L: codes get read out loud. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
const CONNECT_TIMEOUT_MS = 20000;

export interface LobbyPlayer {
  name: string;
  classId: ClassId | null;
}

export interface StartInfo {
  seed: number;
  members: Member[];
  me: number;
  threat: number;
}

export interface SessionHandlers {
  /** The lobby changed (someone joined, left or picked a class). */
  onLobby(): void;
  onStart(info: StartInfo): void;
  /** An action to apply, in order. `seq` counts up from 1. */
  onAction(seq: number, player: number, action: Action): void;
  /** Two machines disagree about the state of the game. */
  onDesync(): void;
  /** The session is over. `reason` is shown to the player. */
  onClosed(reason: string): void;
}

type Msg =
  | { t: 'hello'; name: string }
  | { t: 'pick'; classId: ClassId }
  | { t: 'lobby'; players: LobbyPlayer[]; you: number }
  | { t: 'refuse'; why: string }
  | { t: 'start'; seed: number; members: Member[]; you: number; threat: number }
  | { t: 'act'; seq?: number; player?: number; a: Action }
  | { t: 'hash'; seq: number; h: number }
  | { t: 'desync' };

export function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .slice(0, 14);
  return name || 'Soldier';
}

export function cleanCode(raw: unknown): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const isClass = (v: unknown): v is ClassId => typeof v === 'string' && Object.hasOwn(CLASSES, v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export class Session {
  code = '';
  players: LobbyPlayer[] = [];
  /** This player's index in `players`. */
  me = 0;
  state: 'connecting' | 'lobby' | 'playing' | 'closed' = 'connecting';

  private peer: Peer;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Host: connection of each player, by index. The host's own slot is null. */
  private conns: (DataConnection | null)[] = [null];
  /** Client: the connection to the host. */
  private hostConn: DataConnection | null = null;
  private seq = 0;
  /** Host: fingerprints by sequence number, its own and the first one received from a client. */
  private hashes = new Map<number, number>();

  private constructor(
    readonly isHost: boolean,
    private handlers: SessionHandlers,
    name: string,
    code: string,
  ) {
    this.code = code;
    this.peer = isHost ? new Peer(ID_PREFIX + code) : new Peer();
    this.timer = setTimeout(() => this.close('Could not connect. Check your connection and try again.'), CONNECT_TIMEOUT_MS);

    this.peer.on('error', (err) => {
      const type = (err as { type?: string }).type;
      if (type === 'peer-unavailable') return this.close(`No game found with the code ${this.code}.`);
      if (type === 'unavailable-id') return this.close('That room code is taken. Try hosting again.');
      // Losing the broker after everyone is connected does not matter: players talk directly.
      if (this.state === 'playing') return;
      if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
        return this.close('Could not reach the matchmaking service. Try again in a moment.');
      }
      if (type === 'browser-incompatible') return this.close('This browser cannot do peer-to-peer connections.');
    });
    this.peer.on('disconnected', () => {
      // The host must stay reachable while the lobby is open.
      if (this.isHost && this.state === 'lobby' && !this.peer.destroyed) this.peer.reconnect();
    });

    if (isHost) {
      this.players = [{ name, classId: null }];
      this.peer.on('open', () => {
        clearTimeout(this.timer);
        this.state = 'lobby';
        this.handlers.onLobby();
      });
      this.peer.on('connection', (conn) => this.accept(conn));
    } else {
      this.peer.on('open', () => {
        const conn = this.peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
        this.hostConn = conn;
        conn.on('open', () => conn.send({ t: 'hello', name } satisfies Msg));
        conn.on('data', (data) => this.fromHost(data));
        conn.on('close', () => this.close('The host left the game.'));
      });
    }
  }

  static host(name: string, handlers: SessionHandlers): Session {
    return new Session(true, handlers, cleanName(name), randomCode());
  }

  static join(code: string, name: string, handlers: SessionHandlers): Session {
    return new Session(false, handlers, cleanName(name), cleanCode(code));
  }

  // ---------- what the game calls ----------

  /** Choose a class in the lobby. */
  pick(classId: ClassId): void {
    if (this.state !== 'lobby') return;
    if (this.isHost) {
      this.players[0].classId = classId;
      this.shareLobby();
    } else {
      this.hostConn?.send({ t: 'pick', classId } satisfies Msg);
    }
  }

  get canStart(): boolean {
    return this.isHost && this.state === 'lobby' && this.players.length >= 2 && this.players.every((p) => p.classId);
  }

  /** Host only: begin the run. */
  start(threat: number): void {
    if (!this.canStart) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const members: Member[] = this.players.map((p) => ({ name: p.name, classId: p.classId! }));
    this.state = 'playing';
    this.conns.forEach((conn, you) => conn?.send({ t: 'start', seed, members, you, threat } satisfies Msg));
    this.handlers.onStart({ seed, members, me: 0, threat });
  }

  /** Ask for an action to be played. It happens when it comes back through onAction. */
  send(action: Action): void {
    if (this.state !== 'playing') return;
    if (this.isHost) this.dispatch(0, action);
    else this.hostConn?.send({ t: 'act', a: action } satisfies Msg);
  }

  /** Report this machine's fingerprint of the game after applying action `seq`. */
  reportHash(seq: number, h: number): void {
    if (this.state !== 'playing') return;
    if (this.isHost) this.compareHash(seq, h);
    else this.hostConn?.send({ t: 'hash', seq, h } satisfies Msg);
  }

  /** Leave quietly (no onClosed). */
  leave(): void {
    this.state = 'closed';
    clearTimeout(this.timer);
    this.peer.destroy();
  }

  // ---------- host ----------

  private accept(conn: DataConnection): void {
    let index = -1;
    const refuse = (why: string): void => {
      conn.send({ t: 'refuse', why } satisfies Msg);
      setTimeout(() => conn.close(), 500);
    };
    conn.on('data', (data) => {
      const msg = data as Partial<Msg> | null;
      if (!msg || typeof msg !== 'object') return;
      index = this.conns.indexOf(conn);
      if (msg.t === 'hello') {
        if (index >= 0) return;
        if (this.state !== 'lobby') return refuse('That game has already started.');
        if (this.players.length >= MAX_PARTY) return refuse('That squad is full.');
        this.conns.push(conn);
        this.players.push({ name: cleanName((msg as { name?: unknown }).name), classId: null });
        return this.shareLobby();
      }
      if (index < 0) return;
      if (msg.t === 'pick' && this.state === 'lobby' && isClass(msg.classId)) {
        this.players[index].classId = msg.classId;
        this.shareLobby();
      } else if (msg.t === 'act' && this.state === 'playing' && isAction(msg.a) && msg.a.k !== 'drop') {
        this.dispatch(index, msg.a);
      } else if (msg.t === 'hash' && isCount(msg.seq) && isCount(msg.h)) {
        this.compareHash(msg.seq, msg.h);
      }
    });
    conn.on('close', () => {
      index = this.conns.indexOf(conn);
      if (index < 0) return;
      if (this.state === 'lobby') {
        this.conns.splice(index, 1);
        this.players.splice(index, 1);
        this.shareLobby();
      } else if (this.state === 'playing') {
        this.conns[index] = null;
        this.dispatch(index, { k: 'drop' });
      }
    });
  }

  private shareLobby(): void {
    this.conns.forEach((conn, you) => conn?.send({ t: 'lobby', players: this.players, you } satisfies Msg));
    this.handlers.onLobby();
  }

  private dispatch(player: number, a: Action): void {
    const seq = ++this.seq;
    for (const conn of this.conns) conn?.send({ t: 'act', seq, player, a } satisfies Msg);
    this.handlers.onAction(seq, player, a);
  }

  private compareHash(seq: number, h: number): void {
    const known = this.hashes.get(seq);
    if (known === undefined) {
      this.hashes.set(seq, h);
      if (this.hashes.size > 400) this.hashes.delete(this.hashes.keys().next().value!);
    } else if (known !== h) {
      for (const conn of this.conns) conn?.send({ t: 'desync' } satisfies Msg);
      this.handlers.onDesync();
    }
  }

  // ---------- client ----------

  private fromHost(data: unknown): void {
    const msg = data as Partial<Msg> | null;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'lobby': {
        if (!Array.isArray(msg.players) || !isCount(msg.you)) return;
        clearTimeout(this.timer);
        this.players = msg.players.slice(0, MAX_PARTY).map((p) => ({
          name: cleanName(p?.name),
          classId: isClass(p?.classId) ? p.classId : null,
        }));
        this.me = Math.min(msg.you, this.players.length - 1);
        if (this.state === 'connecting') this.state = 'lobby';
        return this.handlers.onLobby();
      }
      case 'refuse':
        return this.close(typeof msg.why === 'string' ? msg.why.slice(0, 80) : 'Could not join.');
      case 'start': {
        const { seed, members, you, threat } = msg;
        if (!isCount(seed) || !isCount(you) || !isCount(threat) || !Array.isArray(members)) return;
        if (!members.length || members.length > MAX_PARTY || !members.every(isMember) || you >= members.length) return;
        this.state = 'playing';
        return this.handlers.onStart({
          seed,
          members: members.map((m) => ({ name: cleanName(m.name), classId: m.classId })),
          me: you,
          threat: Math.min(threat, 8),
        });
      }
      case 'act':
        if (this.state === 'playing' && isCount(msg.seq) && isCount(msg.player) && isAction(msg.a)) {
          this.handlers.onAction(msg.seq, msg.player, msg.a);
        }
        return;
      case 'desync':
        return this.handlers.onDesync();
    }
  }

  private close(reason: string): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearTimeout(this.timer);
    this.peer.destroy();
    this.handlers.onClosed(reason);
  }
}
