import './ui/style.css';
import { botAction, botStep } from './engine/bot';
import { CARDS } from './engine/cards';
import { CLASS_LIST, LOCKED_CLASSES } from './engine/classes';
import { ALL_ENEMIES } from './engine/enemies';
import { GEAR, STIMS } from './engine/items';
import type { NodeType } from './engine/map';
import { MAX_THREAT } from './engine/modifiers';
import { Party, type Action } from './engine/party';
import { Rng } from './engine/rng';
import { Run } from './engine/run';
import type { ClassId } from './engine/types';
import { cleanCode, cleanName, CODE_LENGTH, Session, type SessionHandlers, type StartInfo } from './net/session';
import { assetUrl } from './ui/assets';
import { flyCard, playCharAnim, playFx, rewindFx, sleep, spawnEffect } from './ui/fx';
import { musicFor, sceneFor, setScene } from './ui/scene';
import { music, sfx, unlockAudio } from './ui/sound';
import { dailySetup, S, saveMeta, todayString } from './ui/state';
import { inviteLink, NODE_INFO, renderApp } from './ui/views';

const app = document.querySelector<HTMLDivElement>('#app')!;

// ---------- rendering ----------

function render(): void {
  const run = S.run;
  if (S.combatRef !== (run?.combat ?? null)) {
    // New fight: forget which cards and corpses have already animated.
    S.combatRef = run?.combat ?? null;
    S.seenCards.clear();
    S.deadShown.clear();
    S.prevHp.clear();
  }
  setScene(sceneFor(run));
  music.set(musicFor(run));
  app.innerHTML = renderApp();

  const entries = app.querySelector('.log-entries');
  if (entries) entries.scrollTop = entries.scrollHeight;
  for (const dying of app.querySelectorAll('.enemy.dying')) {
    sfx.die();
    spawnEffect('explosion', dying.querySelector('.sprite.char') ?? dying);
  }

  // HP bars render at their old width, then slide to the new one.
  requestAnimationFrame(() => {
    for (const bar of app.querySelectorAll<HTMLElement>('.hpbar-fill[data-w]')) {
      bar.style.width = bar.dataset.w!;
    }
  });
}

/** Plays the floating numbers for whatever the engine did since the last call. */
function flushFx(): Promise<void> {
  const combat = S.run?.combat;
  return combat ? playFx(combat.fx.splice(0)) : Promise.resolve();
}

/** Records the result of a finished (or abandoned) run in Meta, once. */
function closeRun(run: Run): void {
  if (S.runClosed) return;
  S.runClosed = true;
  const m = S.meta;
  if (run.phase === 'victory') {
    m.wins++;
    if (run.threat === m.maxThreat && m.maxThreat < MAX_THREAT) m.maxThreat++;
  }
  if (run.daily) {
    const same = m.daily?.date === run.daily ? m.daily : null;
    m.daily = {
      date: run.daily,
      best: Math.max(same?.best ?? 0, run.score),
      attempts: (same?.attempts ?? 0) + 1,
    };
  }
  saveMeta();
}

/** Unlocks and memory that carry over between loops. */
function trackMeta(run: Run): void {
  const m = S.meta;
  let changed = false;
  if (run.act >= 1 && !m.hybridUnlocked) {
    m.hybridUnlocked = true;
    changed = true;
  }
  if (run.combat && run.phase !== 'combat') {
    // Once a fight ends, win or lose, you remember what those enemies do.
    for (const enemy of run.combat.enemies) {
      if (!m.known.includes(enemy.def.id)) {
        m.known.push(enemy.def.id);
        changed = true;
      }
    }
  }
  if (changed) saveMeta();
  if (run.phase === 'victory' || run.phase === 'gameover') closeRun(run);
}

/** Bookkeeping after anything that may have ended a fight. */
function afterAction(phaseBefore?: string): void {
  const run = S.run;
  const before = S.runClosed;
  if (run) trackMeta(run);
  if (run && !before && S.runClosed) (run.phase === 'victory' ? sfx.win : sfx.lose)();
  else if (run?.phase === 'dead' && !S.busy && phaseBefore !== 'dead') sfx.lose();
  render();
  void flushFx();
}

// ---------- actions ----------

// ---------- co-op ----------

/** Actions arrive from the network in order and are applied one at a time, animations included. */
let chain: Promise<void> = Promise.resolve();

