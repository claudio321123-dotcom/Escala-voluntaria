import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously, GoogleAuthProvider,
  signInWithPopup, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, collectionGroup, doc, onSnapshot, query, where,
  orderBy, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, LEADER_EMAILS } from "./firebase-config.js";

/* ---------- Funções da transmissão ---------- */
const ROLES = [
  { id: "camera", name: "Câmeras", def: 3 },
  { id: "mesa", name: "Mesa de corte", def: 1 },
  { id: "audio", name: "Áudio", def: 1 },
  { id: "live", name: "Streaming (live)", def: 1 },
  { id: "projecao", name: "Projeção", def: 1 },
  { id: "legendas", name: "Legendas", def: 1 },
];

const PRESETS = [
  { on: true, day: 0, time: "09:00", title: "Culto da Manhã" },
  { on: true, day: 0, time: "19:00", title: "Culto da Noite" },
  { on: false, day: 3, time: "19:30", title: "Culto de Quarta" },
];
const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/* ---------- Utilidades ---------- */
const $ = (s) => document.querySelector(s);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}
const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const longDate = (s) => parseDate(s).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
const shortDate = (s) => parseDate(s).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
const todayIso = () => isoDate(new Date());

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};

const dlg = $("#dlg");
function openDialog(...content) {
  dlg.replaceChildren(...content);
  if (!dlg.open) dlg.showModal();
}
const closeDialog = () => dlg.open && dlg.close();
dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDialog(); });

/* ---------- Firebase ---------- */
const configured = !String(firebaseConfig.apiKey).startsWith("COLE");
if (!configured) {
  $("#main").replaceChildren(h("div", { class: "banner" },
    h("h2", {}, "Falta conectar o Firebase"),
    h("p", {}, "Cole a configuração do seu projeto em ", h("code", {}, "firebase-config.js"),
      " e publique as regras de ", h("code", {}, "firestore.rules"), ". O passo a passo está no README.")));
  throw new Error("Firebase não configurado");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  user: null,
  events: [],
  assigns: new Map(), // eventId -> [{id, roleId, name, status, uid}]
  phones: new Map(), // assignmentId -> telefone (só líder)
  loaded: false,
};
const isLeader = () =>
  !!state.user && !state.user.isAnonymous &&
  LEADER_EMAILS.map((e) => e.toLowerCase()).includes((state.user.email || "").toLowerCase());

/* ---------- Dados em tempo real ---------- */
onSnapshot(
  query(collection(db, "events"), where("date", ">=", todayIso()), orderBy("date")),
  (snap) => {
    state.events = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    state.loaded = true;
    render();
  },
  (err) => { console.error(err); $("#main").replaceChildren(h("p", { class: "muted" }, "Não foi possível carregar os cultos. Verifique as regras do Firestore.")); },
);

onSnapshot(collectionGroup(db, "assignments"), (snap) => {
  const map = new Map();
  for (const d of snap.docs) {
    const eventId = d.ref.parent.parent.id;
    if (!map.has(eventId)) map.set(eventId, []);
    map.get(eventId).push({ id: d.id, ...d.data() });
  }
  state.assigns = map;
  render();
}, console.error);

let stopPhones = null;
function watchPhones() {
  if (stopPhones) { stopPhones(); stopPhones = null; }
  state.phones = new Map();
  if (!isLeader()) return;
  stopPhones = onSnapshot(collectionGroup(db, "contacts"), (snap) => {
    state.phones = new Map(snap.docs.map((d) => [d.id, d.data().phone || ""]));
    render();
  }, console.error);
}

onAuthStateChanged(auth, (user) => {
  if (!user) { signInAnonymously(auth).catch(console.error); return; }
  state.user = user;
  watchPhones();
  render();
});

/* ---------- Ações ---------- */
async function leaderLogin() {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { if (e.code !== "auth/popup-closed-by-user") toast("Não foi possível entrar."); }
}
async function leaderLogout() { await signOut(auth); }

const newId = () => doc(collection(db, "events")).id;
const asgRef = (eventId, id) => doc(db, "events", eventId, "assignments", id);
const conRef = (eventId, id) => doc(db, "events", eventId, "contacts", id);

async function addAssignment(ev, roleId, name, phone, asLeader) {
  const id = newId();
  const batch = writeBatch(db);
  batch.set(asgRef(ev.id, id), {
    roleId, name: name.trim(),
    uid: asLeader ? "leader" : state.user.uid,
    status: asLeader ? "confirmed" : "pending",
    createdAt: serverTimestamp(),
  });
  batch.set(conRef(ev.id, id), { phone: phone.trim(), uid: asLeader ? "leader" : state.user.uid });
  await batch.commit();
}
async function removeAssignment(ev, id) {
  const batch = writeBatch(db);
  batch.delete(asgRef(ev.id, id));
  batch.delete(conRef(ev.id, id));
  await batch.commit();
}
async function approve(ev, id) {
  const batch = writeBatch(db);
  batch.update(asgRef(ev.id, id), { status: "confirmed" });
  await batch.commit();
}

