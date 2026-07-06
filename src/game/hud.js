import { SYS_INFO, WEAPON_TYPES } from "../ship/defs.js";
import { SPECIES } from "./species.js";
import { effPower, evasion, maxShields, powerUsed, weaponPowered } from "./state.js";

// ============================================================================
// DOM HUD: power bars, weapon cards, crew cards, hull/shields, FTL, sector
// map, event/shop/game-over modals. Reads game state each frame, emits
// commands through `send(cmd)` and a couple of local UI callbacks.
// ============================================================================

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

const SYS_ORDER = ["shields", "engines", "weapons", "oxygen", "medbay", "pilot"];

export class Hud {
  constructor(root, overlayRoot, { send, ui, sfx, onRestart }) {
    this.root = root;
    this.overlayRoot = overlayRoot;
    this.send = send;
    this.ui = ui; // shared mutable ui state: {selectedCrew, targetingWi, hoverRoom}
    this.sfx = sfx;
    this.onRestart = onRestart;
    this.lastFxSeq = 0;
    this._build();
  }

  _build() {
    const r = this.root;
    r.innerHTML = "";

    // ---- top bar
    const top = el("div", null, r);
    top.id = "topbar";
    const left = el("div", "panel hullwrap", top);
    this.hullTitle = el("div", "hulltitle", left, "<span>SS LADLE</span><span>30/30</span>");
    const hullbar = el("div", "hullbar", left);
    this.hullFill = el("div", "fill", hullbar);
    const shieldRow = el("div", "hulltitle", left, "<span>SHIELDS</span>");
    this.shieldPips = el("div", "pips", left);
    this.statRow = el("div", "stat", left);

    const mid = el("div", "panel", top);
    mid.id = "ftlwrap";
    el("span", "stat", mid, "FTL");
    const fb = el("div", null, mid);
    fb.id = "ftlbar";
    this.ftlFill = el("div", "fill", fb);
    this.jumpBtn = el("button", "btn small", mid, "JUMP");
    this.jumpBtn.id = "jumpbtn";
    this.jumpBtn.onclick = () => {
      this.sfx.play("ui");
      this.send({ k: "jump" });
    };

    const right = el("div", "panel", top);
    right.style.display = "flex";
    right.style.gap = "6px";
    right.style.alignItems = "center";
    this.scrapEl = el("span", "stat", right, "⬡ <b>20</b>");
    this.pauseBtn = el("button", "btn small", right, "⏸");
    this.pauseBtn.onclick = () => this.send({ k: "pause" });
    this.muteBtn = el("button", "btn small", right, "🔊");
    this.muteBtn.onclick = () => {
      this.sfx.setMuted(!this.sfx.muted);
      this.muteBtn.innerHTML = this.sfx.muted ? "🔇" : "🔊";
    };

    // ---- crew strip
    this.crewStrip = el("div", null, r);
    this.crewStrip.id = "crewstrip";
    this.crewCards = new Map();

    // ---- bottom bar
    const bottom = el("div", null, r);
    bottom.id = "bottombar";
    const powerPanel = el("div", "panel", bottom);
    this.reactorInfo = el("div", null, powerPanel);
    this.reactorInfo.id = "reactorinfo";
    this.powerPanel = el("div", null, powerPanel);
    this.powerPanel.id = "powerpanel";
    this.sysCols = new Map();

    this.weaponPanel = el("div", null, bottom);
    this.weaponPanel.id = "weaponpanel";
    this.weaponCards = [];

    const hint = el("div", "panel hint", bottom, "click crew → click room · click weapon → click enemy room · click doors to vent · <span class='kbd'>space</span> pause");
    hint.style.marginLeft = "auto";
    hint.style.maxWidth = "230px";

    // ---- misc overlays
    this.toasts = el("div", null, r);
    this.toasts.id = "toasts";
    this.vignette = el("div", null, this.overlayRoot);
    this.vignette.id = "vignette";
    this.flash = el("div", null, this.overlayRoot);
    this.flash.id = "flash";
    this.pauseTag = el("div", null, this.overlayRoot, "PAUSED");
    this.pauseTag.id = "pausetag";
    this.pauseTag.style.display = "none";
    this.netBadge = el("div", null, r);
    this.netBadge.id = "netbadge";
    this.partnerCursor = el("div", null, this.overlayRoot);
    this.partnerCursor.id = "partnercursor";

    this.modalHost = el("div", null, this.overlayRoot);
    this._modalKey = null;
  }