function send(action: Action): void {
  S.session?.send(action);
}

/** Back to the title screen, optionally with a message. */
function leaveCoop(notice = ''): void {
  if (S.run && S.party) closeRun(S.run);
  S.session?.leave();
  S.session = null;
  S.party = null;
  S.run = null;
  S.modal = null;
  S.selected = null;
  S.busy = false;
  S.desync = false;
  S.copied = false;
  S.notice = notice;
  chain = Promise.resolve();
  render();
}

function openSession(host: boolean): void {
  const name = cleanName(document.querySelector<HTMLInputElement>('#coop-name')?.value);
  const code = cleanCode(document.querySelector<HTMLInputElement>('#coop-code')?.value);
  S.meta.name = name;
  S.joinCode = code;
  saveMeta();
  if (!host && code.length !== CODE_LENGTH) {
    S.notice = `Type the ${CODE_LENGTH}-character room code your host gave you.`;
    sfx.deny();
    return render();
  }
  S.notice = '';
  const handlers: SessionHandlers = {
    onLobby: () => {
      if (S.session === session && !S.party) render();
    },
    onStart: (info) => {
      if (S.session === session) startCoop(info);
    },
    onAction: (seq, player, action) => {
      const party = S.party;
      if (S.session !== session || !party) return;
      chain = chain.then(() => applyCoop(party, seq, player, action)).catch((err) => console.error(err));
    },
    onDesync: () => {
      if (S.session !== session) return;
      S.desync = true;
      render();
    },
    onClosed: (reason) => {
      if (S.session === session) leaveCoop(reason);
    },
  };
  const session: Session = host ? Session.host(name, handlers) : Session.join(code, name, handlers);
  S.session = session;
  sfx.click();
  render();
}

function startCoop(info: StartInfo): void {
  const party = new Party(info.members, info.seed, { threat: info.threat });
  party.autoEnemies = false; // we animate the enemy phase ourselves
  S.party = party;
  S.me = info.me;
  S.run = party.runs[info.me];
  S.meta.loops++;
  saveMeta();
  S.selected = null;
  S.modal = null;
  S.runClosed = false;
  S.desync = false;
  chain = Promise.resolve();
  sfx.buy();
  render();
}

/** Applies one action from the network to our copy of the game and shows the result. */
async function applyCoop(party: Party, seq: number, player: number, action: Action): Promise<void> {
  if (S.party !== party) return;
  const run = S.run!;
  const mine = player === S.me;
  const before = run.phase;
  const actor = party.runs[player];
  const cardType =
    action.k === 'card' && actor?.phase === 'combat'
      ? actor.combat?.hand.find((c) => c.uid === action.uid)?.def.type
      : undefined;
  const cardEl = mine && action.k === 'card' ? app.querySelector<HTMLElement>(`.hand [data-id="${action.uid}"]`) : null;

  const ok = party.apply(player, action);

  if (ok && action.k === 'reset') {
    sfx.reset();
    S.busy = true;
    await rewindFx(() => {
      S.busy = false;
      if (S.party === party) render();
    });
  } else if (mine) {
    if (action.k === 'card') {
      if (ok) {
        sfx.card();
        if (cardEl) flyCard(cardEl);
      } else sfx.deny();
    } else if (['gear', 'stim', 'rewardCard', 'buy', 'remove', 'upgrade', 'event'].includes(action.k)) {
      (ok ? sfx.buy : sfx.deny)();
    } else if (action.k === 'rest' && ok) sfx.heal();
    else if (action.k === 'market' && ok) sfx.dice();
  }
  if (S.party !== party) return;
  afterAction(before);
  if (ok && cardType === 'attack') {
    sfx.shoot();
    if (mine) playCharAnim(app.querySelector('.player'), 'attack');
  }

  if (party.enemiesReady) await coopEnemyPhase(party, run);
  if (S.party === party) S.session?.reportHash(seq, party.hash());
}

/** Every standing player has ended their turn: play the enemies one at a time. */
async function coopEnemyPhase(party: Party, run: Run): Promise<void> {
  const before = run.phase;
  S.busy = true;
  S.selected = null;
  party.beginEnemies();
  render();
  await sleep(250);

  while (S.party === party) {
    const next = party.peekEnemy();
    if (!next) break;
    const el = app.querySelector(`.enemy[data-fx="${next.uid}"]`);
    el?.classList.add('lunge');
    (next.def.tier === 'boss' ? sfx.roar : sfx.enemy)();
    await sleep(Math.max(280, Math.min(700, playCharAnim(el, 'attack'))));
    if (S.party !== party) break;
    party.enemyStep();
    render();
    await flushFx();
    await sleep(320);
  }

  S.busy = false;
  if (S.party !== party) return;
  party.finishEnemies();
  if (run.phase === 'combat') sfx.draw();
  afterAction(before);
}