/* ---------- Helpers de escala ---------- */
const slotCount = (ev, roleId) => {
  const n = ev.slots && ev.slots[roleId];
  return Number.isInteger(n) ? n : ROLES.find((r) => r.id === roleId).def;
};
const assignsOf = (ev) => state.assigns.get(ev.id) || [];

function shareText(ev) {
  const lines = [`*${ev.title}*`, `${shortDate(ev.date)} às ${ev.time}`, ""];
  for (const r of ROLES) {
    if (slotCount(ev, r.id) === 0) continue;
    const names = assignsOf(ev).filter((a) => a.roleId === r.id && a.status === "confirmed").map((a) => a.name);
    lines.push(`${r.name}: ${names.length ? names.join(", ") : "(vaga aberta)"}`);
  }
  return lines.join("\n");
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Escala copiada. Cole no WhatsApp."); }
  catch {
    const ta = h("textarea", { rows: 8 }, text);
    openDialog(h("h3", {}, "Copie a escala"), ta, h("div", { class: "dlg-actions" }, h("button", { onclick: closeDialog }, "Fechar")));
    ta.select();
  }
}

/* ---------- Diálogos ---------- */
function field(label, input, id) {
  input.id = id;
  return h("div", { class: "field" }, h("label", { for: id }, label), input);
}

function signupDialog(ev, role, asLeader) {
  const name = h("input", { type: "text", autocomplete: "name", maxlength: 60, required: true, value: asLeader ? "" : store.get("nome") });
  const phone = h("input", { type: "tel", autocomplete: "tel", maxlength: 25, placeholder: "(11) 90000-0000", value: asLeader ? "" : store.get("fone") });
  const known = [...new Set([...state.assigns.values()].flat().map((a) => a.name))].sort();
  if (asLeader) {
    name.setAttribute("list", "nomes");
  }
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      if (name.value.trim().length < 2) return;
      const btn = form.querySelector(".primary"); btn.disabled = true;
      try {
        await addAssignment(ev, role.id, name.value, phone.value, asLeader);
        if (!asLeader) { store.set("nome", name.value.trim()); store.set("fone", phone.value.trim()); }
        toast(asLeader ? "Pessoa adicionada." : "Inscrição enviada. O líder vai confirmar.");
        closeDialog();
      } catch (err) { console.error(err); toast("Não foi possível salvar."); btn.disabled = false; }
    },
  },
    h("h3", {}, asLeader ? `Adicionar em ${role.name}` : `Quero servir em ${role.name}`),
    h("p", { class: "muted" }, `${ev.title} · ${shortDate(ev.date)} às ${ev.time}`),
    field("Nome", name, "f-nome"),
    asLeader ? h("datalist", { id: "nomes" }, known.map((n) => h("option", { value: n }))) : null,
    field(asLeader ? "Telefone (opcional)" : "Telefone/WhatsApp (só o líder vê)", phone, "f-fone"),
    h("div", { class: "dlg-actions" },
      h("button", { type: "button", onclick: closeDialog }, "Cancelar"),
      h("button", { class: "primary", type: "submit" }, asLeader ? "Adicionar" : "Enviar inscrição")),
  );
  openDialog(form);
  name.focus();
}

function personDialog(ev, a) {
  const role = ROLES.find((r) => r.id === a.roleId);
  const mine = state.user && a.uid === state.user.uid;
  const leader = isLeader();
  const act = async (fn, msg) => {
    try { await fn(); toast(msg); closeDialog(); } catch (e) { console.error(e); toast("Não foi possível concluir."); }
  };
  openDialog(
    h("h3", {}, a.name),
    h("p", { class: "muted" }, `${role.name} · ${ev.title} · ${shortDate(ev.date)} às ${ev.time}`),
    h("p", {}, a.status === "confirmed" ? "Confirmado" : "Aguardando confirmação do líder"),
    leader && state.phones.get(a.id) ? h("p", {}, "Telefone: ", h("strong", {}, state.phones.get(a.id))) : null,
    h("div", { class: "dlg-actions" },
      h("button", { onclick: closeDialog }, "Fechar"),
      leader && a.status === "pending" ? h("button", { class: "primary", onclick: () => act(() => approve(ev, a.id), "Confirmado.") }, "Confirmar") : null,
      leader || mine ? h("button", { class: "danger", onclick: () => act(() => removeAssignment(ev, a.id), "Removido.") }, leader ? "Remover" : "Cancelar minha inscrição") : null,
    ),
  );
}

