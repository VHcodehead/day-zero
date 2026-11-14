import { card } from '../engine/cards';
import { CLASS_LIST, CLASSES, LOCKED_CLASSES } from '../engine/classes';
import { MAX_CORRUPTION, type Combat } from '../engine/combat';
import { MAX_STIMS } from '../engine/items';
import { MAP_ROWS, type NodeType } from '../engine/map';
import { MAX_THREAT, THREATS } from '../engine/modifiers';
import type { Party } from '../engine/party';
import { MARKET, type Run, type ShopItem } from '../engine/run';
import type { CardDef, CardInstance, Enemy, Move, Statuses } from '../engine/types';
import { CLASS_ART, ENEMY_ART } from './art-manifest';
import { BASE, spriteHtml } from './assets';
import { dailySetup, S, todayString } from './state';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** Tinted icon from public/icons (game-icons.net, see CREDITS.md). */
export const icon = (name: string, cls = ''): string =>
  `<div class="icon ${cls}" style="--icon:url('${BASE}icons/${name}.svg')"></div>`;

export const NODE_INFO: Record<NodeType, { icon: string; label: string; desc: string }> = {
  skirmish: { icon: 'crossed-swords', label: 'Skirmish', desc: 'A fight. Win a card and some Scrap.' },
  elite: { icon: 'death-skull', label: 'Alpha', desc: 'A hard fight. Win gear and better cards.' },
  shop: { icon: 'shop', label: 'Supply Depot', desc: 'Spend Scrap on cards, gear and stims.' },
  camp: { icon: 'campfire', label: 'Field Camp', desc: 'Heal, or upgrade a card.' },
  event: { icon: 'radio-tower', label: 'Signal', desc: 'Something is out there. Choices and dice rolls.' },
  cache: { icon: 'locked-chest', label: 'Cache', desc: 'Free gear.' },
  market: { icon: 'rolling-dices', label: 'Black Market', desc: 'Gamble HP or Scrap for mystery rewards.' },
  boss: { icon: 'crowned-skull', label: 'Boss', desc: 'The end of the act.' },
};

/**
 * A character: its animated sprite if art-manifest.ts has one, otherwise the flat icon.
 * "dying" plays the death animation once; "dead" shows its last frame.
 */
function charArt(
  kind: 'enemy' | 'class',
  id: string,
  fallbackIcon: string,
  cls: string,
  state: 'idle' | 'dying' | 'dead' = 'idle',
): string {
  const art = (kind === 'enemy' ? ENEMY_ART : CLASS_ART)[id];
  if (!art) return icon(fallbackIcon, cls);
  const dead = state !== 'idle';
  const sheet = dead && art.death ? art.death : art.idle;
  const sprite = spriteHtml(sheet, art.height, {
    cls: `char ${dead ? 'corpse' : ''}`,
    flip: art.flip,
    once: state === 'dying' && !!art.death,
    held: state === 'dead' && !!art.death,
    attrs: `data-art="${kind}:${id}"`,
  });
  return `<div class="char-wrap ${cls}-sprite" style="height:${art.height}px;margin-bottom:${-(art.drop ?? 0)}px">${sprite}</div>`;
}

// ---------- shared pieces ----------

export function cardHtml(def: CardDef, opts: { attrs?: string; classes?: string; hotkey?: number } = {}): string {
  const ammo = def.ammo ? `<div class="card-ammo" title="Ammo cost">${'▮'.repeat(def.ammo)}</div>` : '';
  return `
    <div class="card type-${def.type} rarity-${def.rarity} ${def.upgraded ? 'upgraded' : ''} ${def.mod ? 'modded' : ''} ${opts.classes ?? ''}" ${opts.attrs ?? ''}>
      <div class="card-top">
        <div class="card-cost">${def.unplayable ? '✕' : def.cost}</div>
        ${ammo}
      </div>
      ${icon(def.icon, 'card-art')}
      <div class="card-name">${def.name}</div>
      <div class="card-type">${def.type}</div>
      <div class="card-text">${def.text}${def.mod ? `<div class="card-mod">${def.mod.name}: ${def.mod.text}</div>` : ''}</div>
      ${opts.hotkey ? `<div class="card-hotkey">${opts.hotkey}</div>` : ''}
    </div>`;
}

function statusChips(s: Statuses): string {
  const chips: string[] = [];
  if (s.strength) chips.push(`<span class="chip buff" title="Extra damage per hit">+${s.strength} DMG</span>`);
  if (s.vulnerable) chips.push(`<span class="chip debuff" title="Takes 50% more damage">Vulnerable ${s.vulnerable}</span>`);
  if (s.weak) chips.push(`<span class="chip debuff" title="Deals 25% less damage">Weak ${s.weak}</span>`);
  return chips.join('');
}

/** HP bar that starts at its previous width so the change can animate. */
function hpBar(key: string, hp: number, max: number, block: number): string {
  const to = (hp / max) * 100;
  const from = S.prevHp.get(key) ?? to;
  S.prevHp.set(key, to);
  return `
    <div class="hpbar ${block ? 'shielded' : ''}">
      <div class="hpbar-fill" style="width:${from}%" data-w="${to}%"></div>
      <span>${hp} / ${max}</span>
    </div>
    ${block ? `<div class="block">🛡 ${block}</div>` : ''}`;
}