/** Turns a click into an Action for the squad. Returns false for clicks that are not game actions. */
function coopAct(action: string, n: number): boolean {
  let a: Action | null;
  switch (action) {
    case 'gear-pick':
      a = { k: 'gear', i: n };
      break;
    case 'node':
      a = { k: 'node', id: n };
      break;
    case 'stim':
      a = S.busy ? null : { k: 'stim', i: n };
      break;
    case 'reward-card':
      a = { k: 'rewardCard', i: n };
      break;
    case 'reward-continue':
      a = { k: 'rewardLeave' };
      break;
    case 'shop-card':
      a = { k: 'buy', what: 'card', i: n };
      break;
    case 'shop-gear':
      a = { k: 'buy', what: 'gear', i: n };
      break;
    case 'shop-stim':
      a = { k: 'buy', what: 'stim', i: n };
      break;
    case 'shop-reset':
      a = { k: 'buy', what: 'reset', i: 0 };
      break;
    case 'camp-rest':
      a = { k: 'rest' };
      break;
    case 'event-choice':
      a = { k: 'event', i: n };
      break;
    case 'market-crate':
      a = { k: 'market', what: 'crate' };
      break;
    case 'market-blood':
      a = { k: 'market', what: 'blood' };
      break;
    case 'market-bet':
      a = { k: 'market', what: 'bet' };
      break;
    case 'leave':
      a = { k: 'leave' };
      break;
    default:
      return false;
  }
  if (a) {
    sfx.click();
    send(a);
  }
  return true;
}

function startRun(classId: ClassId, daily = false): void {
  const m = S.meta;
  if (LOCKED_CLASSES.includes(classId) && !m.hybridUnlocked) return;
  m.loops++;
  saveMeta();
  if (daily) {
    const date = todayString();
    const setup = dailySetup(date);
    S.run = new Run(setup.classId, setup.seed, { daily: date });
  } else {
    S.run = new Run(classId, undefined, { threat: Math.min(m.threat, m.maxThreat) });
  }
  S.selected = null;
  S.modal = null;
  S.runClosed = false;
  sfx.click();
  render();
}

function playCard(uid: number, targetUid?: number): void {
  const run = S.run!;
  const el = app.querySelector<HTMLElement>(`.hand [data-id="${uid}"]`);
  S.selected = null;
  if (S.party) {
    send({ k: 'card', uid, target: targetUid });
    return render();
  }
  const type = run.combat?.hand.find((c) => c.uid === uid)?.def.type;
  const played = run.playCard(uid, targetUid);
  if (played) {
    sfx.card();
    if (el) flyCard(el);
  }
  afterAction();
  if (played && type === 'attack') {
    sfx.shoot();
    playCharAnim(app.querySelector('.player'), 'attack');
  }
}

function clickCard(uid: number): void {
  const combat = S.run?.combat;
  if (!combat || S.busy || S.run!.phase !== 'combat') return;
  const card = combat.hand.find((c) => c.uid === uid);
  if (!card) return;
  if (!combat.canPlay(card)) return sfx.deny();
  if (card.def.needsTarget && combat.aliveEnemies.length > 1) {
    S.selected = S.selected === uid ? null : uid;
    sfx.click();
    render();
  } else {
    playCard(uid);
  }
}

function clickEnemy(uid: number): void {
  if (S.selected === null || S.busy) return;
  playCard(S.selected, uid);
}