function eventDialog(ev) {
  const editing = !!ev;
  const title = h("input", { type: "text", maxlength: 80, required: true, value: ev?.title || "" });
  const date = h("input", { type: "date", required: true, value: ev?.date || todayIso() });
  const time = h("input", { type: "time", required: true, value: ev?.time || "19:00" });
  const notes = h("textarea", { rows: 2, maxlength: 300 }, ev?.notes || "");
  const counts = ROLES.map((r) => h("input", { type: "number", min: 0, max: 10, value: ev ? slotCount(ev, r.id) : r.def, "data-role": r.id }));
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      const slots = {};
      counts.forEach((c) => { slots[c.dataset.role] = Math.max(0, Math.min(10, parseInt(c.value, 10) || 0)); });
      const id = ev?.id || `${date.value}-${time.value.replace(":", "")}`;
      const batch = writeBatch(db);
      batch.set(doc(db, "events", id), { title: title.value.trim(), date: date.value, time: time.value, notes: notes.value.trim(), slots });
      try { await batch.commit(); toast("Culto salvo."); closeDialog(); } catch (err) { console.error(err); toast("Não foi possível salvar."); }
    },
  },
    h("h3", {}, editing ? "Editar culto" : "Novo culto"),
    field("Nome do culto", title, "e-title"),
    h("div", { class: "row" }, field("Data", date, "e-date"), field("Hora", time, "e-time")),
    field("Observações (opcional)", notes, "e-notes"),
    h("h2", {}, "Vagas por função"),
    h("div", { class: "counts" }, ROLES.flatMap((r, i) => [h("label", { for: `c-${r.id}` }, r.name), (counts[i].id = `c-${r.id}`, counts[i])])),
    h("div", { class: "dlg-actions" },
      editing ? h("button", { type: "button", class: "danger", onclick: () => confirmDelete(ev) }, "Excluir culto") : null,
      h("button", { type: "button", onclick: closeDialog }, "Cancelar"),
      h("button", { class: "primary", type: "submit" }, "Salvar")),
  );
  openDialog(form);
}

function confirmDelete(ev) {
  openDialog(
    h("h3", {}, "Excluir este culto?"),
    h("p", {}, `${ev.title} em ${shortDate(ev.date)} e todas as inscrições serão apagados.`),
    h("div", { class: "dlg-actions" },
      h("button", { onclick: closeDialog }, "Voltar"),
      h("button", { class: "danger", onclick: async () => {
        const batch = writeBatch(db);
        for (const a of assignsOf(ev)) { batch.delete(asgRef(ev.id, a.id)); batch.delete(conRef(ev.id, a.id)); }
        batch.delete(doc(db, "events", ev.id));
        try { await batch.commit(); toast("Culto excluído."); closeDialog(); } catch (e) { console.error(e); toast("Não foi possível excluir."); }
      } }, "Excluir")),
  );
}

function generatorDialog() {
  const rows = PRESETS.map((p) => ({
    on: h("input", { type: "checkbox", checked: p.on, "aria-label": "Incluir" }),
    day: h("select", {}, DAYS.map((d, i) => h("option", { value: i, selected: i === p.day }, d))),
    time: h("input", { type: "time", value: p.time }),
    title: h("input", { type: "text", value: p.title, maxlength: 80 }),
  }));
  const weeks = h("input", { type: "number", min: 1, max: 12, value: 4 });
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      const batch = writeBatch(db);
      const start = new Date(); start.setHours(0, 0, 0, 0);
      let n = 0;
      for (let i = 0; i < (parseInt(weeks.value, 10) || 1) * 7; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        for (const r of rows) {
          if (!r.on.checked || +r.day.value !== d.getDay() || !r.title.value.trim()) continue;
          const date = isoDate(d);
          batch.set(doc(db, "events", `${date}-${r.time.value.replace(":", "")}`),
            { title: r.title.value.trim(), date, time: r.time.value }, { merge: true });
          n++;
        }
      }
      if (!n) { toast("Nenhum culto para criar."); return; }
      try { await batch.commit(); toast(`${n} cultos criados.`); closeDialog(); } catch (err) { console.error(err); toast("Não foi possível criar."); }
    },
  },
    h("h3", {}, "Gerar cultos da rotina"),
    h("p", { class: "muted" }, "Cria os cultos fixos das próximas semanas. Cultos que já existem não são duplicados."),
    rows.map((r) => h("div", { class: "preset" }, r.on, r.day, r.time, h("div", { style: "grid-column:1/-1" }, r.title))),
    field("Quantas semanas à frente", weeks, "g-weeks"),
    h("div", { class: "dlg-actions" },
      h("button", { type: "button", onclick: closeDialog }, "Cancelar"),
      h("button", { class: "primary", type: "submit" }, "Gerar")),
  );
  openDialog(form);
}

