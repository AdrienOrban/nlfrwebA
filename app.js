import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);

const LAST_DECK_KEY = "nlfr_last_deck";
const REVIEW_EVERY = 5;

let me = null;          // { id, email, display_name }
let decks = [];         // listes accessibles
let deck = null;        // liste active
let words = [];         // [{ id, nl, fr, known }]
let unknownBag = [];
let knownBag = [];
let sinceReview = 0;
let current = null;     // { word, isReview }
let flipped = false;
let newDeckShared = false;

/* ===================== Utilitaires ===================== */

function toast(msg, undoFn) {
  const el = $("toast");
  el.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  el.appendChild(span);
  if (undoFn) {
    const b = document.createElement("button");
    b.className = "toast-undo";
    b.textContent = "Annuler";
    b.onclick = () => { clearTimeout(el._t); el.classList.remove("show"); undoFn(); };
    el.appendChild(b);
  }
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), undoFn ? 5000 : 1800);
}

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function slugify(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/* ===================== Connexion ===================== */

let authMode = "login";

document.querySelectorAll(".seg-btn").forEach((b) => {
  b.onclick = () => {
    authMode = b.dataset.mode;
    document.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
    $("field-name").hidden = authMode !== "signup";
    $("auth-submit").textContent = authMode === "signup" ? "Créer mon compte" : "Se connecter";
    $("auth-password").autocomplete = authMode === "signup" ? "new-password" : "current-password";
    $("auth-error").hidden = true;
  };
});

function authError(msg) {
  const el = $("auth-error");
  el.textContent = msg;
  el.hidden = false;
}

async function submitAuth() {
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const name = $("auth-name").value.trim();
  if (!email || !password) return authError("Renseignez votre e-mail et votre mot de passe.");
  if (authMode === "signup" && !name) return authError("Indiquez le prénom qui s'affichera dans l'application.");

  const btn = $("auth-submit");
  btn.disabled = true;
  btn.textContent = "Un instant…";

  let error = null;
  if (authMode === "signup") {
    const res = await sb.auth.signUp({
      email, password, options: { data: { display_name: name } }
    });
    error = res.error;
    if (!error && !res.data.session) {
      btn.disabled = false;
      btn.textContent = "Créer mon compte";
      return authError("Compte créé. Ouvrez l'e-mail de confirmation, puis revenez vous connecter.");
    }
  } else {
    const res = await sb.auth.signInWithPassword({ email, password });
    error = res.error;
  }

  btn.disabled = false;
  btn.textContent = authMode === "signup" ? "Créer mon compte" : "Se connecter";

  if (error) {
    const m = (error.message || "").toLowerCase();
    if (m.includes("invalid login")) return authError("E-mail ou mot de passe incorrect.");
    if (m.includes("already registered")) return authError("Un compte existe déjà avec cet e-mail. Connectez-vous.");
    if (m.includes("password")) return authError("Le mot de passe doit faire au moins 6 caractères.");
    return authError(error.message);
  }
  await start();
}

$("auth-submit").onclick = submitAuth;
["auth-email", "auth-password", "auth-name"].forEach((id) => {
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") submitAuth(); });
});

/* ===================== Données ===================== */

async function loadProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
  return { id: user.id, email: user.email, display_name: data?.display_name || user.email.split("@")[0] };
}

async function loadDecks() {
  const { data, error } = await sb.from("decks").select("*").order("created_at");
  if (error) { toast("Impossible de charger vos listes"); return; }
  decks = data || [];

  if (decks.length === 0) {
    // Première connexion : on crée une liste personnelle de départ.
    const { data: created } = await sb.from("decks")
      .insert({ name: "Ma liste", owner_id: me.id, is_shared: false })
      .select().single();
    if (created) decks = [created];
  }

  const last = localStorage.getItem(LAST_DECK_KEY);
  deck = decks.find((d) => d.id === last) || decks[0];
  if (deck) localStorage.setItem(LAST_DECK_KEY, deck.id);
}

async function loadWords() {
  if (!deck) { words = []; return; }
  const { data, error } = await sb.from("words")
    .select("id, nl, fr, progress(known)")
    .eq("deck_id", deck.id)
    .order("created_at");
  if (error) { toast("Impossible de charger les mots"); words = []; return; }
  words = (data || []).map((w) => ({
    id: w.id, nl: w.nl, fr: w.fr,
    known: Array.isArray(w.progress) && w.progress.length ? !!w.progress[0].known : false
  }));
  unknownBag = [];
  knownBag = [];
  sinceReview = 0;
  current = null;
}

