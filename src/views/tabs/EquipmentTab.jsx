import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api.js";
import { laDateStr } from "../../lib/dates.js";
import { BX, label, tag, card, bodyText, btnPrimary, btnGhost, inputBx } from "../../lib/boxx.js";
import BxModal from "../../components/BxModal.jsx";

const STATUS_TAG = { ok: ["OK", BX.DRIFTWOOD], watch: ["WATCH", BX.AMBER], flag: ["FLAG", BX.RUST] };

// Manny's register: machines and deadline tasks on the surface, the full
// service history in the machine pop-up. Overdue deadlines escalate to the
// owner's queue automatically every morning.
export default function EquipmentTab({ isMobile }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);   // equipment id or 'new'
  const today = laDateStr();

  const load = useCallback(() => {
    api.get("/api/equipment").then(setData).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={bodyText({ color: BX.RUST, padding: 20 })}>{error}</div>;
  if (!data) return <div style={bodyText({ padding: 20 })}>Loading…</div>;

  const tasksFor = (id) => data.tasks.filter(t => t.equipment_id === id);
  const dueTasks = data.tasks.filter(t => !t.done_at);
  const overdue = dueTasks.filter(t => t.due_date < today);
  const openEq = open === "new" ? null : data.equipment.find(e => e.id === open);
  const daysTo = (d) => Math.round((new Date(d) - new Date(today)) / 86400000);

  return (
    <div style={{ fontFamily: BX.MONO, fontWeight: 300, color: BX.INK, maxWidth: 900 }}>
      {/* Deadlines strip */}
      <div style={card({ marginBottom: 8, borderColor: overdue.length ? BX.RUST : BX.LINEN })}>
        <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}` }}>
          <span style={label({ color: overdue.length ? BX.RUST : BX.INK, letterSpacing: "0.2em" })}>
            Deadlines · overdue escalates to the owner the next morning
          </span>
        </div>
        {dueTasks.length === 0 && <div style={bodyText({ padding: "12px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>Nothing due.</div>}
        {dueTasks.slice(0, 8).map(t => {
          const eq = data.equipment.find(e => e.id === t.equipment_id);
          const d = daysTo(t.due_date);
          return (
            <div key={t.id} style={{ padding: "10px 16px", borderBottom: `1px solid ${BX.STONE}`,
              display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 13 }}>{eq?.name || "?"} · {t.name}</span>
              <span style={bodyText({ fontSize: 11 })}>due {t.due_date}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "baseline" }}>
                {d < 0
                  ? <span style={tag(BX.RUST)}>OVERDUE {-d}D{t.escalated_at ? " · ESCALATED" : ""}</span>
                  : d <= 14 ? <span style={tag(BX.AMBER)}>{d}D LEFT</span> : <span style={tag()}>{d}D</span>}
                <button onClick={async () => { await api.post(`/api/equipment-tasks/${t.id}/done`).catch(e => setError(e.message)); load(); }}
                  style={btnGhost({ padding: "6px 12px", fontSize: 8 })}>Done</button>
              </span>
            </div>
          );
        })}
      </div>

      {/* Register */}
      <div style={card()}>
        <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.LINEN}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={label({ color: BX.INK, letterSpacing: "0.2em" })}>Register · tap a machine for its history</span>
          <button onClick={() => setOpen("new")} style={btnPrimary({ padding: "8px 14px", fontSize: 8 })}>+ Equipment</button>
        </div>
        {data.equipment.map(e => {
          const [l, c] = STATUS_TAG[e.status] || STATUS_TAG.ok;
          const open_ = tasksFor(e.id).filter(t => !t.done_at);
          return (
            <div key={e.id} onClick={() => setOpen(e.id)}
              style={{ padding: "11px 16px", borderBottom: `1px solid ${BX.STONE}`, cursor: "pointer",
                display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontFamily: BX.SERIF, fontSize: 14 }}>{e.name}</span>
              {e.detail && <span style={bodyText({ fontSize: 11 })}>{e.detail}</span>}
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                {open_.length > 0 && <span style={tag(BX.AMBER)}>{open_.length} DUE</span>}
                <span style={tag(c)}>{l}</span>
              </span>
            </div>
          );
        })}
        {data.equipment.length === 0 && (
          <div style={bodyText({ padding: "12px 16px", fontSize: 12, color: BX.DRIFTWOOD })}>
            Empty register. Add the machines: grinders, espresso machines, ice, water filtration.
          </div>
        )}
      </div>

      {open != null && (
        <MachineModal eq={openEq} tasks={openEq ? tasksFor(openEq.id) : []}
          log={openEq ? data.log.filter(l => l.equipment_id === openEq.id) : []}
          onClose={() => { setOpen(null); load(); }} onError={setError} />
      )}
    </div>
  );
}

function MachineModal({ eq, tasks, log, onClose, onError }) {
  const [f, setF] = useState({ name: eq?.name || "", detail: eq?.detail || "", status: eq?.status || "ok" });
  const [task, setTask] = useState({ name: "", due_date: "" });
  const [entry, setEntry] = useState({ text: "", cost: "" });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  const save = async () => {
    try {
      if (eq) await api.patch(`/api/equipment/${eq.id}`, f);
      else await api.post("/api/equipment", f);
      onClose();
    } catch (err) { onError(err.message); }
  };
  const addTask = async () => {
    if (!task.name || !task.due_date) return;
    try { await api.post(`/api/equipment/${eq.id}/tasks`, task); onClose(); }
    catch (err) { onError(err.message); }
  };
  const addLog = async () => {
    if (!entry.text) return;
    try { await api.post(`/api/equipment/${eq.id}/log`, entry); onClose(); }
    catch (err) { onError(err.message); }
  };

  return (
    <BxModal title={eq ? eq.name : "New equipment"} onClose={onClose} width={660}>
      <div style={{ padding: "12px 22px", borderBottom: `1px solid ${BX.STONE}`, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={f.name} onChange={e => set("name", e.target.value)} placeholder="Name, e.g. Mahlkönig K30 · unit 2"
          style={inputBx({ fontSize: 12, flexGrow: 1, flexBasis: 220 })} />
        <span style={{ display: "flex", gap: 6 }}>
          {["ok", "watch", "flag"].map(s => (
            <button key={s} onClick={() => set("status", s)}
              style={{ cursor: "pointer", padding: "6px 12px", background: f.status === s ? BX.INK : "transparent",
                border: `1px solid ${f.status === s ? BX.INK : BX.LINEN}`,
                ...label({ fontSize: 8, color: f.status === s ? BX.PARCHMENT : BX.DRIFTWOOD }) }}>{s.toUpperCase()}</button>
          ))}
        </span>
        <input value={f.detail} onChange={e => set("detail", e.target.value)} placeholder="Serial, position, notes"
          style={inputBx({ fontSize: 12, width: "100%" })} />
      </div>
      {eq && (
        <>
          <div style={{ padding: "10px 22px", borderBottom: `1px solid ${BX.STONE}` }}>
            <div style={label({ fontSize: 8, marginBottom: 8, color: BX.INK })}>DEADLINES · CARTRIDGES, SERVICES</div>
            {tasks.filter(t => !t.done_at).map(t => (
              <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "4px 0" }}>
                <span style={bodyText({ fontSize: 12 })}>{t.name}</span>
                <span style={{ marginLeft: "auto", fontSize: 10, color: BX.DRIFTWOOD }}>due {t.due_date}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input value={task.name} onChange={e => setTask(s => ({ ...s, name: e.target.value }))} placeholder="Replace softener cartridge"
                style={inputBx({ fontSize: 11, padding: 8, flexGrow: 1 })} />
              <input type="date" value={task.due_date} onChange={e => setTask(s => ({ ...s, due_date: e.target.value }))}
                style={inputBx({ fontSize: 11, padding: 8 })} />
              <button onClick={addTask} style={btnGhost({ padding: "8px 12px", fontSize: 8 })}>Add</button>
            </div>
          </div>
          <div style={{ padding: "10px 22px", borderBottom: `1px solid ${BX.STONE}` }}>
            <div style={label({ fontSize: 8, marginBottom: 8, color: BX.INK })}>SERVICE LOG</div>
            {log.map(l => (
              <div key={l.id} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "4px 0" }}>
                <span style={label({ fontSize: 8, color: BX.INK, flexShrink: 0 })}>{l.entry_date.slice(5)}</span>
                <span style={bodyText({ fontSize: 12 })}>{l.text}{l.cost ? ` · ${l.cost}` : ""}</span>
              </div>
            ))}
            {log.length === 0 && <div style={bodyText({ fontSize: 11, color: BX.DRIFTWOOD })}>No entries yet.</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input value={entry.text} onChange={e => setEntry(s => ({ ...s, text: e.target.value }))} placeholder="What was done"
                style={inputBx({ fontSize: 11, padding: 8, flexGrow: 1 })} />
              <input value={entry.cost} onChange={e => setEntry(s => ({ ...s, cost: e.target.value }))} placeholder="Cost"
                style={inputBx({ fontSize: 11, padding: 8, width: 90 })} />
              <button onClick={addLog} style={btnGhost({ padding: "8px 12px", fontSize: 8 })}>Log</button>
            </div>
          </div>
        </>
      )}
      <div style={{ padding: "12px 22px", display: "flex", justifyContent: "flex-end" }}>
        <button onClick={save} style={btnPrimary()}>Save</button>
      </div>
    </BxModal>
  );
}