/* ---------- Tela ---------- */
function renderActions() {
  const box = $("#actions");
  const leader = isLeader();
  $("#who").textContent = leader ? "Modo líder: você pode montar a escala" : "Escolha uma função e se inscreva";
  box.replaceChildren(
    leader ? h("button", { class: "primary", onclick: () => eventDialog(null) }, "+ Novo culto") : null,
    leader ? h("button", { onclick: generatorDialog }, "Gerar rotina") : null,
    leader ? h("button", { onclick: leaderLogout }, "Sair") : h("button", { onclick: leaderLogin }, "Sou líder"),
  );
}

function renderRole(ev, r) {
  const total = slotCount(ev, r.id);
  if (total === 0) return null;
  const list = assignsOf(ev).filter((a) => a.roleId === r.id);
  const confirmed = list.filter((a) => a.status === "confirmed").length;
  const open = Math.max(0, total - confirmed);
  const leader = isLeader();
  const already = state.user && list.some((a) => a.uid === state.user.uid);

  const chips = list
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "confirmed" ? -1 : 1))
    .map((a) => h("button", {
      class: `chip ${a.status === "pending" ? "pending" : ""} ${state.user && a.uid === state.user.uid ? "mine" : ""}`,
      title: a.status === "pending" ? "Aguardando confirmação" : "Confirmado",
      onclick: () => personDialog(ev, a),
    }, a.status === "pending" ? `${a.name} (pendente)` : a.name));

  let slot;
  if (leader && open > 0) slot = h("button", { class: "chip slot", onclick: () => signupDialog(ev, r, true) }, `+ Adicionar (${open} ${open > 1 ? "vagas" : "vaga"})`);
  else if (leader) slot = h("span", { class: "muted" }, "completo");
  else if (open > 0 && !already) slot = h("button", { class: "chip slot", onclick: () => signupDialog(ev, r, false) }, `Quero servir (${open} ${open > 1 ? "vagas" : "vaga"})`);
  else if (open === 0) slot = h("span", { class: "muted" }, "completo");

  return h("div", { class: "role" }, h("div", { class: "role-name" }, r.name), h("div", { class: "chips" }, chips, slot));
}

function renderEvent(ev) {
  const leader = isLeader();
  const list = assignsOf(ev);
  const pending = list.filter((a) => a.status === "pending").length;
  const need = ROLES.reduce((s, r) => s + slotCount(ev, r.id), 0);
  const have = ROLES.reduce((s, r) => s + Math.min(slotCount(ev, r.id), list.filter((a) => a.roleId === r.id && a.status === "confirmed").length), 0);
  return h("article", { class: "card" },
    h("div", { class: "card-head" },
      h("div", {}, h("h2", {}, ev.title), h("span", { class: "muted" }, `${ev.time} · ${have}/${need} vagas preenchidas`)),
      h("div", { class: "actions" },
        leader && pending ? h("span", { class: "badge" }, `${pending} pendente${pending > 1 ? "s" : ""}`) : null,
        have === need ? h("span", { class: "badge ok" }, "Equipe completa") : null,
        h("button", { class: "small", onclick: () => copy(shareText(ev)) }, "Copiar escala"),
        leader ? h("button", { class: "small", onclick: () => eventDialog(ev) }, "Editar") : null)),
    ev.notes ? h("p", { class: "notes" }, ev.notes) : null,
    ROLES.map((r) => renderRole(ev, r)),
  );
}

function render() {
  renderActions();
  if (!state.loaded) return;
  const main = $("#main");
  if (!state.events.length) {
    main.replaceChildren(h("div", { class: "empty" },
      h("h2", {}, "Nenhum culto marcado"),
      h("p", { class: "muted" }, isLeader()
        ? "Use “Gerar rotina” para criar os cultos das próximas semanas ou “Novo culto” para um evento avulso."
        : "Assim que o líder criar os cultos, eles aparecem aqui para você escolher sua função.")));
    return;
  }
  const out = [];
  let last = "";
  for (const ev of state.events) {
    if (ev.date !== last) { out.push(h("div", { class: "day" }, longDate(ev.date))); last = ev.date; }
    out.push(renderEvent(ev));
  }
  main.replaceChildren(...out);
}