  toast(msg, cls = "") {
    const t = el("div", `toast ${cls}`, this.toasts, msg);
    setTimeout(() => t.remove(), 4200);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  flashScreen(op = 0.5) {
    this.flash.style.transition = "none";
    this.flash.style.opacity = op;
    requestAnimationFrame(() => {
      this.flash.style.transition = "opacity 0.5s";
      this.flash.style.opacity = 0;
    });
  }

  // ------------------------------------------------------------------ update

  update(G, net) {
    const P = G.ships.player;
    if (!P) return;

    // hull
    const frac = Math.max(0, P.hull / P.hullMax);
    this.hullTitle.innerHTML = `<span>${P.name}</span><span>${Math.max(0, Math.ceil(P.hull))}/${P.hullMax}</span>`;
    this.hullFill.style.width = `${frac * 100}%`;
    this.hullFill.className = `fill${frac < 0.3 ? " crit" : frac < 0.6 ? " warn" : ""}`;
    this.vignette.className = frac < 0.3 && !G.over ? "danger" : "";

    // shields pips
    const maxSh = Math.max(maxShields(P), P.shieldLayers);
    if (this.shieldPips.children.length !== Math.max(4, maxSh)) {
      this.shieldPips.innerHTML = "";
      for (let i = 0; i < Math.max(4, maxSh); i++) el("div", "pip", this.shieldPips);
    }
    [...this.shieldPips.children].forEach((pip, i) => {
      pip.className = "pip" + (i < P.shieldLayers ? " on" : i === P.shieldLayers && maxShields(P) > P.shieldLayers ? " charge" : "");
      if (i === P.shieldLayers && maxShields(P) > P.shieldLayers) pip.style.opacity = 0.4 + P.shieldCharge * 0.6;
      else pip.style.opacity = 1;
    });

    const avgO2 = P.rooms.reduce((s, r) => s + r.o2, 0) / P.rooms.length;
    this.statRow.innerHTML = `EVADE <b>${evasion(P)}%</b> · O₂ <b>${Math.round(avgO2 * 100)}%</b>${G.ships.enemy ? ` · <span style="color:var(--red)">☠ ${G.ships.enemy.name} ${Math.max(0, G.ships.enemy.hull)}/${G.ships.enemy.hullMax}</span>` : ""}`;

    // ftl
    this.ftlFill.style.width = `${G.ftl * 100}%`;
    this.jumpBtn.className = `btn small${G.ftl >= 1 ? " ready" : ""}`;
    this.jumpBtn.disabled = G.ftl < 1;
    this.scrapEl.innerHTML = `⬡ <b>${G.scrap}</b>`;
    this.pauseBtn.innerHTML = G.paused ? "▶" : "⏸";
    this.pauseTag.style.display = G.paused && !G.over ? "block" : "none";

    this.netBadge.innerHTML = net || "";

    this._updateCrew(G, P);
    this._updatePower(P);
    this._updateWeapons(G, P);
    this._updateModals(G);
  }

  _updateCrew(G, P) {
    const seen = new Set();
    for (const crew of P.crew) {
      seen.add(crew.id);
      let card = this.crewCards.get(crew.id);
      if (!card) {
        const div = el("div", "crewcard", this.crewStrip);
        const dot = el("div", "crewdot", div);
        const info = el("div", "crewinfo", div);
        const name = el("div", "crewname", info);
        const spec = el("div", "crewspec", info);
        const hpbar = el("div", "crewhp", info);
        const hp = el("div", "fill", hpbar);
        div.onclick = () => {
          if (crew.dead) return;
          this.ui.selectedCrew = this.ui.selectedCrew === crew.id ? null : crew.id;
          this.sfx.play("select");
        };
        card = { div, dot, name, spec, hp };
        this.crewCards.set(crew.id, card);
      }
      card.dot.style.background = `#${crew.color.toString(16).padStart(6, "0")}`;
      card.name.textContent = crew.name;
      card.spec.textContent = `${SPECIES[crew.species].label} · ${crew.dead ? "gone" : crew.action}`;
      const hf = crew.hp / crew.hpMax;
      card.hp.style.width = `${Math.max(0, hf) * 100}%`;
      card.hp.className = `fill${hf < 0.3 ? " crit" : hf < 0.6 ? " hurt" : ""}`;
      card.div.className = `crewcard${this.ui.selectedCrew === crew.id ? " sel" : ""}${crew.dead ? " dead" : ""}`;
      crew._selected = this.ui.selectedCrew === crew.id;
    }
    for (const [id, card] of this.crewCards) {
      if (!seen.has(id)) {
        card.div.remove();
        this.crewCards.delete(id);
      }
    }
  }

  _updatePower(P) {
    const used = powerUsed(P);
    this.reactorInfo.innerHTML = `REACTOR <b>${P.reactor - used}</b>/${P.reactor} FREE`;
    for (const sysName of SYS_ORDER) {
      const sys = P.systems[sysName];
      let col = this.sysCols.get(sysName);
      if (!sys) continue;
      if (!col) {
        const div = el("div", "syscol", this.powerPanel);
        const bars = el("div", "bars", div);
        const ico = el("div", "sysico", div, SYS_INFO[sysName].icon);
        el("div", "syskey", div, SYS_INFO[sysName].label);
        div.onclick = (e) => {
          this.sfx.play("power");
          this.send({ k: "power", sys: sysName, delta: e.shiftKey ? -1 : 1 });
        };
        div.oncontextmenu = (e) => {
          e.preventDefault();
          this.sfx.play("power");
          this.send({ k: "power", sys: sysName, delta: -1 });
        };
        col = { div, bars, ico, nBars: 0 };
        this.sysCols.set(sysName, col);
      }
      if (col.nBars !== sys.lvl) {
        col.bars.innerHTML = "";
        for (let i = 0; i < sys.lvl; i++) el("div", "pbar", col.bars);
        col.nBars = sys.lvl;
      }
      const broken = Math.floor(sys.dmg);
      [...col.bars.children].forEach((bar, i) => {
        // bars render bottom-up: i=0 is the bottom bar
        const dmgFromTop = i >= sys.lvl - broken;
        bar.className = `pbar${dmgFromTop ? " dmg" : i < sys.power ? " on" : ""}`;
      });
      const manned = false; // (cosmetic; sim recomputes)
      const frac = sys.lvl ? sys.dmg / sys.lvl : 0;
      col.ico.className = `sysico${frac > 0.99 ? " broken" : frac > 0.3 ? " hurt" : manned ? " manned" : ""}`;
    }
  }

  _updateWeapons(G, P) {
    const powered = weaponPowered(P);
    while (this.weaponCards.length < P.weapons.length) {
      const wi = this.weaponCards.length;
      const div = el("div", "wcard", this.weaponPanel);
      const name = el("div", "wname", div);
      const meta = el("div", "wmeta", div);
      const chargeBar = el("div", "wcharge", div);
      const charge = el("div", "fill", chargeBar);
      const target = el("div", "wtarget", div);
      div.onclick = () => {
        const w = P.weapons[wi];
        if (!w) return;
        if (w.target) {
          this.send({ k: "wtarget", wi, room: null });
          this.ui.targetingWi = null;
          this.sfx.play("uiBack");
        } else {
          this.ui.targetingWi = this.ui.targetingWi === wi ? null : wi;
          this.sfx.play("ui");
        }
      };
      this.weaponCards.push({ div, name, meta, charge, target });
    }
    this.weaponCards.forEach((card, wi) => {
      const w = P.weapons[wi];
      if (!w) {
        card.div.style.display = "none";
        return;
      }
      card.div.style.display = "block";
      const wt = WEAPON_TYPES[w.type];
      card.name.textContent = wt.label;
      card.meta.textContent = `${wt.shots}×${wt.dmg} ${wt.kind === "missile" ? "· pierces shields" : "dmg"} · ⚡${wt.power}`;
      card.charge.style.width = `${w.charge * 100}%`;
      card.charge.className = `fill${w.charge >= 1 ? " ready" : ""}`;
      card.target.textContent = w.target ? `→ ${w.target.toUpperCase()}` : this.ui.targetingWi === wi ? "PICK A TARGET…" : "";
      card.div.className = `wcard${w.target ? " armed" : ""}${this.ui.targetingWi === wi ? " targeting" : ""}${powered[wi] ? "" : " nopower"}`;
    });
  }

  // ------------------------------------------------------------------ modals

  _updateModals(G) {
    let key = null;
    if (G.over) key = `over:${G.over.win}`;
    else if (G.event) key = `event:${G.event.id}:${G.event.resolved}:${G.event.result ?? ""}`;
    else if (G.shopStock) key = `shop:${G.shopStock.map((i) => `${i.sold ? 1 : 0}`).join("")}:${G.scrap}`;
    else if (G.mapOpen) key = `map:${G.sector.at}:${G.ftl}`;

    if (key === this._modalKey) return;
    this._modalKey = key;
    this.modalHost.innerHTML = "";
    if (!key) return;

    const wrap = el("div", "modalwrap", this.modalHost);
    const modal = el("div", "modal", wrap);

    if (G.over) {
      el("h1", null, modal, G.over.win ? "🏆 VICTORY" : "💀 GAME OVER");
      el("p", null, modal, G.over.reason);
      const btns = el("div", "choices", modal);
      const again = el("button", "btn accent", btns, "NEW RUN");
      again.onclick = () => this.onRestart();
      return;
    }

    if (G.event) {
      el("h2", null, modal, G.event.title);
      if (!G.event.resolved) {
        el("p", null, modal, G.event.text);
        const btns = el("div", "choices", modal);
        G.event.choices.forEach((c, i) => {
          const b = el("button", "btn", btns, c.label);
          b.onclick = () => {
            this.sfx.play("ui");
            this.send({ k: "evchoice", i });
          };
        });
      } else {
        el("p", null, modal, G.event.result);
        const btns = el("div", "choices", modal);
        const b = el("button", "btn accent", btns, "CONTINUE");
        b.onclick = () => {
          this.sfx.play("ui");
          this.send({ k: "evclose" });
        };
      }
      return;
    }

    if (G.shopStock) {
      el("h2", null, modal, "🛒 TRADING POST");
      el("p", null, modal, `A cheerful merchant unfolds their wares. You have <b style="color:var(--amber)">⬡ ${G.scrap}</b>.`);
      const grid = el("div", "shopgrid", modal);
      G.shopStock.forEach((item, i) => {
        const row = el("div", "shopitem", grid);
        el("div", null, row, `<div class="name">${item.label}</div><div class="desc">${item.desc}</div>`);
        const b = el("button", "btn small accent", row, item.sold ? "SOLD" : `⬡ ${item.cost}`);
        b.disabled = item.sold || G.scrap < item.cost;
        b.onclick = () => {
          this.sfx.play("scrap");
          this.send({ k: "buy", i });
        };
      });
      const btns = el("div", "choices", modal);
      const done = el("button", "btn", btns, "LEAVE");
      done.onclick = () => this.send({ k: "shopClose" });
      return;
    }

    if (G.mapOpen) {
      el("h2", null, modal, "🗺 SECTOR MAP — pick a beacon");
      const box = el("div", null, modal);
      box.id = "mapbox";
      const here = G.sector.nodes.find((n) => n.id === G.sector.at);
      const linked = new Set();
      for (const [a, b] of G.sector.edges) {
        if (a === here.id) linked.add(b);
        if (b === here.id) linked.add(a);
      }
      // edges
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      const px = (n) => 30 + n.x * 500;
      const py = (n) => 30 + n.y * 240;
      for (const [a, b] of G.sector.edges) {
        const na = G.sector.nodes.find((n) => n.id === a);
        const nb = G.sector.nodes.find((n) => n.id === b);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", px(na));
        line.setAttribute("y1", py(na));
        line.setAttribute("x2", px(nb));
        line.setAttribute("y2", py(nb));
        line.setAttribute("stroke", a === here.id || b === here.id ? "#4be0e8" : "#2b3552");
        line.setAttribute("stroke-width", "2");
        svg.appendChild(line);
      }
      box.appendChild(svg);
      const ICONS = { start: "◉", fight: "⚔", elite: "☠", event: "?", shop: "⬡", empty: "·", boss: "👑" };
      for (const n of G.sector.nodes) {
        const dot = el("div", "beacon", box, n.visited && n.id !== here.id ? "·" : ICONS[n.type] ?? "·");
        dot.style.left = `${px(n)}px`;
        dot.style.top = `${py(n)}px`;
        const reachable = linked.has(n.id) && n.col > here.col;
        if (n.id === here.id) dot.classList.add("here");
        if (n.visited) dot.classList.add("visited");
        if (n.type === "boss") dot.classList.add("exit");
        if (reachable) {
          dot.classList.add("reachable");
          dot.onclick = () => {
            this.sfx.play("jump");
            this.send({ k: "choose", node: n.id });
          };
        }
        // fog of war: only show icons for visited/reachable, ? for others
        if (!n.visited && !reachable && n.type !== "boss") dot.textContent = "·";
      }
      const btns = el("div", "choices", modal);
      const stay = el("button", "btn", btns, "NOT YET");
      stay.onclick = () => this.send({ k: "mapClose" });
    }
  }
}
