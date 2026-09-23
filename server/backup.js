import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { db, DB_PATH, INVOICE_DIR } from "./db.js";
import { laDateStr } from "./dates.js";

// Nightly snapshots of the SQLite file, kept beside it with rotation, plus an
// owner-downloadable archive so a copy can live OFF the Railway volume.
// better-sqlite3's backup() is an online copy — safe while the app runs.

export const BACKUP_DIR = path.join(path.dirname(DB_PATH), "backups");

export async function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `crumbs-${laDateStr()}.db`);
  await db.backup(dest);
  // Rotation: keep the newest 10 dailies
  const files = fs.readdirSync(BACKUP_DIR).filter(f => /^crumbs-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 10))) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
  }
  const size = fs.statSync(dest).size;
  return { message: `${path.basename(dest)} (${(size / 1e6).toFixed(1)} MB) · ${Math.min(files.length, 10)} snapshots kept`, items: 1 };
}

export function backupStatus() {
  let snapshots = [];
  try {
    snapshots = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^crumbs-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse()
      .map(f => ({ file: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size }));
  } catch { /* no backups yet */ }
  return { snapshots, dir: BACKUP_DIR };
}

// Fresh snapshot for download — always current, not the last nightly.
export async function snapshotForDownload() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, "download.db");
  await db.backup(dest);
  return dest;
}

// Full archive: current db snapshot + invoice PDFs + post images, paths
// relative to the data dir so a restore is just untar + point the app at it.
export async function buildFullArchive() {
  const dbSnap = await snapshotForDownload();
  const out = path.join(BACKUP_DIR, "boxxhub-backup.tar.gz");
  const dataDir = path.dirname(DB_PATH);
  const args = ["-czf", out, "-C", dataDir, path.join("backups", path.basename(dbSnap))];
  for (const dir of [INVOICE_DIR, path.resolve(dataDir, "posts")]) {
    const rel = path.relative(dataDir, dir);
    if (fs.existsSync(dir) && !rel.startsWith("..")) args.push(rel);
  }
  await new Promise((resolve, reject) =>
    execFile("tar", args, (err) => err ? reject(err) : resolve()));
  return out;
}
