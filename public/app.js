const loginView = document.querySelector("#loginView");
const appView = document.querySelector("#appView");
const loginForm = document.querySelector("#loginForm");
const readingForm = document.querySelector("#readingForm");
const userForm = document.querySelector("#userForm");
const loginMessage = document.querySelector("#loginMessage");
const readingMessage = document.querySelector("#readingMessage");
const userMessage = document.querySelector("#userMessage");
const readingsList = document.querySelector("#readingsList");
const usersList = document.querySelector("#usersList");
const logoutButton = document.querySelector("#logoutButton");
const accountEmail = document.querySelector("#accountEmail");
const averageValue = document.querySelector("#averageValue");
const latestValue = document.querySelector("#latestValue");
const countValue = document.querySelector("#countValue");
const readingsTab = document.querySelector("#readingsTab");
const reportTab = document.querySelector("#reportTab");
const usersTab = document.querySelector("#usersTab");
const tabs = document.querySelectorAll(".tab");
const views = [document.querySelector("#readingsView"), document.querySelector("#reportView"), document.querySelector("#usersView")];
const printReportButton = document.querySelector("#printReportButton");
const reportFilterForm = document.querySelector("#reportFilterForm");
const reportFromDate = document.querySelector("#reportFromDate");
const reportToDate = document.querySelector("#reportToDate");
const reportPatient = document.querySelector("#reportPatient");
const reportGeneratedAt = document.querySelector("#reportGeneratedAt");
const reportAverage = document.querySelector("#reportAverage");
const reportMorningAverage = document.querySelector("#reportMorningAverage");
const reportEveningAverage = document.querySelector("#reportEveningAverage");
const reportCount = document.querySelector("#reportCount");
const reportPeriod = document.querySelector("#reportPeriod");
const reportRange = document.querySelector("#reportRange");
const reportRows = document.querySelector("#reportRows");
let currentUser = null;
let currentReadings = [];

function toDateInputValue(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function setDefaultDate() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  readingForm.elements.measuredAt.value = now.toISOString().slice(0, 16);
}

function setDefaultReportDates() {
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 29);
  reportFromDate.value = toDateInputValue(thirtyDaysAgo);
  reportToDate.value = toDateInputValue(today);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Erreur inattendue.");
  return data;
}

function showView(id) {
  views.forEach((view) => view.classList.toggle("hidden", view.id !== id));
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === id));
  if (id === "usersView") loadUsers();
  if (id === "reportView") renderReport(currentReadings);
}

function showApp(session) {
  currentUser = session;
  accountEmail.textContent = session.role === "admin" ? `${session.email} · admin` : session.email;
  usersTab.classList.toggle("hidden", session.role !== "admin");
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  showView("readingsView");
  setDefaultDate();
  setDefaultReportDates();
  loadReadings();
}

function showLogin() {
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
  currentUser = null;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("fr-CA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatReportDate(value) {
  return new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium" }).format(new Date(value));
}

function formatReportTime(value) {
  return new Intl.DateTimeFormat("fr-CA", { timeStyle: "short" }).format(new Date(value));
}

function averageReadings(readings) {
  if (!readings.length) return "--/--";
  const totals = readings.reduce((acc, reading) => {
    acc.systolic += reading.systolic;
    acc.diastolic += reading.diastolic;
    return acc;
  }, { systolic: 0, diastolic: 0 });
  return `${Math.round(totals.systolic / readings.length)}/${Math.round(totals.diastolic / readings.length)}`;
}

function getReportRangeLabel() {
  const selected = new FormData(reportFilterForm).get("range");
  if (selected === "30") return "30 derniers jours";
  if (selected === "90") return "3 derniers mois";
  return "periode personnalisee";
}

function getFilteredReportReadings(readings) {
  const selected = new FormData(reportFilterForm).get("range");
  const today = new Date();
  let from;
  let to = new Date(today);
  to.setHours(23, 59, 59, 999);

  if (selected === "90") {
    from = new Date(today);
    from.setMonth(from.getMonth() - 3);
    from.setHours(0, 0, 0, 0);
  } else if (selected === "custom") {
    from = reportFromDate.value ? new Date(`${reportFromDate.value}T00:00:00`) : null;
    to = reportToDate.value ? new Date(`${reportToDate.value}T23:59:59`) : to;
  } else {
    from = new Date(today);
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);
  }

  return readings.filter((reading) => {
    const measuredAt = new Date(reading.measuredAt);
    return (!from || measuredAt >= from) && measuredAt <= to;
  });
}