async function setKnown(wordId, known) {
  const w = words.find((x) => x.id === wordId);
  if (w) w.known = known;
  const { error } = await sb.from("progress")
    .upsert({ user_id: me.id, word_id: wordId, known, updated_at: new Date().toISOString() },
            { onConflict: "user_id,word_id" });
  if (error) toast("Progression non enregistrée");
}

/* ===================== Moteur de cartes ===================== */

const unknownWords = () => words.filter((w) => !w.known);
const knownWords = () => words.filter((w) => w.known);

// Tire un mot dans un "sac" mélangé : on parcourt tous les mots du sac
// avant d'en refaire un nouveau, ce qui évite les répétitions proches.
// Le sac est reconstruit dès qu'il est vide, donc la boucle est infinie.
function drawFromBag(bag, pool, stillValid, excludeId) {
  if (!pool.length) return { word: null, bag };
  if (!bag.length) bag = shuffle(pool.map((w) => w.id));
  // Ne pas remontrer immédiatement la carte qu'on vient de quitter.
  if (bag.length > 1 && bag[0] === excludeId) bag.push(bag.shift());

  while (bag.length) {
    const id = bag.shift();              // shift() ici, jamais dans un prédicat
    const w = words.find((x) => x.id === id);
    if (w && stillValid(w)) return { word: w, bag };
  }
  // Le sac ne contenait plus que des mots supprimés ou dont le statut a
  // changé : on le reconstruit et on repart.
  bag = shuffle(pool.map((w) => w.id));
  const id = bag.shift();
  return { word: words.find((x) => x.id === id) || null, bag };
}

function drawUnknown(excludeId) {
  const r = drawFromBag(unknownBag, unknownWords(), (w) => !w.known, excludeId);
  unknownBag = r.bag;
  return r.word;
}

function drawKnown(excludeId) {
  const r = drawFromBag(knownBag, knownWords(), (w) => w.known, excludeId);
  knownBag = r.bag;
  return r.word;
}

function pickNext() {
  if (!words.length) return null;
  const hasUnknown = unknownWords().length > 0;
  const hasKnown = knownWords().length > 0;
  const exclude = current?.word.id;

  // Tous les mots sont connus : on continue à tourner dessus indéfiniment.
  if (!hasUnknown) {
    sinceReview = 0;
    const w = drawKnown(exclude);
    return w ? { word: w, isReview: true } : null;
  }

  // Tous les 5 mots à apprendre, une carte de révision s'intercale.
  if (sinceReview >= REVIEW_EVERY && hasKnown) {
    sinceReview = 0;
    const w = drawKnown(exclude);
    if (w) return { word: w, isReview: true };
  }

  const w = drawUnknown(exclude);
  if (w) { sinceReview++; return { word: w, isReview: false }; }

  const k = drawKnown(exclude);
  return k ? { word: k, isReview: true } : null;
}

function renderStat() {
  const n = unknownWords().length;
  $("stat-remaining").textContent = words.length ? `${n} à revoir` : "";
}

function renderCard() {
  renderStat();
  const stage = $("card-stage");
  stage.innerHTML = "";

  if (!current) {
    const e = document.createElement("div");
    e.className = "empty-state";
    e.textContent = words.length === 0
      ? "Cette liste est vide. Ajoutez des mots dans l'onglet Mots, ou importez un fichier CSV."
      : "Vous connaissez tous les mots de cette liste. Ajoutez-en de nouveaux pour continuer.";
    stage.appendChild(e);
    return;
  }

  flipped = false;
  for (const cls of ["stack-2", "stack-1"]) {
    const s = document.createElement("div");
    s.className = `flashcard stack ${cls}`;
    stage.appendChild(s);
  }

  const card = document.createElement("div");
  card.className = "flashcard current";
  card.innerHTML = `
    <div class="badge${current.isReview ? " review" : ""}">${current.isReview ? "Révision" : "À apprendre"}</div>
    <div class="word"></div>
    <div class="translation"></div>
    <div class="drag-label right">CONNU</div>
    <div class="drag-label left">PLUS TARD</div>
    <div class="drag-label up">RETIRER</div>
    <div class="hint">← plus tard · → connu · ↑ retirer de la liste · clic = retourner</div>`;
  card.querySelector(".word").textContent = current.word.nl;
  card.querySelector(".translation").textContent = current.word.fr;

  stage.appendChild(card);
  attachSwipe(card);
}

