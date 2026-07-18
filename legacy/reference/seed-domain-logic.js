// ===== DIVE SCHEDULE — SEED DOMAIN LOGIC (verbatim extract from legacy/index.html) =====
// Reference only. Port these EXACTLY into the NestJS api (dates→tenant tz, Firestore→Prisma).

// --- security/format helpers (lines 1319-1346) ---
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const initials = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
};

// Only allow inline images that are genuine image data URLs. Defends the
// shared, openly-writable database against a malicious photo string injecting
// HTML/JS (e.g. a photo value of  x" onerror="...").
const isSafePhoto = (s) => typeof s === "string" && /^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(s);

// Only allow http(s) links — blocks javascript: and other script-y schemes.
const safeUrl = (u) => {
  try { const proto = new URL(u, location.href).protocol; return (proto === "http:" || proto === "https:") ? u : ""; }
  catch { return ""; }
};

// Avatar content: a safe photo if present, otherwise initials
const avatarInner = (photo, name) => isSafePhoto(photo)
  ? `<img src="${escapeHtml(photo)}" alt="" onerror="this.style.display='none'">`
  : escapeHtml(initials(name));

const jobsForDiver = (id) => trips.filter(t => (t.divers || []).includes(id));


// --- date + rotation + totals + dueStatus (lines 1808-1896) ---
const formatDate = (val) => {
  if (!val) return "";
  // Parse date-only strings ("2026-07-15") as local time to avoid off-by-one
  const d = String(val).length <= 10 ? new Date(val + "T00:00:00") : new Date(val);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

const rotationLabel = (r) =>
  r === "biweekly" ? "Bi-weekly" :
  r === "monthly" ? "Monthly" :
  r === "bimonthly" ? "Bi-monthly" : "Weekly";

// ---- Money + sales-period helpers ----
const money = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n)) return "$0";
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return (n < 0 ? "-$" : "$") + s;
};

const startOfWeek = (d) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
};
const startOfMonth = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), 1); x.setHours(0, 0, 0, 0); return x; };
const startOfYear = (d) => { const x = new Date(d.getFullYear(), 0, 1); x.setHours(0, 0, 0, 0); return x; };