/** Ends the turn and plays the enemy phase one enemy at a time. */
async function endTurn(): Promise<void> {
  const run = S.run;
  if (!run || run.phase !== 'combat' || S.busy || run.combat?.phase !== 'player') return;
  if (S.party) {
    if (run.combat.status !== 'playing') return;
    S.selected = null;
    sfx.click();
    return send({ k: 'end' });
  }
  S.busy = true;
  S.selected = null;
  sfx.click();

  run.beginEnemyPhase(); // turrets, airstrikes and Corruption resolve here
  render();
  await flushFx();
  await sleep(250);

  while (run.phase === 'combat') {
    const next = run.combat!.peekEnemy();
    if (!next) break;
    const el = app.querySelector(`.enemy[data-fx="${next.uid}"]`);
    el?.classList.add('lunge');
    (next.def.tier === 'boss' ? sfx.roar : sfx.enemy)();
    await sleep(Math.max(280, Math.min(700, playCharAnim(el, 'attack'))));
    run.enemyStep();
    render();
    await flushFx();
    await sleep(320);
  }

  if (run.phase === 'combat') {
    run.finishEnemyPhase();
    sfx.draw();
  }
  S.busy = false;
  afterAction();
}

async function useReset(): Promise<void> {
  const run = S.run;
  if (!run || run.phase !== 'dead' || S.busy) return;
  if (S.party) return send({ k: 'reset' });
  S.busy = true;
  sfx.reset();
  await rewindFx(() => {
    run.useReset();
    S.busy = false;
    render();
  });
}

function pickCard(deckIndex: number): void {
  const run = S.run!;
  const modal = S.modal;
  if (modal?.kind !== 'pick') return;
  if (S.party) {
    send({ k: modal.mode === 'upgrade' ? 'upgrade' : 'remove', i: deckIndex });
    S.modal = null;
    return render();
  }
  const ok = modal.mode === 'upgrade' ? run.campUpgrade(deckIndex) : run.buyRemoval(deckIndex);
  (ok ? sfx.buy : sfx.deny)();
  S.modal = null;
  render();
}

/** A purchase or other action that can fail: plays the right sound and redraws. */
function attempt(ok: boolean): void {
  (ok ? sfx.buy : sfx.deny)();
  render();
}

function act(action: string, id: string): void {
  const m = S.meta;
  const n = Number(id);

  // Title screen actions, available without a run.
  switch (action) {
    case 'class':
      return startRun(id as ClassId);
    case 'daily':
      return startRun('grunt', true);
    case 'threat':
      m.threat = Math.max(0, Math.min(m.maxThreat, m.threat + n));
      saveMeta();
      sfx.click();
      return render();
    case 'mute':
      m.muted = !m.muted;
      saveMeta();
      music.refresh();
      sfx.click();
      return render();
    case 'coop-host':
      return openSession(true);
    case 'coop-join':
      return openSession(false);
    case 'coop-leave':
      sfx.click();
      return leaveCoop();
    case 'coop-pick':
      if (LOCKED_CLASSES.includes(id as ClassId) && !m.hybridUnlocked) return;
      S.session?.pick(id as ClassId);
      return sfx.click();
    case 'coop-start':
      return S.session?.start(Math.min(m.threat, m.maxThreat));
    case 'coop-copy': {
      const link = inviteLink(S.session?.code ?? '');
      void navigator.clipboard?.writeText(link).catch(() => undefined);
      document.querySelector<HTMLInputElement>('#coop-link')?.select();
      S.copied = true;
      return render();
    }
  }

  const run = S.run;
  if (!run) return;
  if (action === 'title' && S.session) {
    sfx.click();
    return leaveCoop();
  }
  if (S.party && coopAct(action, n)) return;

  switch (action) {
    case 'title':
      closeRun(run); // giving up still counts as a daily attempt
      S.run = null;
      S.modal = null;
      sfx.click();
      return render();
    case 'deck':
      S.modal = { kind: 'deck' };
      sfx.click();
      return render();
    case 'close-modal':
      S.modal = null;
      return render();
    case 'pick-card':
      return pickCard(n);
    case 'gear-pick':
      run.chooseStartingGear(n);
      sfx.buy();
      return render();
    case 'node':
      run.enterNode(n);
      sfx.click();
      return afterAction();
    case 'card':
      return clickCard(n);
    case 'enemy':
      return clickEnemy(n);
    case 'end-turn':
      return void endTurn();
    case 'stim':
      if (!S.busy && run.useStim(n)) {
        sfx.buy();
        afterAction();
      }
      return;
    case 'reset':
      return void useReset();
    case 'reward-card':
      run.takeRewardCard(n);
      sfx.buy();
      return render();
    case 'reward-continue':
      run.leaveReward();
      sfx.click();
      return afterAction();
    case 'shop-card':
      return attempt(run.buyCard(n));
    case 'shop-gear':
      return attempt(run.buyGear(n));
    case 'shop-stim':
      return attempt(run.buyStim(n));
    case 'shop-reset':
      return attempt(run.buyReset());
    case 'shop-remove':
      S.modal = { kind: 'pick', mode: 'remove' };
      return render();
    case 'camp-rest':
      run.campRest();
      sfx.heal();
      return render();
    case 'camp-upgrade':
      S.modal = { kind: 'pick', mode: 'upgrade' };
      return render();
    case 'event-choice': {
      const rolled = run.event?.choices[n]?.chance !== undefined;
      run.chooseEvent(n);
      const success = run.event?.success;
      if (rolled) sfx.dice();
      setTimeout(success === false ? sfx.deny : sfx.buy, rolled ? 350 : 0);
      return render();
    }
    case 'market-crate':
      run.marketCrate();
      sfx.buy();
      return render();
    case 'market-blood':
      run.marketBlood();
      sfx.hurt();
      return render();
    case 'market-bet': {
      const before = run.scrap;
      run.marketBet();
      sfx.dice();
      const won = run.scrap > before;
      setTimeout(won ? sfx.buy : sfx.deny, 350);
      return render();
    }
    case 'leave':
      run.leave();
      sfx.click();
      return render();
  }
}