function advance() {
  current = pickNext();
  renderCard();
}

async function removeWord(id) {
  const w = words.find((x) => x.id === id);
  if (!w) return;
  const snapshot = { ...w };
  words = words.filter((x) => x.id !== id);
  renderWordList();

  const { error } = await sb.from("words").delete().eq("id", id);
  if (error) { toast("Suppression impossible"); await refreshWords(); return; }

  toast(`« ${snapshot.nl} » retiré`, async () => {
    const { data } = await sb.from("words")
      .insert({ deck_id: deck.id, nl: snapshot.nl, fr: snapshot.fr }).select().single();
    if (data) {
      words.push({ id: data.id, nl: data.nl, fr: data.fr, known: snapshot.known });
      if (snapshot.known) await setKnown(data.id, true);
      renderWordList();
      renderStat();
    }
  });
}

function flyOut(card, action) {
  const t = action === "known" ? "translate(140%, -15%) rotate(24deg)"
    : action === "skip" ? "translate(-140%, -15%) rotate(-24deg)"
    : "translate(0, -150%)";
  card.style.transition = "transform 0.3s ease, opacity 0.3s ease";
  requestAnimationFrame(() => { card.style.transform = t; card.style.opacity = "0"; });
}

async function resolve(card, action) {
  if (!current) return;
  const w = current.word;
  flyOut(card, action);

  if (action === "known") {
    await setKnown(w.id, true);
    renderWordList();
    toast(`« ${w.nl} » marqué comme connu`);
  } else if (action === "skip") {
    if (w.known) { await setKnown(w.id, false); renderWordList(); }
    toast(`« ${w.nl} » remis dans les mots à revoir`);
  } else if (action === "delete") {
    await removeWord(w.id);
  }
  setTimeout(advance, 260);
}

function attachSwipe(card) {
  let dragging = false, sx = 0, sy = 0, dx = 0, dy = 0, moved = 0;
  const H = 100, V = 90;
  const lr = card.querySelector(".drag-label.right");
  const ll = card.querySelector(".drag-label.left");
  const lu = card.querySelector(".drag-label.up");
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const labels = (r, l, u) => { lr.style.opacity = r; ll.style.opacity = l; lu.style.opacity = u; };

  card.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    dragging = true; moved = 0; sx = e.clientX; sy = e.clientY;
    card.style.transition = "none";
    try { card.setPointerCapture(e.pointerId); } catch {}
  });

  card.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    moved = Math.max(moved, Math.abs(dx), Math.abs(dy));
    const rot = Math.max(-18, Math.min(18, dx / 12));
    card.style.transform = `translate(${dx}px,${dy}px) rotate(${rot}deg)`;
    if (Math.abs(dx) > Math.abs(dy)) {
      labels(dx > 0 ? clamp(dx / H) : 0, dx < 0 ? clamp(-dx / H) : 0, 0);
    } else {
      labels(0, 0, dy < 0 ? clamp(-dy / V) : 0);
    }
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (moved < 8) {
      flipped = !flipped;
      card.classList.toggle("flipped", flipped);
    } else if (Math.abs(dx) > Math.abs(dy) && dx > H) { resolve(card, "known"); return; }
    else if (Math.abs(dx) > Math.abs(dy) && dx < -H) { resolve(card, "skip"); return; }
    else if (Math.abs(dy) >= Math.abs(dx) && dy < -V) { resolve(card, "delete"); return; }
    card.style.transition = "transform 0.25s ease";
    card.style.transform = "";
    labels(0, 0, 0);
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

function buttonAction(action) {
  const card = $("card-stage").querySelector(".flashcard.current");
  if (card && current) resolve(card, action);
}
$("btn-skip").onclick = () => buttonAction("skip");
$("btn-know").onclick = () => buttonAction("known");
$("btn-delete").onclick = () => buttonAction("delete");

/* ===================== Onglet Mots ===================== */