function renderSummary(readings) {
  countValue.textContent = readings.length;
  if (!readings.length) {
    averageValue.textContent = "--/--";
    latestValue.textContent = "--/--";
    return;
  }
  averageValue.textContent = averageReadings(readings);
  latestValue.textContent = `${readings[0].systolic}/${readings[0].diastolic}`;
}

function renderReadings(readings) {
  renderSummary(readings);
  if (!readings.length) {
    readingsList.innerHTML = '<p class="empty">Aucune mesure pour le moment.</p>';
    return;
  }
  readingsList.innerHTML = readings.map((reading) => `
    <article class="reading">
      <div>
        <strong>${reading.systolic}/${reading.diastolic}${reading.pulse ? ` · ${reading.pulse} bpm` : ""}</strong>
        <span>${formatDate(reading.measuredAt)}</span>
        ${reading.note ? `<p>${escapeHtml(reading.note)}</p>` : ""}
      </div>
      <button class="delete-button" type="button" data-id="${reading.id}" aria-label="Supprimer">x</button>
    </article>
  `).join("");
}

function renderReport(readings) {
  const filtered = getFilteredReportReadings(readings);
  const chronological = [...filtered].sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt));
  const morningReadings = chronological.filter((reading) => new Date(reading.measuredAt).getHours() < 12);
  const eveningReadings = chronological.filter((reading) => new Date(reading.measuredAt).getHours() >= 18);
  reportPatient.textContent = `Patient: ${currentUser?.email || "--"}`;
  reportGeneratedAt.textContent = formatDate(new Date().toISOString());
  reportAverage.textContent = averageReadings(chronological);
  reportMorningAverage.textContent = averageReadings(morningReadings);
  reportEveningAverage.textContent = averageReadings(eveningReadings);
  reportCount.textContent = chronological.length;

  if (!chronological.length) {
    reportPeriod.textContent = `Periode: ${getReportRangeLabel()} - aucune mesure`;
    reportRange.textContent = "Valeurs observees: aucune mesure";
    reportRows.innerHTML = '<tr><td colspan="6">Aucune mesure disponible.</td></tr>';
    return;
  }

  const first = chronological[0];
  const last = chronological[chronological.length - 1];
  const minSystolic = Math.min(...chronological.map((reading) => reading.systolic));
  const maxSystolic = Math.max(...chronological.map((reading) => reading.systolic));
  const minDiastolic = Math.min(...chronological.map((reading) => reading.diastolic));
  const maxDiastolic = Math.max(...chronological.map((reading) => reading.diastolic));
  reportPeriod.textContent = `Periode: ${getReportRangeLabel()} - ${formatReportDate(first.measuredAt)} au ${formatReportDate(last.measuredAt)}`;
  reportRange.textContent = `Valeurs observees: systolique ${minSystolic}-${maxSystolic}, diastolique ${minDiastolic}-${maxDiastolic}`;
  reportRows.innerHTML = chronological.map((reading) => `
    <tr>
      <td>${formatReportDate(reading.measuredAt)}</td>
      <td>${formatReportTime(reading.measuredAt)}</td>
      <td>${reading.systolic}</td>
      <td>${reading.diastolic}</td>
      <td>${reading.pulse || ""}</td>
      <td>${reading.note ? escapeHtml(reading.note) : ""}</td>
    </tr>
  `).join("");
}

