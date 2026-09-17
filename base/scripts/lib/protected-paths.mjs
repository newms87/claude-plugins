// Shared path-safety classification for the base plugin's PreToolUse guards.
//
// Two guards need to answer the same question about a literal filesystem
// path: "is this a filesystem/drive/mount root, a home directory, or an
// ancestor of one?" `deny-unsafe-recursive-delete.mjs` asks it because
// deleting/mirroring into one of those destroys everything under it.
// `deny-whole-disk-scan.mjs` asks it because tree-walking one of them reads
// the entire disk instead of the specific place the answer actually lives.
// The classification itself — which paths count as a root or a home
// directory — must not drift between the two, so it lives here once.

/**
 * Classify a literal filesystem path (already forward-slash normalized —
 * callers do `path.replace(/\\/g, "/")` first so `C:\Users\x` and
 * `C:/Users/x` classify the same way).
 *
 * Returns a short human-readable reason when `path` is a filesystem, drive,
 * or mount root, a home directory, or an ancestor of one; otherwise `null`
 * (the path is specific enough to be safe).
 */
export function protectedPathReason(path) {
  let p = path;
  // UNC access into a WSL distro: //wsl$/Ubuntu/home/x -> /home/x
  const unc = /^\/\/(wsl\$|wsl\.localhost)\/[^/]+(\/.*)?$/i.exec(p);
  if (unc) p = unc[2] ?? "/";
  else if (/^\/\/[^/]+(\/[^/]+)?\/*$/.test(p)) return "it is a network share root";

  // Drive-rooted forms: C:/x, /mnt/c/x (WSL), /c/x (Git Bash).
  const driveMatch = /^([A-Za-z]):(\/.*)?$/.exec(p) ?? /^\/mnt\/([A-Za-z])(\/.*)?$/.exec(p) ?? /^\/([A-Za-z])(\/.*)?$/.exec(p);
  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase();
    const segs = (driveMatch[2] ?? "/").split("/").filter(Boolean);
    if (segs.length === 0) return `it is the root of drive ${drive}:`;
    if (segs.length === 1) return `it is a top-level folder on drive ${drive}:`;
    if (segs[0].toLowerCase() === "users" && segs.length === 2) return `it is a Windows home directory on drive ${drive}:`;
    return null;
  }

  if (!p.startsWith("/")) return null; // relative path with a real segment

  const segs = p.split("/").filter(Boolean);
  if (segs.length === 0) return "it is the filesystem root `/`";
  const [top] = segs;
  if (segs.length === 1) return `it is the top-level system directory \`/${top}\``;
  if (top === "mnt" || top === "media" || top === "Volumes") return segs.length === 2 ? "it is a mount root" : null;
  if ((top === "home" || top === "Users") && segs.length === 2) return "it is a home directory";
  if (top === "tmp") return null;
  if (segs.length === 2) return `it is a system directory (\`/${segs.join("/")}\`)`;
  return null;
}