app.addEventListener('click', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  unlockAudio();
  if (!el || el.hasAttribute('disabled')) return;
  act(el.dataset.action!, el.dataset.id ?? '');
});

// Clicks on the backdrop, outside #app, should start the sound too.
window.addEventListener('pointerdown', () => unlockAudio());

window.addEventListener('keydown', (event) => {
  unlockAudio();
  if (event.target instanceof HTMLInputElement) {
    if (event.key === 'Enter' && event.target.id === 'coop-code') openSession(false);
    return;
  }
  const run = S.run;
  if (event.key === 'Escape' && (S.selected !== null || S.modal)) {
    S.selected = null;
    S.modal = null;
    return render();
  }
  if (!run || run.phase !== 'combat' || S.busy || S.modal) return;
  if (event.key === 'e' || event.key === 'E') return void endTurn();
  const n = Number(event.key);
  if (Number.isInteger(n) && n >= 1) {
    const card = run.combat!.hand[n - 1];
    if (card) clickCard(card.uid);
  }
});

// ---------- dev tools (not in production builds) ----------

if (import.meta.env.DEV) {
  const rng = new Rng(12345);
  Object.assign(window, {
    dz: {
      state: S,
      /** Co-op: let the bot make this player's next move. Returns what it did. */
      bot() {
        const action = S.party ? botAction(S.party, S.me, rng) : null;
        if (action) send(action);
        return action;
      },
      /** Jump straight to a node type: dz.enter('shop') */
      enter(type: NodeType) {
        S.run?.enterType(type);
        afterAction();
      },
      /** Let the bot finish the current fight. */
      autoFight() {
        const run = S.run;
        for (let i = 0; run && run.phase === 'combat' && i < 500; i++) botStep(run, rng);
        run?.combat?.fx.splice(0);
        afterAction();
        return run?.phase;
      },
      /** Let the bot play until the run ends or `stopAt` phase is reached. */
      autoRun(stopAt?: string) {
        const run = S.run;
        for (let i = 0; run && run.phase !== stopAt && i < 20000 && botStep(run, rng); i++) {
          // keep stepping
        }
        run?.combat?.fx.splice(0);
        afterAction();
        return run ? `${run.phase} act ${run.act + 1} fights ${run.fightsWon}` : 'no run';
      },
    },
  });
}

// Fetch every icon up front so they don't pop in the first time a screen is shown.
const iconNames = new Set([
  ...Object.values(CARDS).map((c) => c.icon),
  ...ALL_ENEMIES.map((e) => e.icon),
  ...GEAR.map((g) => g.icon),
  ...STIMS.map((s) => s.icon),
  ...CLASS_LIST.map((c) => c.icon),
  ...Object.values(NODE_INFO).map((n) => n.icon),
  'backward-time',
]);

// An invite link (?join=CODE) fills in the room code.
S.joinCode = cleanCode(new URLSearchParams(location.search).get('join'));
if (S.joinCode) S.notice = 'You have been invited to a squad. Type your name and press Join.';
for (const name of iconNames) new Image().src = assetUrl(`icons/${name}.svg`);

render();