function renderWordList() {
  const q = $("search").value.trim().toLowerCase();
  const list = $("word-list");
  list.innerHTML = "";

  const shown = words.filter((w) =>
    !q || w.nl.toLowerCase().includes(q) || w.fr.toLowerCase().includes(q));

  if (!shown.length) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = words.length
      ? "Aucun mot ne correspond à cette recherche."
      : "Aucun mot dans cette liste. Ajoutez-en un ci-dessus ou importez un fichier CSV.";
    list.appendChild(p);
  }

  for (const w of shown) {
    const row = document.createElement("div");
    row.className = "row-item";

    const dot = document.createElement("span");
    dot.className = `dot ${w.known ? "known" : "unknown"}`;
    row.appendChild(dot);

    const txt = document.createElement("div");
    txt.className = "txt";
    const t1 = document.createElement("div"); t1.className = "t1"; t1.textContent = w.nl;
    const t2 = document.createElement("div"); t2.className = "t2"; t2.textContent = w.fr;
    txt.append(t1, t2);
    txt.onclick = () => editWord(row, txt, w);
    row.appendChild(txt);

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.title = "Retirer de la liste";
    del.onclick = () => removeWord(w.id);
    row.appendChild(del);

    list.appendChild(row);
  }

  $("count-total").textContent = `${words.length} mot${words.length > 1 ? "s" : ""}`;
  $("count-known").textContent = `${knownWords().length} connu${knownWords().length > 1 ? "s" : ""}`;
  renderStat();
}

function editWord(row, txt, w) {
  if (row.classList.contains("editing")) return;
  row.classList.add("editing");
  txt.innerHTML = "";

  const a = document.createElement("input"); a.className = "edit-input"; a.value = w.nl;
  const b = document.createElement("input"); b.className = "edit-input"; b.value = w.fr;
  txt.append(a, b);
  a.focus(); a.select();

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const nl = a.value.trim(), fr = b.value.trim();
    if (nl && fr && (nl !== w.nl || fr !== w.fr)) {
      const { error } = await sb.from("words").update({ nl, fr }).eq("id", w.id);
      if (error) toast("Modification non enregistrée");
      else { w.nl = nl; w.fr = fr; }
    }
    renderWordList();
  };
  const cancel = () => { if (!done) { done = true; renderWordList(); } };

  a.onkeydown = (e) => { if (e.key === "Enter") b.focus(); if (e.key === "Escape") cancel(); };
  b.onkeydown = (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); };
  a.onblur = () => setTimeout(() => { if (document.activeElement !== b) commit(); }, 120);
  b.onblur = () => setTimeout(commit, 120);
}

$("search").oninput = renderWordList;

$("btn-reset-progress").onclick = async () => {
  const marked = knownWords();
  if (!marked.length) return toast("Aucun mot n'est marqué comme connu");
  if (!confirm(`Remettre les ${marked.length} mots connus de « ${deck.name} » dans les mots à revoir ? Cela ne change rien pour les autres membres.`)) return;

  const { error } = await sb.from("progress")
    .upsert(marked.map((w) => ({ user_id: me.id, word_id: w.id, known: false })),
            { onConflict: "user_id,word_id" });
  if (error) return toast("Remise à zéro impossible");

  marked.forEach((w) => { w.known = false; });
  unknownBag = []; knownBag = []; sinceReview = 0;
  renderWordList();
  advance();
  toast("Tous les mots sont de nouveau à revoir");
};

$("btn-add").onclick = async () => {
  const nlEl = $("new-nl"), frEl = $("new-fr");
  const nl = nlEl.value.trim(), fr = frEl.value.trim();
  if (!nl || !fr) return toast("Remplissez les deux champs");
  const { data, error } = await sb.from("words")
    .insert({ deck_id: deck.id, nl, fr }).select().single();
  if (error) return toast("Ajout impossible");
  words.push({ id: data.id, nl: data.nl, fr: data.fr, known: false });
  nlEl.value = ""; frEl.value = ""; nlEl.focus();
  renderWordList();
  if (!current) advance();
};
[$("new-nl"), $("new-fr")].forEach((el) =>
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-add").click(); }));

/* ---------- CSV ---------- */

function splitLine(line, d) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCSV(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim());
  if (!lines.length) return [];
  const d = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const head = splitLine(lines[0], d).map((h) => h.trim().toLowerCase());
  const hasHead = head.includes("nl") && head.includes("fr");
  const iNl = hasHead ? head.indexOf("nl") : 0;
  const iFr = hasHead ? head.indexOf("fr") : 1;
  const iKn = hasHead ? head.indexOf("known") : 2;

  const rows = [];
  for (let i = hasHead ? 1 : 0; i < lines.length; i++) {
    const c = splitLine(lines[i], d);
    const nl = (c[iNl] || "").trim(), fr = (c[iFr] || "").trim();
    if (!nl || !fr) continue;
    const k = (iKn > -1 ? c[iKn] || "" : "").trim().toLowerCase();
    rows.push({ nl, fr, known: ["1", "true", "vrai", "oui"].includes(k) });
  }
  return rows;
}