// Parse a YYYY-MM-DD (or ISO) string to a local Date, or null if unusable.
const parseDay = (val) => {
  if (!val) return null;
  const d = String(val).length <= 10 ? new Date(val + "T00:00:00") : new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

// Build income/expense totals since a cutoff date.
// Money in = every completed cleaning (by completion date) with a price, plus
// manual "in" ledger entries. Completed cleanings are counted from the PERMANENT
// dive records so a boat's revenue survives the job being reopened for its next
// rotation; any completed job that doesn't yet have a record is added as a
// fallback, deduped by job id so a just-completed (not-yet-reopened) job isn't
// counted twice. Money out = manual "out" ledger entries.
const totalsSince = (cutoff, now) => {
  let inSum = 0, outSum = 0;
  for (const l of ledger) {
    const d = parseDay(l.date);
    if (!d || d < cutoff || d > now) continue;
    const amt = parseFloat(l.amount) || 0;
    if (l.kind === "out") outSum += amt; else inSum += amt;
  }
  const recordedJobIds = new Set();
  for (const r of records) {
    if (r.jobId) recordedJobIds.add(r.jobId);
    const price = parseFloat(r.price) || 0;
    if (!(price > 0)) continue;
    const d = parseDay(r.completedAt);
    if (!d || d < cutoff || d > now) continue;
    inSum += price;
  }
  for (const t of trips) {
    if (t.status !== "completed") continue;
    if (t.id && recordedJobIds.has(t.id)) continue; // already counted via its record
    const price = parseFloat(t.price) || 0;
    if (!(price > 0)) continue;
    const d = parseDay(t.completedAt) || parseDay(t.dueDate);
    if (!d || d < cutoff || d > now) continue;
    inSum += price;
  }
  return { inSum, outSum, net: inSum - outSum };
};

const invTypeLabel = (t) => t === "part" ? "Special part" : t === "tool" ? "Diver tool" : "Inventory";

const dueStatus = (dueDate) => {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  if (isNaN(due.getTime())) return null;
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return { kind: "overdue", label: days === -1 ? "Overdue by 1 day" : `Overdue by ${-days} days` };
  if (days === 0) return { kind: "due-soon", label: "Due today" };
  if (days === 1) return { kind: "due-soon", label: "Due tomorrow" };
  if (days <= 7) return { kind: "due-soon", label: `Due in ${days} days` };
  return { kind: "due-ok", label: `Due in ${days} days` };
};

// --- recordText (lines 2600-2621) ---
const recordText = (r) => {
  const L = ["DIVE SERVICE RECORD"];
  const head = [r.boat, r.site].filter(Boolean).join(" — ");
  if (head) L.push(head);
  L.push("");
  const add = (k, v) => { if (v) L.push(`${k}: ${v}`); };
  add("Owner", r.owner);
  add("Completed by", r.completedByName);
  add("Divers", r.diverNames);
  add("Date completed", formatWhen(r.completedAt));
  add("Rotation", rotationLabel(r.rotation));
  if (r.footage) add("Boat length", r.footage + " ft");
  if (parseFloat(r.price) > 0) add("Price", "$" + r.price);
  if (r.answers && r.answers.length) {
    L.push(""); L.push("Checklist:");
    r.answers.forEach(a => L.push(`  • ${a.q}  ${a.a}`));
  }
  if (r.note) { L.push(""); L.push(`Notes: ${r.note}`); }
  if (r.certified) L.push(`Certified: yes${r.certifiedAt ? " (" + formatWhen(r.certifiedAt) + ")" : ""}`);
  return L.join("\n");
};


// --- payWeekRange + computePay (lines 3099-3160) ---
const payWeekRange = (offset) => {
  const start = startOfWeek(new Date());
  start.setDate(start.getDate() + offset * 7);
  const endExcl = new Date(start);
  endExcl.setDate(endExcl.getDate() + 7);
  return { start, endExcl };
};

// A diver earns DIVER_PAY_RATE of each completed job's price, bucketed by the
// day it was completed. Returns 7 day-buckets plus the week total & footage.
// Pay is drawn from the PERMANENT dive records so a diver's earnings for a week
// survive the job being reopened for its next rotation; records are credited by
// diver id (falling back to the diver's name for records saved before ids were
// stored). Any completed job without a record yet is added as a fallback,
// deduped by job id so a just-completed job isn't paid twice.
const computePay = (diverId, start, endExcl) => {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    days.push({ date: d, jobs: [], total: 0, feet: 0 });
  }
  let weekTotal = 0, totalFeet = 0;
  const diverName = diverNameById(diverId);
  const addJob = (when, price, feet, site) => {
    if (!when || when < start || when >= endExcl) return;
    // Day index by calendar date (DST-safe — don't divide elapsed ms).
    const idx = days.findIndex(d =>
      d.date.getFullYear() === when.getFullYear() &&
      d.date.getMonth() === when.getMonth() &&
      d.date.getDate() === when.getDate());
    if (idx < 0) return;
    const earning = (price > 0 ? price : 0) * DIVER_PAY_RATE;
    days[idx].jobs.push({ site, earning, feet });
    days[idx].total += earning;
    days[idx].feet += feet;
    weekTotal += earning; totalFeet += feet;
  };
  const recordedJobIds = new Set();
  for (const r of records) {
    if (r.jobId) recordedJobIds.add(r.jobId);
    const mine = (r.completedBy && r.completedBy === diverId) ||
                 (!r.completedBy && diverName && r.completedByName === diverName);
    if (!mine) continue;
    addJob(parseDay(r.completedAt), parseFloat(r.price) || 0, parseFloat(r.footage) || 0, r.site);
  }
  for (const t of trips) {
    if (t.status !== "completed" || t.completedBy !== diverId) continue;
    if (t.id && recordedJobIds.has(t.id)) continue; // already paid via its record
    addJob(parseDay(t.completedAt), parseFloat(t.price) || 0, parseFloat(t.footage) || 0, t.site);
  }
  return { days, weekTotal, totalFeet };
};