const pips = (filled: number, total: number, glyph: string): string =>
  `<span class="pips">${glyph.repeat(Math.max(0, filled))}<span class="empty">${glyph.repeat(Math.max(0, total - filled))}</span></span>`;

function screen(key: string, cls: string, body: string): string {
  const enter = S.lastScreen !== key;
  S.lastScreen = key;
  return `<main class="screen ${cls} ${enter ? 'enter' : ''}">${body}</main>`;
}

// ---------- title ----------

function titleView(): string {
  const m = S.meta;
  const { loops, wins, known } = m;
  const enter = S.lastScreen !== 'title';
  S.lastScreen = 'title';

  const today = todayString();
  const dailyClass = CLASSES[dailySetup(today).classId];
  const dailyBest = m.daily?.date === today ? m.daily : null;
  const dailyPanel = `
    <div class="panel">
      <h3>Daily loop · ${today}</h3>
      <p>Today's soldier is the <b>${dailyClass.name}</b>. The map, fights, shops and rewards are the same for everyone who plays today. Scores are kept on this device only.</p>
      <p class="dim">${dailyBest ? `Your best today: <b>${dailyBest.best}</b> in ${dailyBest.attempts} attempt${dailyBest.attempts === 1 ? '' : 's'}.` : 'Not played yet today.'}</p>
      <button class="btn primary" data-action="daily">Play the daily loop</button>
    </div>`;

  const threat = Math.min(m.threat, m.maxThreat);
  const threatPanel = `
    <div class="panel">
      <h3>Threat level</h3>
      ${
        m.maxThreat === 0
          ? '<p class="dim">Win a run to unlock Threat 1. Each level adds a handicap on top of the last, up to ' + MAX_THREAT + '.</p>'
          : `<div class="threat-row">
              <button class="btn small" data-action="threat" data-id="-1" ${threat <= 0 ? 'disabled' : ''}>−</button>
              <div class="threat-level"><b>${threat}</b> <span class="dim">of ${m.maxThreat} unlocked</span></div>
              <button class="btn small" data-action="threat" data-id="1" ${threat >= m.maxThreat ? 'disabled' : ''}>+</button>
            </div>
            ${
              threat
                ? `<ul class="threat-list">${THREATS.slice(0, threat).map((t) => `<li>${t}</li>`).join('')}</ul>`
                : '<p class="dim">Standard difficulty. Win at your highest level to unlock the next.</p>'
            }`
      }
    </div>`;

  return `
    <main class="screen title-screen ${enter ? 'enter' : ''}">
      <h1 class="logo">DAY ZERO</h1>
      <p class="tagline">The invasion fails. You die on the beach. Then you wake up, and it is this morning again.</p>
      <p class="dim">${loops ? `Loops lived: <b>${loops}</b> · Victories: <b>${wins}</b> · Hostiles identified: <b>${known.length}</b>` : 'First loop.'}</p>
      <h2>Choose your soldier</h2>
      <div class="class-grid">
        ${CLASS_LIST.map((c) => {
          const locked = LOCKED_CLASSES.includes(c.id) && !m.hybridUnlocked;
          return `
          <button class="class-card" data-action="class" data-id="${c.id}" ${locked ? 'disabled' : ''}>
            ${icon(c.icon, 'class-art')}
            <div class="class-name">${c.name}</div>
            <div class="class-tag">${c.tagline}</div>
            <p>${c.description}</p>
            ${locked ? '<div class="locked">LOCKED · beat the Act 1 boss</div>' : `<div class="class-stats">♥ ${c.maxHp} · ⟲ ${c.resets} Resets</div>`}
          </button>`;
        }).join('')}
      </div>
      <div class="title-panels">${coopPanel()}${dailyPanel}${threatPanel}</div>
      <p><button class="btn small" data-action="mute">${m.muted ? '🔇 Sound off' : '🔊 Sound on'}</button> <a class="btn small" href="${BASE}credits.txt" target="_blank" rel="noopener">Credits</a></p>
      <p class="credit">Icons: <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a> (CC BY 3.0)</p>
    </main>`;
}

// ---------- co-op ----------