function csvEscape(v) { return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

$("btn-export").onclick = () => {
  const csv = ["nl,fr,known", ...words.map((w) =>
    [csvEscape(w.nl), csvEscape(w.fr), w.known ? "1" : "0"].join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(deck.name) || "mots"}-${slugify(me.display_name)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Fichier téléchargé");
};

$("btn-import").onclick = () => $("file-input").click();

$("file-input").onchange = async () => {
  const file = $("file-input").files[0];
  if (!file) return;
  const text = await file.text();
  $("file-input").value = "";

  const rows = parseCSV(text);
  if (!rows.length) return toast("Aucun mot lisible dans ce fichier");

  const existing = new Map(words.map((w) => [`${w.nl.toLowerCase()}|${w.fr.toLowerCase()}`, w]));
  const toInsert = [], toMark = [];

  for (const r of rows) {
    const key = `${r.nl.toLowerCase()}|${r.fr.toLowerCase()}`;
    const found = existing.get(key);
    if (found) { if (r.known && !found.known) toMark.push(found.id); }
    else { toInsert.push({ deck_id: deck.id, nl: r.nl, fr: r.fr, _known: r.known }); }
  }

  if (toInsert.length) {
    const { data, error } = await sb.from("words")
      .insert(toInsert.map(({ _known, ...w }) => w)).select();
    if (error) return toast("Import impossible");
    data.forEach((row, i) => {
      words.push({ id: row.id, nl: row.nl, fr: row.fr, known: false });
      if (toInsert[i]._known) toMark.push(row.id);
    });
  }

  if (toMark.length) {
    await sb.from("progress").upsert(
      toMark.map((id) => ({ user_id: me.id, word_id: id, known: true })),
      { onConflict: "user_id,word_id" });
    toMark.forEach((id) => { const w = words.find((x) => x.id === id); if (w) w.known = true; });
  }

  renderWordList();
  if (!current) advance();
  toast(`${toInsert.length} mot(s) ajouté(s)`);
};

/* ===================== Onglet Listes ===================== */

function renderDeckList() {
  const list = $("deck-list");
  list.innerHTML = "";

  for (const d of decks) {
    const row = document.createElement("div");
    row.className = "row-item" + (deck && d.id === deck.id ? " selected" : "");

    const txt = document.createElement("div");
    txt.className = "txt";
    const t1 = document.createElement("div"); t1.className = "t1"; t1.textContent = d.name;
    const t2 = document.createElement("div"); t2.className = "t2";
    t2.textContent = d.owner_id === me.id ? "Vous en êtes propriétaire" : "Partagée avec vous";
    txt.append(t1, t2);
    txt.onclick = () => switchDeck(d.id);
    row.appendChild(txt);

    const tag = document.createElement("span");
    tag.className = `tag ${d.is_shared ? "shared" : "solo"}`;
    tag.textContent = d.is_shared ? "Commune" : "Perso";
    row.appendChild(tag);

    const cog = document.createElement("button");
    cog.className = "del";
    cog.style.color = "rgba(242,239,230,0.6)";
    cog.textContent = "⋯";
    cog.title = "Gérer cette liste";
    cog.onclick = (e) => { e.stopPropagation(); openDeckSheet(d); };
    row.appendChild(cog);

    list.appendChild(row);
  }
}

document.querySelectorAll("#deck-kind .choice-btn").forEach((b) => {
  b.onclick = () => {
    newDeckShared = b.dataset.shared === "true";
    document.querySelectorAll("#deck-kind .choice-btn")
      .forEach((x) => x.classList.toggle("active", x === b));
  };
});

$("btn-create-deck").onclick = async () => {
  const name = $("new-deck-name").value.trim();
  if (!name) return toast("Donnez un nom à la liste");
  const { data, error } = await sb.from("decks")
    .insert({ name, owner_id: me.id, is_shared: newDeckShared }).select().single();
  if (error) return toast("Création impossible");
  decks.push(data);
  $("new-deck-name").value = "";
  renderDeckList();
  await switchDeck(data.id);
  toast(`Liste « ${name} » créée`);
  if (newDeckShared) openDeckSheet(data);
};

async function switchDeck(id) {
  const d = decks.find((x) => x.id === id);
  if (!d) return;
  deck = d;
  localStorage.setItem(LAST_DECK_KEY, d.id);
  renderDeckHeader();
  renderDeckList();
  await loadWords();
  renderWordList();
  advance();
}

function renderDeckHeader() {
  $("deck-name").textContent = deck ? deck.name : "—";
  $("deck-meta").textContent = deck
    ? (deck.is_shared ? "Liste commune" : "Liste personnelle") : "";
}

$("deck-picker").onclick = () => showScreen("screen-decks");

async function refreshWords() {
  await loadWords();
  renderWordList();
  advance();
}

/* ---------- Fenêtre de gestion d'une liste ---------- */

function openSheet(title) {
  $("sheet-title").textContent = title;
  $("sheet-body").innerHTML = "";
  $("sheet").hidden = false;
  return $("sheet-body");
}
function closeSheet() { $("sheet").hidden = true; }
$("sheet-close").onclick = closeSheet;
$("sheet").onclick = (e) => { if (e.target === $("sheet")) closeSheet(); };

async function openDeckSheet(d) {
  const body = openSheet(d.name);
  const isOwner = d.owner_id === me.id;

  if (isOwner) {
    const label = document.createElement("p");
    label.className = "sheet-section";
    label.textContent = "Nom de la liste";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = d.name;
    const save = document.createElement("button");
    save.className = "btn btn-primary btn-block";
    save.textContent = "Enregistrer le nom";
    save.onclick = async () => {
      const n = nameInput.value.trim();
      if (!n) return;
      const { error } = await sb.from("decks").update({ name: n }).eq("id", d.id);
      if (error) return toast("Renommage impossible");
      d.name = n;
      renderDeckList(); renderDeckHeader(); closeSheet();
      toast("Nom mis à jour");
    };
    body.append(label, nameInput, save);
  }

  const memTitle = document.createElement("p");
  memTitle.className = "sheet-section";
  memTitle.textContent = "Personnes ayant accès";
  body.appendChild(memTitle);

  const memBox = document.createElement("div");
  memBox.style.display = "flex";
  memBox.style.flexDirection = "column";
  memBox.style.gap = "6px";
  body.appendChild(memBox);

  async function loadMembers() {
    memBox.innerHTML = "";
    const { data, error } = await sb.rpc("list_deck_members", { d: d.id });
    if (error) { memBox.textContent = "Liste des membres indisponible."; return; }
    for (const m of data || []) {
      const row = document.createElement("div");
      row.className = "row-item";
      const t = document.createElement("div");
      t.className = "txt";
      const a = document.createElement("div"); a.className = "t1";
      a.textContent = m.display_name + (m.user_id === me.id ? " (vous)" : "");
      const b = document.createElement("div"); b.className = "t2";
      b.textContent = m.role === "owner" ? "Propriétaire" : m.email;
      t.append(a, b);
      row.appendChild(t);
      if (isOwner && m.role !== "owner") {
        const x = document.createElement("button");
        x.className = "del"; x.textContent = "✕"; x.title = "Retirer l'accès";
        x.onclick = async () => {
          await sb.from("deck_members").delete().eq("deck_id", d.id).eq("user_id", m.user_id);
          loadMembers();
          toast("Accès retiré");
        };
        row.appendChild(x);
      }
      memBox.appendChild(row);
    }
  }
  await loadMembers();

  if (isOwner) {
    const addTitle = document.createElement("p");
    addTitle.className = "sheet-section";
    addTitle.textContent = "Inviter quelqu'un par e-mail";
    const mail = document.createElement("input");
    mail.type = "email";
    mail.placeholder = "adresse@exemple.be";
    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-primary btn-block";
    addBtn.textContent = "Donner accès";
    addBtn.onclick = async () => {
      const email = mail.value.trim();
      if (!email) return;
      addBtn.disabled = true;
      const { data, error } = await sb.rpc("add_member_by_email", { d: d.id, member_email: email });
      addBtn.disabled = false;
      if (error) return toast("Invitation impossible");
      if (data === "no_account") return toast("Aucun compte avec cet e-mail : demandez-lui de s'inscrire d'abord");
      if (data === "not_owner") return toast("Seul le propriétaire peut inviter");
      mail.value = "";
      d.is_shared = true;
      renderDeckList(); renderDeckHeader();
      await loadMembers();
      toast("Accès accordé");
    };
    mail.onkeydown = (e) => { if (e.key === "Enter") addBtn.click(); };
    body.append(addTitle, mail, addBtn);
  }

  const sep = document.createElement("p");
  sep.className = "sheet-section";
  sep.textContent = "Zone sensible";
  body.appendChild(sep);

  const dangerBtn = document.createElement("button");
  dangerBtn.className = "btn btn-block";
  dangerBtn.style.background = "transparent";
  dangerBtn.style.border = "1px solid var(--red)";
  dangerBtn.style.color = "var(--red)";
  dangerBtn.textContent = isOwner ? "Supprimer cette liste" : "Quitter cette liste";
  dangerBtn.onclick = async () => {
    if (decks.length === 1) return toast("Gardez au moins une liste");
    const msg = isOwner
      ? `Supprimer « ${d.name} » et tous ses mots, pour toutes les personnes qui y ont accès ?`
      : `Quitter « ${d.name} » ? Vous n'y aurez plus accès.`;
    if (!confirm(msg)) return;
    const { error } = isOwner
      ? await sb.from("decks").delete().eq("id", d.id)
      : await sb.from("deck_members").delete().eq("deck_id", d.id).eq("user_id", me.id);
    if (error) return toast("Opération impossible");
    decks = decks.filter((x) => x.id !== d.id);
    closeSheet();
    renderDeckList();
    if (deck.id === d.id) await switchDeck(decks[0].id);
    toast(isOwner ? "Liste supprimée" : "Vous avez quitté la liste");
  };
  body.appendChild(dangerBtn);
}

/* ===================== Compte ===================== */

$("btn-account").onclick = () => {
  const body = openSheet("Mon compte");

  const l1 = document.createElement("p");
  l1.className = "sheet-section";
  l1.textContent = `Connecté avec ${me.email}`;
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = me.display_name;
  const save = document.createElement("button");
  save.className = "btn btn-primary btn-block";
  save.textContent = "Enregistrer le prénom";
  save.onclick = async () => {
    const n = nameInput.value.trim();
    if (!n) return;
    const { error } = await sb.from("profiles").update({ display_name: n }).eq("id", me.id);
    if (error) return toast("Enregistrement impossible");
    me.display_name = n;
    $("btn-account").textContent = initials(n);
    closeSheet();
    toast("Prénom mis à jour");
  };

  const out = document.createElement("button");
  out.className = "btn btn-block";
  out.style.background = "transparent";
  out.style.border = "1px solid var(--line-light)";
  out.style.color = "var(--paper)";
  out.style.marginTop = "10px";
  out.textContent = "Se déconnecter";
  out.onclick = async () => { await sb.auth.signOut(); location.reload(); };

  body.append(l1, nameInput, save, out);
};

/* ===================== Navigation ===================== */

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  document.querySelectorAll("nav.tabs button")
    .forEach((b) => b.classList.toggle("active", b.dataset.screen === id));
  if (id === "screen-words") renderWordList();
  if (id === "screen-decks") renderDeckList();
}
document.querySelectorAll("nav.tabs button")
  .forEach((b) => { b.onclick = () => showScreen(b.dataset.screen); });

/* ===================== Démarrage ===================== */

async function start() {
  me = await loadProfile();
  if (!me) { $("auth").hidden = false; $("boot").hidden = true; return; }

  $("auth").hidden = true;
  $("boot").hidden = true;
  $("app").hidden = false;
  $("btn-account").textContent = initials(me.display_name);

  await loadDecks();
  renderDeckHeader();
  renderDeckList();
  await loadWords();
  renderWordList();
  advance();
}

if (SUPABASE_URL.includes("VOTRE-PROJET")) {
  $("boot").innerHTML =
    "Configuration incomplète : ouvrez <code>config.js</code> et renseignez l'adresse et la clé publique de votre projet Supabase.";
  $("boot").style.padding = "24px";
  $("boot").style.textAlign = "center";
} else {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await start();
  else { $("boot").hidden = true; $("auth").hidden = false; }
}