const wirePaySelect = () => {
  const sel = $("paySel");
  if (!sel) return;
  sel.addEventListener("change", () => {
    payDiverId = sel.value;
    try { localStorage.setItem(PAY_DIVER_KEY, payDiverId); } catch {}
    payWeekOffset = 0;
    renderPay();
  });

// --- buildRecordFromTrip, saveRecordSafe, syncRecordFromTrip, saveCompletion, nextDueDate, reopenJob (lines 3348-3492) ---
const buildRecordFromTrip = (t) => ({
  id: null,
  jobId: t.id || "",
  site: t.site, boat: t.boat, owner: t.owner,
  diverNames: (t.divers || []).map(diverNameById).filter(Boolean).join(", "),
  customerEmail: t.customerEmail || "",
  sent: false, sentAt: "", sentTo: "",
  completedBy: t.completedBy || "",
  completedByName: t.completedBy ? diverNameById(t.completedBy) : "",
  completedAt: t.completedAt,
  rotation: t.rotation, price: t.price, footage: t.footage,
  note: t.completionNote, photo: t.completionPhoto,
  certified: !!t.certified, certifiedAt: t.certifiedAt || "",
  answers: (Array.isArray(t.checkAnswers) ? t.checkAnswers : [])
    .filter(x => x.a).map(x => ({ q: x.q, a: x.a })),
  createdAt: t.completedAt
});

// Save a record; if it fails (usually a too-big photo), retry once without the
// photo. Returns false only if both attempts fail.
const saveRecordSafe = async (record) => {
  try { await store.saveRecord(record); return true; }
  catch {
    try { await store.saveRecord({ ...record, photo: "" }); return true; }
    catch { return false; }
  }
};

// THE SYNC FIX: checklist answers and the certify signature stay editable after
// a job is marked complete — so any change made then must flow into the job's
// dive record too, or the report emailed to the customer goes stale. Records
// already SENT are an archive of exactly what was emailed and stay frozen.
// If the record failed to save at completion time, this recreates it.
const syncRecordFromTrip = async (tripId) => {
  const t = trips.find(x => x.id === tripId);
  if (!t || t.status !== "completed") return;
  const fresh = buildRecordFromTrip(t);
  const rec = records.find(r => r.jobId === t.id && r.completedAt === t.completedAt);
  if (rec && rec.sent) return; // sent = frozen history
  if (rec) {
    await saveRecordSafe({
      ...rec,
      answers: fresh.answers, certified: fresh.certified, certifiedAt: fresh.certifiedAt,
      note: fresh.note, photo: fresh.photo || rec.photo,
      diverNames: fresh.diverNames, completedBy: fresh.completedBy, completedByName: fresh.completedByName,
      customerEmail: fresh.customerEmail || rec.customerEmail
    });
  } else {
    await saveRecordSafe(fresh); // self-heal a missing record
  }
};

let completionInFlight = false;
const saveCompletion = async () => {
  if (completionInFlight) return;            // ignore a rapid double-tap on "Mark completed"
  if (!completingJobId || !completion) { closeModal($("completeModal")); return; }
  completionInFlight = true;
  const _completeBtn = $("completeSave"); if (_completeBtn) _completeBtn.disabled = true;
  try {
  // Let any in-flight checklist-answer / certify save land first, then read the
  // freshest job so the permanent record snapshots the complete checklist.
  await tripWriteChain.catch(() => {});
  const t = trips.find(x => x.id === completingJobId);
  if (!t) { closeModal($("completeModal")); return; }
  const updated = JSON.parse(JSON.stringify(t));
  updated.status = "completed";
  // Read the dropdown's actual value so the diver shown is credited even if
  // the admin never changed the selection (the 'change' event wouldn't fire).
  updated.completedBy = ($("completeBy") && $("completeBy").value) || completion.by || "";
  updated.completedAt = new Date().toISOString();
  updated.completionNote = completion.note || "";
  updated.completionPhoto = completion.photo || "";
  updated.videos = Array.isArray(updated.videos) ? updated.videos : [];
  if (completion.videoUrl) updated.videos.push({ title: "Completion video", url: completion.videoUrl });

  const ok = await saveWithPhotoFallback(updated, t => store.saveTrip(t), ["completionPhoto"], "Job marked complete");
  if (!ok) return; // keep the completion modal open so the diver can retry

  // Save a PERMANENT dive record — a snapshot that survives even if this job
  // is later reopened for the next rotation. If the checklist or certification
  // changes after completion, syncRecordFromTrip keeps this record current
  // until it's sent.
  const okRec = await saveRecordSafe(buildRecordFromTrip(updated));
  if (!okRec) toast("Job completed, but the dive record didn't save — check your connection.");

  closeModal($("completeModal"));
  completingJobId = null;
  completion = null;
  } finally {
    completionInFlight = false;
    if (_completeBtn) _completeBtn.disabled = false;
  }
};

// Compute the next due date for a rotation, anchored to when the boat was last
// cleaned (falls back to its old due date, then today). Works in local calendar
// terms so daylight-saving changes never shift the day.
const nextDueDate = (rotation, anchor) => {
  let base = anchor ? new Date(String(anchor).length <= 10 ? anchor + "T00:00:00" : anchor) : null;
  if (!base || isNaN(base.getTime())) base = new Date();
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  // Add whole months without rolling into the next month when the target month
  // is shorter (e.g. Jan 31 + 1 month should be Feb 28/29, not Mar 3).
  const addMonths = (n) => {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
  };
  if (rotation === "biweekly") d.setDate(d.getDate() + 14);
  else if (rotation === "monthly") addMonths(1);
  else if (rotation === "bimonthly") addMonths(2);
  else d.setDate(d.getDate() + 7); // weekly (default)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const reopenJob = async (jobId) => {
  const t = trips.find(x => x.id === jobId);
  if (!t) return;
  const lastDone = t.completedAt;   // capture before we clear it below
  const updated = JSON.parse(JSON.stringify(t));
  updated.status = "open";
  updated.completedBy = "";
  updated.completedAt = "";
  updated.completionNote = "";
  updated.completionPhoto = "";
  updated.videos = (updated.videos || []).filter(v => v.title !== "Completion video");
  // Clear the previous cycle's inspection answers and signature so the next
  // rotation starts fresh. The permanent dive record already snapshotted the
  // old values at completion, so clearing them here is safe.
  updated.checkAnswers = [];
  updated.certified = false;
  updated.certifiedAt = "";
  // Advance the due date to the next rotation cycle so the reopened job is
  // scheduled for its next cleaning instead of staying on the old (now past)
  // date and immediately reading as overdue. Anchor to the last-cleaned date so
  // a boat cleaned late still gets a full interval before it's next due.
  if (updated.dueDate) updated.dueDate = nextDueDate(updated.rotation, lastDone || updated.dueDate);
  await store.saveTrip(updated);
  toast("Reopened — next " + rotationLabel(updated.rotation).toLowerCase() + " clean " + formatDate(updated.dueDate));
};

// Delete a diver and unassign them from every job (no orphaned IDs left behind).
// Also clear "completed by" where it points at this diver, so their name/id

// --- daysSince (lines 4015-4022) ---
const daysSince = (startISO) => {
  const start = parseDay(startISO);
  if (!start) return 0;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  // Round (not floor) so the ±1h daylight-saving wobble between two local
  // midnights can't shave a day off the count (matches dueStatus).
  return Math.max(0, Math.round((now - start) / 86400000));
};