function coopPanel(): string {
  return `
    <div class="panel coop-panel">
      <h3>Co-op · 2 to 4 players online</h3>
      <p>Fight the same enemies together, each with your own soldier, deck and energy. One of you hosts and shares the room code.</p>
      <div class="coop-row">
        <label for="coop-name">Your name</label>
        <input id="coop-name" maxlength="14" autocomplete="off" value="${esc(S.meta.name)}" placeholder="Soldier">
      </div>
      <div class="coop-row">
        <button class="btn primary" data-action="coop-host">Host a game</button>
        <span class="dim">or</span>
        <input id="coop-code" maxlength="5" autocomplete="off" value="${esc(S.joinCode)}" placeholder="CODE">
        <button class="btn" data-action="coop-join">Join</button>
      </div>
      ${S.notice ? `<p class="bad">${esc(S.notice)}</p>` : ''}
    </div>`;
}

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?join=${code}`;
}

function lobbyView(): string {
  const session = S.session!;
  const enter = S.lastScreen !== 'lobby';
  S.lastScreen = 'lobby';
  if (session.state === 'connecting') {
    return `
      <main class="screen center-screen ${enter ? 'enter' : ''}">
        <h2>${session.isHost ? 'Opening a room…' : `Joining ${esc(session.code)}…`}</h2>
        <p class="dim">Connecting players directly to each other. This can take a few seconds.</p>
        <button class="btn" data-action="coop-leave">Cancel</button>
      </main>`;
  }
  const mine = session.players[session.me]?.classId ?? null;
  const players = session.players
    .map((p, i) => {
      const cls = p.classId ? CLASSES[p.classId] : null;
      return `
        <div class="lobby-player ${i === session.me ? 'me' : ''}">
          ${cls ? icon(cls.icon, 'who-icon') : '<div class="icon who-icon"></div>'}
          <b>${esc(p.name)}</b>${i === 0 ? ' <span class="badge">Host</span>' : ''}${i === session.me ? ' <span class="dim">(you)</span>' : ''}
          <span class="${cls ? '' : 'dim'}">${cls ? cls.name : 'choosing…'}</span>
        </div>`;
    })
    .join('');
  const waitingFor = session.players.length < 2 ? 'Waiting for at least one more player.' : session.players.some((p) => !p.classId) ? 'Waiting for everyone to choose a soldier.' : '';
  return `
    <main class="screen title-screen lobby ${enter ? 'enter' : ''}">
      <h2>SQUAD LOBBY</h2>
      <div class="panel lobby-code">
        <div>Room code</div>
        <div class="room-code">${esc(session.code)}</div>
        <div class="coop-row">
          <input id="coop-link" readonly value="${esc(inviteLink(session.code))}">
          <button class="btn small" data-action="coop-copy">${S.copied ? 'Copied' : 'Copy invite link'}</button>
        </div>
        <p class="dim">Send friends the link, or have them type the code on the title screen. Up to 4 players.</p>
      </div>
      <div class="lobby-players">${players}</div>
      <h2>Choose your soldier</h2>
      <div class="class-grid">
        ${CLASS_LIST.map((c) => {
          const locked = LOCKED_CLASSES.includes(c.id) && !S.meta.hybridUnlocked;
          return `
          <button class="class-card ${mine === c.id ? 'picked' : ''}" data-action="coop-pick" data-id="${c.id}" ${locked ? 'disabled' : ''}>
            ${icon(c.icon, 'class-art')}
            <div class="class-name">${c.name}</div>
            <div class="class-tag">${c.tagline}</div>
            <p>${c.description}</p>
            ${locked ? '<div class="locked">LOCKED · beat the Act 1 boss</div>' : `<div class="class-stats">♥ ${c.maxHp}</div>`}
          </button>`;
        }).join('')}
      </div>
      <div class="panel">
        <h3>How co-op works</h3>
        <ul class="threat-list">
          <li>You travel the map together. Anyone can pick the route once everyone is ready.</li>
          <li>Enemies have more HP, and each of their moves hits every player.</li>
          <li>Everyone plays their turn at the same time. Enemies act when all of you have ended your turn.</li>
          <li>At 0 HP you are down for the fight, and get back up afterwards if the squad wins.</li>
          <li>Resets are shared. If everyone goes down, one Reset replays the fight.</li>
          <li>Rewards, shops, camps and events are your own.</li>
        </ul>
      </div>
      <p>
        ${
          session.isHost
            ? `<button class="btn primary" data-action="coop-start" ${session.canStart ? '' : 'disabled'}>Start the loop</button>`
            : '<span class="dim">The host starts the game.</span>'
        }
        <button class="btn" data-action="coop-leave">Leave</button>
      </p>
      ${waitingFor ? `<p class="dim">${waitingFor}</p>` : ''}
    </main>`;
}

const PHASE_LABEL: Record<string, string> = {
  gear: 'picking kit',
  map: 'ready',
  reward: 'collecting loot',
  shop: 'at the depot',
  camp: 'at camp',
  event: 'answering a signal',
  market: 'at the black market',
  dead: 'down',
  gameover: 'down',
  victory: 'victorious',
};

const squadNames = (party: Party, players: number[]): string => players.map((i) => esc(party.names[i])).join(', ');

/** One line per squad: who is here, how hurt they are and what they are doing. */
function squadBar(): string {
  const party = S.party;
  if (!party) return '';
  const mates = party.runs
    .map((run, i) => {
      const fighting = run.phase === 'combat' && run.combat;
      const c = fighting ? run.combat! : null;
      const hp = c ? c.player.hp : run.hp;
      let state = PHASE_LABEL[run.phase] ?? '';
      let cls = '';
      if (party.gone[i]) {
        state = 'left the game';
        cls = 'gone';
      } else if (c) {
        if (c.status === 'lost') [state, cls] = ['DOWN', 'down'];
        else if (c.phase === 'enemy') [state, cls] = ['turn ended', 'ready'];
        else [state, cls] = ['playing', 'busy'];
      } else if (run.phase === 'map') cls = 'ready';
      else cls = 'busy';
      return `
        <div class="mate ${cls} ${i === S.me ? 'me' : ''}" title="${esc(party.names[i])} · ${run.cls.name}">
          ${icon(run.cls.icon, 'who-icon')}
          <b>${esc(party.names[i])}</b>
          <span>♥ ${hp}/${run.maxHp}</span>
          ${c && c.player.block ? `<span class="mate-block">🛡 ${c.player.block}</span>` : ''}
          <span class="mate-state">${state}</span>
        </div>`;
    })
    .join('');
  return `<div class="squad">${mates}${S.desync ? '<div class="mate down" title="The players\' games no longer match. Results may differ between you. Start a new game to fix it.">⚠ OUT OF SYNC</div>' : ''}</div>`;
}

// ---------- top bar ----------

function topbar(run: Run): string {
  const combat = run.combat;
  const fighting = combat && ['combat', 'dead', 'gameover', 'victory'].includes(run.phase);
  const hp = fighting ? combat.player.hp : run.hp;
  const canStim = run.phase === 'combat' && combat?.phase === 'player' && !S.busy;
  const stims = Array.from({ length: MAX_STIMS }, (_, i) => {
    const stim = run.stims[i];
    return stim
      ? `<button class="slot stim" data-action="stim" data-id="${i}" ${canStim ? '' : 'disabled'} title="${stim.name}: ${stim.text}${canStim ? ' (click to use)' : ' (use it on your turn in a fight)'}">${icon(stim.icon)}</button>`
      : `<div class="slot empty" title="Empty stim slot"></div>`;
  }).join('');
  const gear = run.gear
    .map((g) => `<div class="slot gear" title="${g.name}: ${g.text}">${icon(g.icon)}</div>`)
    .join('');

  return `
    <header class="topbar">
      <div class="title">DAY ZERO</div>
      <div class="who">${icon(run.cls.icon, 'who-icon')} ${run.cls.name}</div>
      <div title="Health">♥ <b>${hp}</b>/${run.maxHp}</div>
      <div title="Scrap: spend it at Supply Depots">⚙ <b>${run.scrap}</b></div>
      <div title="Die with a Reset left and you replay the fight with foresight">${S.party ? 'Squad Resets' : 'Resets'} ${pips(run.resets, Math.max(run.resets, run.cls.resets), '⟲')}</div>
      <div>Act <b>${run.act + 1}</b> · ${run.actName}</div>
      ${run.threat ? `<div class="badge" title="${THREATS.slice(0, run.threat).join(' ')}">Threat ${run.threat}</div>` : ''}
      ${run.daily ? `<div class="badge daily" title="Daily loop for ${run.daily}">Daily · ${run.score} pts</div>` : ''}
      <div class="slots">${gear}</div>
      <div class="slots">${stims}</div>
      <div class="top-actions">
        <button class="btn small" data-action="mute" title="Toggle sound">${S.meta.muted ? '🔇' : '🔊'}</button>
        <button class="btn small" data-action="deck">Deck (${run.deck.length})</button>
      </div>
    </header>`;
}

// ---------- starting gear ----------

function gearView(run: Run): string {
  return screen(
    'gear',
    'center-screen',
    `
    <h2>Loop ${S.meta.loops}: pick your kit</h2>
    <p class="dim">One piece of gear to start with. Gear lasts the whole run.</p>
    <div class="choice-row">
      ${run.gearChoices
        .map(
          (g, i) => `
        <button class="item-card" data-action="gear-pick" data-id="${i}">
          ${icon(g.icon, 'item-art gear-tint')}
          <div class="item-name">${g.name}</div>
          <p>${g.text}</p>
        </button>`,
        )
        .join('')}
    </div>`,
  );
}

// ---------- map ----------

function mapView(run: Run): string {
  const nodes = run.map.nodes;
  const party = S.party;
  const held = !!party && !party.canTravel;
  const available = new Set(held ? [] : run.availableNodes().map((n) => n.id));
  const visited = new Set(run.visited);
  const y = (row: number): number => 93 - row * (86 / (MAP_ROWS - 1));

  const lines = nodes
    .flatMap((n) =>
      n.next.map((id) => {
        const to = nodes[id];
        const walked = visited.has(n.id) && visited.has(id);
        const open = n.id === run.nodeId && available.has(id);
        return `<line x1="${n.x * 100}" y1="${y(n.row)}" x2="${to.x * 100}" y2="${y(to.row)}" class="${walked ? 'walked' : open ? 'open' : ''}" />`;
      }),
    )
    .join('');

  const dots = nodes
    .map((n) => {
      const info = NODE_INFO[n.type];
      const state = n.id === run.nodeId ? 'current' : visited.has(n.id) ? 'visited' : available.has(n.id) ? 'available' : '';
      return `
        <button class="node node-${n.type} ${state}" style="left:${n.x * 100}%;top:${y(n.row)}%"
          data-action="node" data-id="${n.id}" ${available.has(n.id) ? '' : 'disabled'}
          title="${info.label}: ${info.desc}">${icon(info.icon)}</button>`;
    })
    .join('');

  const legend = (Object.keys(NODE_INFO) as NodeType[])
    .map((t) => `<div class="legend-row node-${t}" title="${NODE_INFO[t].desc}">${icon(NODE_INFO[t].icon)} ${NODE_INFO[t].label}</div>`)
    .join('');

  return screen(
    `map-${run.act}`,
    'map-screen',
    `
    <div class="map-head">
      <h2>ACT ${run.act + 1} — ${run.actName.toUpperCase()}</h2>
      <p class="dim">${
        held
          ? `Waiting for ${squadNames(party, party.waitingOn)} before the squad moves on.`
          : party
            ? 'Anyone in the squad can choose the route. You can only move up along the lines.'
            : 'Choose your route. You can only move up along the lines.'
      }</p>
    </div>
    <div class="map-wrap">
      <div class="map">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>
        ${dots}
      </div>
      <aside class="legend"><h3>Legend</h3>${legend}</aside>
    </div>`,
  );
}

// ---------- combat ----------

function intentText(combat: Combat, enemy: Enemy, move: Move): string {
  const parts: string[] = [];
  if (move.damage) {
    const hits = move.hits && move.hits > 1 ? `×${move.hits}` : '';
    parts.push(`<span class="i-attack">⚔ ${combat.previewEnemyHit(enemy, move)}${hits}</span>`);
  }
  if (move.block) parts.push(`<span class="i-block">🛡 ${move.block}</span>`);
  if (move.heal) parts.push(`<span class="i-heal">✚ ${move.heal}</span>`);
  if (move.strength) parts.push(`<span class="i-buff">▲ +${move.strength} DMG</span>`);
  if (move.weak) parts.push(`<span class="i-debuff">▼ Weak ${move.weak}</span>`);
  if (move.vulnerable) parts.push(`<span class="i-debuff">▼ Vuln ${move.vulnerable}</span>`);
  if (move.wound) parts.push(`<span class="i-debuff">▼ Static ${move.wound}</span>`);
  return `<span class="move-name">${move.name}</span> ${parts.join(' ')}`;
}

function enemyHtml(run: Run, combat: Combat, enemy: Enemy): string {
  if (enemy.hp <= 0) {
    const dying = !S.deadShown.has(enemy.uid);
    S.deadShown.add(enemy.uid);
    return `
      <div class="enemy dead ${dying ? 'dying' : ''}" data-fx="${enemy.uid}">
        ${charArt('enemy', enemy.def.id, enemy.def.icon, 'enemy-art', dying ? 'dying' : 'dead')}
        <div class="enemy-name">${enemy.def.name}</div><div class="kia">DESTROYED</div>
      </div>`;
  }
  const fog = run.anomaly?.id === 'fog' && !run.foresight;
  const known = !fog && (run.foresight || S.meta.known.includes(enemy.def.id));
  let intents: string;
  if (fog) {
    intents = `<div class="intent unknown" title="Fog hides enemy moves in this fight.">??? hidden by fog</div>`;
  } else if (!known) {
    intents = `<div class="intent unknown" title="You have never fought this before. Finish a fight against it, win or lose, to learn its patterns.">??? unknown hostile</div>`;
  } else {
    intents = enemy.plan
      .slice(0, run.intentsAhead)
      .map((move, i) => {
        const stunned = i === 0 && enemy.stunned;
        return `<div class="intent ${i ? 'future' : ''} ${stunned ? 'cancelled' : ''}"><span class="when">${i ? `+${i}` : 'NEXT'}</span> ${intentText(combat, enemy, move)}</div>`;
      })
      .join('');
  }
  const targetable = S.selected !== null && !S.busy;
  return `
    <div class="enemy tier-${enemy.def.tier} ${targetable ? 'targetable' : ''}" data-action="enemy" data-id="${enemy.uid}" data-fx="${enemy.uid}">
      <div class="intents">${intents}</div>
      ${charArt('enemy', enemy.def.id, enemy.def.icon, 'enemy-art')}
      <div class="enemy-name">${enemy.def.name}</div>
      ${hpBar(String(enemy.uid), enemy.hp, enemy.maxHp, enemy.block)}
      <div class="chips">${enemy.stunned ? '<span class="chip buff">Stunned</span>' : ''}${statusChips(enemy.statuses)}</div>
    </div>`;
}

function handCardHtml(combat: Combat, card: CardInstance, index: number): string {
  const isNew = !S.seenCards.has(card.uid);
  S.seenCards.add(card.uid);
  const classes = [
    combat.canPlay(card) && !S.busy ? 'playable' : 'disabled',
    S.selected === card.uid ? 'selected' : '',
    isNew ? 'draw-in' : '',
  ].join(' ');
  return cardHtml(card.def, {
    classes,
    attrs: `data-action="card" data-id="${card.uid}" style="animation-delay:${isNew ? index * 45 : 0}ms"`,
    hotkey: index + 1,
  });
}

function combatOverlay(run: Run): string {
  switch (run.phase) {
    case 'dead':
      return `
        <div class="overlay"><div class="modal">
          <h2 class="bad">${S.party ? 'SQUAD WIPED OUT' : 'KILLED IN ACTION'}</h2>
          <p>${S.party ? 'Anyone can trigger the Reset. You all wake up' : 'You wake up'} before the fight. The enemy will make <b>exactly the same moves</b>,
          and this time you'll see their next 3 turns coming.</p>
          <p class="dim">Costs 1 Reset (${run.resets} left)${run.hasGear('loop_anchor') ? '. Your Loop Anchor spares you the Scar.' : ' and adds a <b>Scar</b> to your deck.'}</p>
          <button class="btn primary" data-action="reset">⟲ RESET</button>
          <button class="btn" data-action="title">${S.party ? 'Leave the squad' : 'Give up'}</button>
        </div></div>`;
    case 'gameover':
      return `
        <div class="overlay"><div class="modal">
          <h2 class="bad">LOOP ${S.meta.loops} FAILED</h2>
          <p>No Resets left. You died in Act ${run.act + 1} after ${run.fightsWon} fight${run.fightsWon === 1 ? '' : 's'}.
          The day starts over, but you remember what you fought.</p>
          ${run.daily ? `<p>Daily score: <b>${run.score}</b></p>` : ''}
          <button class="btn primary" data-action="title">Wake up again</button>
        </div></div>`;
    case 'victory':
      return `
        <div class="overlay"><div class="modal">
          <h2 class="good">THE HIVE IS SILENT</h2>
          <p>Omega is dead. For the first time in ${S.meta.loops} loop${S.meta.loops === 1 ? '' : 's'}, the sun sets on this day.</p>
          <p class="dim">${run.cls.name} · ${run.hp} HP left · ${run.resets} Reset${run.resets === 1 ? '' : 's'} unused · ${run.deck.length} cards${run.threat ? ` · Threat ${run.threat}` : ''}</p>
          ${run.daily ? `<p>Daily score: <b>${run.score}</b></p>` : ''}
          <button class="btn primary" data-action="title">Play again</button>
        </div></div>`;
    default:
      return '';
  }
}

function combatView(run: Run): string {
  const combat = run.combat!;
  const p = combat.player;
  const enemyTurn = combat.phase === 'enemy';
  const party = S.party;
  const down = run.phase === 'combat' && combat.status === 'lost';
  const waitingOn = party && !S.busy && !party.enemiesActing ? party.waitingOn : [];
  const hint = down
    ? '<span class="enemy-turn">YOU ARE DOWN</span> You get back up after the fight if your squad wins it.'
    : enemyTurn && waitingOn.length
      ? `Turn ended. Waiting for ${squadNames(party!, waitingOn)}.`
      : enemyTurn
    ? '<span class="enemy-turn">ENEMY TURN</span>'
    : S.selected !== null
      ? 'Choose a target (Esc to cancel)'
      : 'Click a card or press 1–9 to play it. E ends your turn.';

  const stats: string[] = [
    `<div class="stat"><label>Energy</label><div class="energy">${p.energy}<small>/${p.maxEnergy}</small></div></div>`,
  ];
  if (p.maxAmmo) stats.push(`<div class="stat"><label>Ammo</label>${pips(p.ammo, p.maxAmmo, '▮')}</div>`);
  stats.push(
    `<div class="stat" title="Chance for each attack hit to deal double damage"><label>Crit</label><div>${p.nextCrit ? '100%' : pct(combat.critChance)}</div></div>`,
  );
  if (p.evade > 0) stats.push(`<div class="stat" title="Chance to avoid each enemy hit this turn"><label>Evade</label><div>${pct(p.evade)}</div></div>`);
  if (run.cls.id === 'engineer' || p.turrets || p.drones) {
    stats.push(
      `<div class="stat" title="Each Turret deals ${p.turretDamage} damage to a random enemy at the end of your turn"><label>Turrets</label><div>${p.turrets}</div></div>`,
      `<div class="stat" title="Each Shield Drone gives 3 Block at the start of your turn"><label>Drones</label><div>${p.drones}</div></div>`,
    );
  }
  if (run.cls.id === 'veteran' || p.scars) stats.push(`<div class="stat" title="Scars in your deck"><label>Scars</label><div>${p.scars}</div></div>`);
  if (run.cls.id === 'hybrid' || p.corruption) {
    stats.push(
      `<div class="stat" title="Right now: +${combat.corruptionBonus} damage per hit, and you lose ${combat.corruptionBurn} HP at the end of your turn"><label>Corruption</label><div class="corruption">${p.corruption}<small>/${MAX_CORRUPTION}</small></div><small class="dim">+${combat.corruptionBonus} dmg · −${combat.corruptionBurn} HP</small></div>`,
    );
  }

  return screen(
    'combat',
    'combat-screen',
    `
    ${run.foresight ? `<div class="banner">FORESIGHT — you've lived this fight before. Enemy moves are identical, and you see 3 turns ahead.</div>` : ''}
    ${run.anomaly ? `<div class="banner anomaly">ANOMALY: ${run.anomaly.name.toUpperCase()} — ${run.anomaly.text}</div>` : ''}
    <div class="layout">
      <section class="battlefield">
        <div class="enemies">${combat.enemies.map((e) => enemyHtml(run, combat, e)).join('')}</div>

        <div class="player" data-fx="player">
          ${charArt('class', run.cls.id, run.cls.icon, 'player-art')}
          <div class="player-main">
            <div class="enemy-name">${run.cls.name.toUpperCase()}</div>
            ${hpBar('player', p.hp, p.maxHp, p.block)}
            <div class="chips">${statusChips(p.statuses)}${p.systems.map((s) => `<span class="chip system">${s}</span>`).join('')}</div>
          </div>
          ${stats.join('')}
        </div>

        <div class="hint">${hint}</div>
        <div class="hand">${combat.hand.map((c, i) => handCardHtml(combat, c, i)).join('')}</div>

        <footer class="piles">
          <span>Draw <b>${combat.drawPile.length}</b></span>
          <span>Discard <b>${combat.discardPile.length}</b></span>
          <span>Exhausted <b>${combat.exhaustPile.length}</b></span>
          <button class="btn primary" data-action="end-turn" ${S.busy || enemyTurn || down ? 'disabled' : ''}>End Turn (E)</button>
        </footer>
      </section>

      <aside class="log">
        <h3>Combat log</h3>
        <div class="log-entries">
          ${combat.log
            .slice(-60)
            .map((entry) => `<div class="log-${entry.kind}">${entry.text}</div>`)
            .join('')}
        </div>
      </aside>
    </div>
    ${combatOverlay(run)}`,
  );
}

// ---------- reward ----------

function rewardView(run: Run): string {
  const r = run.reward!;
  const loot: string[] = [`<div class="loot">⚙ <b>+${r.scrap}</b> Scrap</div>`];
  if (r.healed) loot.push(`<div class="loot">♥ <b>+${r.healed}</b> HP from Field Rations</div>`);
  if (r.gear) loot.push(`<div class="loot" title="${r.gear.text}">${icon(r.gear.icon, 'loot-icon gear-tint')} Gear: <b>${r.gear.name}</b> — ${r.gear.text}</div>`);
  if (r.stim) loot.push(`<div class="loot" title="${r.stim.text}">${icon(r.stim.icon, 'loot-icon stim-tint')} Stim: <b>${r.stim.name}</b> — ${r.stim.text}</div>`);

  let cards = '';
  if (r.cards.length) {
    cards = r.cardTaken
      ? '<p class="dim">Card added to your deck.</p>'
      : `<p>Choose a card to add to your deck, or skip.</p>
         <div class="rewards">${r.cards.map((def, i) => cardHtml(def, { classes: 'playable', attrs: `data-action="reward-card" data-id="${i}"` })).join('')}</div>`;
  }
  return screen(
    'reward',
    'center-screen',
    `
    <h2 class="good">${r.title}</h2>
    <div class="loot-list">${loot.join('')}</div>
    ${cards}
    <button class="btn primary" data-action="reward-continue">${r.cards.length && !r.cardTaken ? 'Skip card and continue' : 'Continue'}</button>`,
  );
}

// ---------- shop ----------

function priceTag(run: Run, entry: ShopItem<unknown>, blocked = false): string {
  if (entry.sold) return '<div class="price sold">SOLD</div>';
  const cant = run.scrap < entry.price || blocked;
  return `<div class="price ${cant ? 'cant' : ''}">⚙ ${entry.price}</div>`;
}

function shopView(run: Run): string {
  const shop = run.shop!;
  const stimsFull = run.stims.length >= MAX_STIMS;
  const buyable = (e: ShopItem<unknown>, blocked = false): string =>
    e.sold || run.scrap < e.price || blocked ? 'disabled' : '';

  const cards = shop.cards
    .map(
      (e, i) => `
      <div class="shop-item ${e.sold ? 'is-sold' : ''}">
        ${cardHtml(e.item, { classes: e.sold || run.scrap < e.price ? 'disabled' : 'playable', attrs: `data-action="shop-card" data-id="${i}"` })}
        ${priceTag(run, e)}
      </div>`,
    )
    .join('');
  const items = [
    ...shop.gear.map(
      (e, i) => `
      <button class="item-card small ${e.sold ? 'is-sold' : ''}" data-action="shop-gear" data-id="${i}" ${buyable(e)}>
        ${icon(e.item.icon, 'item-art gear-tint')}
        <div class="item-name">${e.item.name}</div><p>${e.item.text}</p>${priceTag(run, e)}
      </button>`,
    ),
    ...shop.stims.map(
      (e, i) => `
      <button class="item-card small ${e.sold ? 'is-sold' : ''}" data-action="shop-stim" data-id="${i}" ${buyable(e, stimsFull)}
        title="${stimsFull ? 'Your stim slots are full' : ''}">
        ${icon(e.item.icon, 'item-art stim-tint')}
        <div class="item-name">${e.item.name}</div><p>${e.item.text}</p>${priceTag(run, e, stimsFull)}
      </button>`,
    ),
  ].join('');

  const removal: ShopItem<null> = { item: null, price: shop.removalPrice, sold: shop.removalUsed };
  const services = `
    <button class="item-card small ${removal.sold ? 'is-sold' : ''}" data-action="shop-remove" ${buyable(removal)}>
      ${icon('scar-wound', 'item-art')}
      <div class="item-name">Decommission</div><p>Remove a card from your deck for good.</p>${priceTag(run, removal)}
    </button>
    ${
      shop.reset
        ? `<button class="item-card small ${shop.reset.sold ? 'is-sold' : ''}" data-action="shop-reset" ${buyable(shop.reset)}>
            ${icon('backward-time', 'item-art reset-tint')}
            <div class="item-name">Spare Reset</div><p>One more chance to replay a lost fight.</p>${priceTag(run, shop.reset)}
          </button>`
        : ''
    }`;

  return screen(
    'shop',
    'wide-screen',
    `
    <h2>SUPPLY DEPOT</h2>
    <p class="dim">You have <b>⚙ ${run.scrap}</b> Scrap.</p>
    <h3>Cards</h3><div class="shop-row">${cards}</div>
    <h3>Gear and stims</h3><div class="shop-row">${items}</div>
    <h3>Services</h3><div class="shop-row">${services}</div>
    <button class="btn primary" data-action="leave">Leave</button>`,
  );
}

// ---------- camp ----------

function campView(run: Run): string {
  const heal = Math.min(run.maxHp - run.hp, Math.ceil(run.maxHp * run.campHeal));
  const canUpgrade = run.deck.some((c) => c.upgradesTo);
  return screen(
    'camp',
    'center-screen',
    `
    ${icon('campfire', 'hero-icon camp-tint')}
    <h2>FIELD CAMP</h2>
    <p class="dim">A quiet hour. You can do one thing.</p>
    <div class="choice-row">
      <button class="item-card" data-action="camp-rest">
        <div class="item-name">Rest</div><p>Heal <b>${heal}</b> HP (${pct(run.campHeal)} of your max).</p>
      </button>
      <button class="item-card" data-action="camp-upgrade" ${canUpgrade ? '' : 'disabled'}>
        <div class="item-name">Drill</div><p>Upgrade one card for the rest of the run.</p>
      </button>
    </div>`,
  );
}

// ---------- event ----------

function eventView(run: Run): string {
  const event = run.event!;
  let body: string;
  if (event.result !== null) {
    const tone = event.success === null ? '' : event.success ? 'good' : 'bad';
    body = `
      ${event.success === null ? '' : `<div class="roll ${tone}">${event.success ? 'SUCCESS' : 'FAILURE'}</div>`}
      <p class="event-result">${event.result}</p>
      <button class="btn primary" data-action="leave">Continue</button>`;
  } else {
    body = `<div class="event-choices">${event.choices
      .map(
        (c, i) => `
        <button class="event-choice" data-action="event-choice" data-id="${i}" ${c.disabled ? 'disabled' : ''}>
          <div class="choice-label">${c.label}${c.chance !== undefined ? ` <span class="odds">${pct(run.odds(c.chance))} chance</span>` : ''}</div>
          <div class="choice-detail">${c.detail}</div>
        </button>`,
      )
      .join('')}</div>`;
  }
  return screen(
    `event-${event.def.id}`,
    'center-screen narrow',
    `
    ${icon(event.def.icon, 'hero-icon event-tint')}
    <h2>${event.def.title.toUpperCase()}</h2>
    <p class="event-text">${event.def.text}</p>
    ${body}`,
  );
}

// ---------- black market ----------

function marketView(run: Run): string {
  const log = run.marketLog.map((line) => `<div>${line}</div>`).join('');
  return screen(
    'market',
    'center-screen narrow',
    `
    ${icon('rolling-dices', 'hero-icon market-tint')}
    <h2>BLACK MARKET</h2>
    <p class="event-text">A quartermaster with no unit patch and a tarp full of crates. "No refunds. No questions."</p>
    <p class="dim">You have <b>⚙ ${run.scrap}</b> Scrap and <b>♥ ${run.hp}</b> HP.</p>
    <div class="event-choices">
      <button class="event-choice" data-action="market-crate" ${run.scrap < MARKET.cratePrice ? 'disabled' : ''}>
        <div class="choice-label">Mystery crate <span class="odds">⚙ ${MARKET.cratePrice}</span></div>
        <div class="choice-detail">25% gear · 30% rare card · 25% stim · 20% junk that adds a Scar.</div>
      </button>
      <button class="event-choice" data-action="market-blood" ${run.hp <= MARKET.bloodCost ? 'disabled' : ''}>
        <div class="choice-label">Blood deal <span class="odds">♥ ${MARKET.bloodCost} HP</span></div>
        <div class="choice-detail">Get a random upgraded uncommon card.</div>
      </button>
      <button class="event-choice" data-action="market-bet" ${run.scrap < MARKET.bet ? 'disabled' : ''}>
        <div class="choice-label">Dice <span class="odds">${pct(run.odds(MARKET.betChance))} chance</span></div>
        <div class="choice-detail">Bet ⚙ ${MARKET.bet}. Win and you get ⚙ ${MARKET.betWin} back.</div>
      </button>
    </div>
    <div class="market-log">${log}</div>
    <button class="btn primary" data-action="leave">Leave</button>`,
  );
}

// ---------- modals ----------

function modalView(run: Run): string {
  const modal = S.modal;
  if (!modal) return '';
  let title: string;
  let cards: string;
  if (modal.kind === 'deck') {
    title = `Your deck (${run.deck.length})`;
    cards = [...run.deck]
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
      .map((def) => cardHtml(def))
      .join('');
  } else if (modal.mode === 'upgrade') {
    title = 'Choose a card to upgrade';
    cards = run.deck
      .map((def, i) =>
        def.upgradesTo
          ? cardHtml(card(def.upgradesTo), { classes: 'playable', attrs: `data-action="pick-card" data-id="${i}"` })
          : '',
      )
      .join('');
  } else {
    title = 'Choose a card to remove';
    cards = run.deck
      .map((def, i) => cardHtml(def, { classes: 'playable', attrs: `data-action="pick-card" data-id="${i}"` }))
      .join('');
  }
  return `
    <div class="overlay"><div class="modal deck-modal">
      <h2>${title}</h2>
      ${modal.kind === 'pick' && modal.mode === 'upgrade' ? '<p class="dim">Cards are shown as they will be after the upgrade.</p>' : ''}
      <div class="deck-grid">${cards}</div>
      <button class="btn" data-action="close-modal">${modal.kind === 'deck' ? 'Close' : 'Cancel'}</button>
    </div></div>`;
}

// ---------- root ----------

export function renderApp(): string {
  const run = S.run;
  if (!run) return S.session ? lobbyView() : titleView();
  let body: string;
  switch (run.phase) {
    case 'gear':
      body = gearView(run);
      break;
    case 'map':
      body = mapView(run);
      break;
    case 'reward':
      body = rewardView(run);
      break;
    case 'shop':
      body = shopView(run);
      break;
    case 'camp':
      body = campView(run);
      break;
    case 'event':
      body = eventView(run);
      break;
    case 'market':
      body = marketView(run);
      break;
    default:
      body = combatView(run);
  }
  return topbar(run) + squadBar() + body + modalView(run);
}