function renderUsers(users) {
  if (!users.length) {
    usersList.innerHTML = '<p class="empty">Aucun compte.</p>';
    return;
  }
  usersList.innerHTML = users.map((user) => {
    const isSelf = currentUser?.email === user.email;
    const status = user.active ? "Actif" : "Inactif";
    return `
      <article class="user-row">
        <div>
          <strong>${escapeHtml(user.email)}</strong>
          <div class="user-meta">${user.role === "admin" ? "Admin" : "Utilisateur"} · ${status}</div>
        </div>
        <div class="user-controls">
          <select data-user-role="${user.id}" ${isSelf ? "disabled" : ""}>
            <option value="user" ${user.role === "user" ? "selected" : ""}>Utilisateur</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
          <select data-user-active="${user.id}" ${isSelf ? "disabled" : ""}>
            <option value="true" ${user.active ? "selected" : ""}>Actif</option>
            <option value="false" ${!user.active ? "selected" : ""}>Inactif</option>
          </select>
          <input data-user-password="${user.id}" type="password" minlength="8" placeholder="Nouveau mot de passe">
          <button class="delete-button" type="button" data-delete-user="${user.id}" ${isSelf ? "disabled" : ""} aria-label="Supprimer">x</button>
        </div>
      </article>
    `;
  }).join("");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

async function loadReadings() {
  const data = await api("/api/readings");
  currentReadings = data.readings;
  renderReadings(data.readings);
  renderReport(data.readings);
}

async function loadUsers() {
  if (currentUser?.role !== "admin") return;
  const data = await api("/api/users");
  renderUsers(data.users);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";
  const body = Object.fromEntries(new FormData(loginForm));
  try {
    const data = await api("/api/login", { method: "POST", body: JSON.stringify(body) });
    loginForm.reset();
    showApp(data);
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

readingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  readingMessage.textContent = "";
  const body = Object.fromEntries(new FormData(readingForm));
  try {
    await api("/api/readings", { method: "POST", body: JSON.stringify(body) });
    readingForm.reset();
    setDefaultDate();
    await loadReadings();
  } catch (error) {
    readingMessage.textContent = error.message;
  }
});

readingsList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  await api(`/api/readings/${button.dataset.id}`, { method: "DELETE" });
  await loadReadings();
});

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  userMessage.textContent = "";
  const body = Object.fromEntries(new FormData(userForm));
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify(body) });
    userForm.reset();
    await loadUsers();
  } catch (error) {
    userMessage.textContent = error.message;
  }
});

usersList.addEventListener("change", async (event) => {
  const roleSelect = event.target.closest("[data-user-role]");
  const activeSelect = event.target.closest("[data-user-active]");
  const id = roleSelect?.dataset.userRole || activeSelect?.dataset.userActive;
  if (!id) return;
  userMessage.textContent = "";
  const row = event.target.closest(".user-row");
  const role = row.querySelector("[data-user-role]")?.value;
  const active = row.querySelector("[data-user-active]")?.value === "true";
  try {
    await api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ role, active }) });
    await loadUsers();
  } catch (error) {
    userMessage.textContent = error.message;
    await loadUsers();
  }
});

usersList.addEventListener("keydown", async (event) => {
  const input = event.target.closest("[data-user-password]");
  if (!input || event.key !== "Enter") return;
  event.preventDefault();
  if (!input.value) return;
  userMessage.textContent = "";
  try {
    await api(`/api/users/${input.dataset.userPassword}`, {
      method: "PATCH",
      body: JSON.stringify({ password: input.value })
    });
    input.value = "";
    userMessage.textContent = "Mot de passe mis a jour.";
  } catch (error) {
    userMessage.textContent = error.message;
  }
});

usersList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-user]");
  if (!button) return;
  userMessage.textContent = "";
  try {
    await api(`/api/users/${button.dataset.deleteUser}`, { method: "DELETE" });
    await loadUsers();
  } catch (error) {
    userMessage.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showLogin();
});

printReportButton.addEventListener("click", () => {
  renderReport(currentReadings);
  window.print();
});

reportFilterForm.addEventListener("change", () => {
  renderReport(currentReadings);
});

reportFilterForm.addEventListener("input", () => {
  if (document.activeElement === reportFromDate || document.activeElement === reportToDate) {
    reportFilterForm.elements.range.value = "custom";
  }
  const selected = new FormData(reportFilterForm).get("range");
  if (selected === "custom") renderReport(currentReadings);
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
});

api("/api/session")
  .then((session) => session.authenticated ? showApp(session) : showLogin())
  .catch(showLogin);
